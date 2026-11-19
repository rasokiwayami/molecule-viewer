import './style.css';
import {
  loadCatalog,
  loadBuiltin,
  matchCatalog,
  exactMatch,
  searchExternal,
  SEARCH_MESSAGES,
} from './catalog.js';
import { createScene } from './scene.js';
import { createHands } from './hands.js';
import { setupVoice } from './voice.js';
import { createUI, $ } from './ui.js';
import { assetURL } from './config.js';
import { createGuide } from './guide.js';

const HAND_ERRORS = {
  denied: 'カメラが許可されていません',
  'no-camera': 'カメラが見つかりません',
  failed: 'カメラを使えませんでした',
};
const VOICE_ERRORS = {
  denied: 'マイクが許可されていません',
  'no-speech': '聞き取れませんでした',
  failed: '声の入力を使えませんでした',
};

// `?embed=1` shows only the molecule, the list of molecules and the hand button, for use inside another page.
const embedded = new URLSearchParams(location.search).has('embed');
document.documentElement.classList.toggle('embed', embedded);

let catalog = [];
let currentId = null;
// Only the most recent request may update the screen.
let latestRequest = 0;

const ui = createUI({ onSelect: selectBuiltin });
if (embedded) ui.setHandsState('off'); // shows the embedded wording of the camera button from the start
const search = $('search');

// Embedded: one line under the camera button walks a first-time visitor through the gestures,
// and the page around the frame is told how far they got so it can time what it shows next.
const guide = createGuide({
  show: ui.showGuide,
  report: (message) => parent.postMessage({ source: 'molecule-viewer', ...message }, '*'),
});

let scene = null;
try {
  scene = createScene({
    host: $('stage'),
    atomLabel: $('atom-label'),
    onFailure: ui.showUnsupported,
  });
} catch {
  ui.showUnsupported();
}

const hands =
  scene &&
  createHands({
    video: $('camera'),
    overlay: $('skeleton'),
    scene,
    onChange: (state) => {
      ui.setHandsState(state);
      scene.refit(); // the embedded view moves the molecule clear of the camera preview
      if (embedded) guide.setState(state);
    },
    onHands: (list) => {
      ui.showHands(list);
      if (embedded) guide.update(list);
    },
    onError: (reason) => ui.toast(HAND_ERRORS[reason]),
  });
$('hands-toggle').onclick = () => hands?.toggle();

// Embedded, the page around it leads people to the camera button, so the hand-tracking
// files (about 10 MB) are fetched ahead of time. They then come from the browser cache.
if (embedded && hands && !navigator.connection?.saveData) {
  const warm = () =>
    ['mediapipe/vision_wasm_module_internal.js', 'mediapipe/vision_wasm_module_internal.wasm', 'mediapipe/hand_landmarker.task']
      .forEach((path) => fetch(assetURL(path), { priority: 'low' }).then((r) => r.arrayBuffer()).catch(() => {}));
  setTimeout(warm, 2500);
}

function show(item) {
  currentId = item.id;
  scene?.setMolecule(item.structure);
  ui.showMolecule(item);
  const url = new URL(location.href);
  url.searchParams.set('m', item.id);
  history.replaceState(null, '', url);
}

async function selectBuiltin(item) {
  const request = ++latestRequest;
  ui.toast('');
  try {
    const loaded = await loadBuiltin(item);
    if (request !== latestRequest) return;
    show(loaded);
    if (search.value) {
      search.value = '';
      ui.renderChips(catalog);
    }
  } catch {
    if (request === latestRequest) ui.toast('読み込めませんでした');
  }
}

async function searchOnline(query) {
  const request = ++latestRequest;
  ui.toast('探しています');
  try {
    const found = await searchExternal(query);
    if (request !== latestRequest) return;
    show(found);
    ui.toast('');
  } catch (error) {
    if (request !== latestRequest) return;
    ui.toast(SEARCH_MESSAGES[error.kind] || SEARCH_MESSAGES.network);
    ui.renderChips(catalog);
  }
}

function filterChips() {
  const matches = matchCatalog(catalog, search.value);
  ui.renderChips(matches.length ? matches : catalog);
}
search.addEventListener('input', filterChips);

$('search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const query = search.value.trim();
  if (!query) return;
  const match = matchCatalog(catalog, query)[0];
  if (match) selectBuiltin(match);
  else searchOnline(query);
});

setupVoice($('voice'), {
  onListening(listening) {
    search.placeholder = listening ? '話してください' : '分子の名前';
    if (listening) {
      search.value = '';
      ui.toast('');
    }
  },
  onInterim(heard) {
    search.value = heard;
    filterChips();
  },
  onFinal(heard) {
    search.value = heard;
    const match = exactMatch(catalog, heard) || matchCatalog(catalog, heard)[0];
    if (match) selectBuiltin(match);
    else searchOnline(heard);
  },
  onError: (reason) => ui.toast(VOICE_ERRORS[reason]),
});

function step(offset) {
  if (!catalog.length) return;
  const index = Math.max(
    0,
    catalog.findIndex((item) => item.id === currentId),
  );
  selectBuiltin(catalog[(index + offset + catalog.length) % catalog.length]);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    search.blur();
    return;
  }
  const typing = event.target.matches('input, textarea');
  if (typing || ui.panel.open || event.metaKey || event.ctrlKey || event.altKey) return;
  const actions = {
    '/': () => search.focus(),
    h: () => hands?.toggle(),
    ArrowRight: () => step(1),
    ArrowLeft: () => step(-1),
  };
  const action = actions[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (!action) return;
  event.preventDefault();
  action();
});

// "?stats" shows how many frames are drawn and how many hand positions arrive each second.
if (new URLSearchParams(location.search).has('stats')) {
  const readout = document.createElement('pre');
  readout.style.cssText =
    'position:fixed;top:72px;right:16px;z-index:9;margin:0;font:12px ui-monospace,monospace;color:#d7ff5e';
  document.body.append(readout);
  let frames = 0;
  const count = () => requestAnimationFrame(count) && frames++;
  count();
  setInterval(() => {
    const { samples, delay, tracking } = hands?.takeStats() ?? {};
    const handLine = samples
      ? `hand ${samples}/s  delay ${Math.round(delay / samples)} ms  ${tracking}`
      : 'hand -';
    readout.textContent = `draw ${frames}/s\n${handLine}`;
    frames = 0;
  }, 1000);
}

async function init() {
  try {
    catalog = await loadCatalog();
  } catch {
    ui.toast('読み込めませんでした');
    return;
  }
  ui.renderChips(catalog);
  const requested = new URLSearchParams(location.search).get('m');
  await selectBuiltin(catalog.find((item) => item.id === requested) || catalog[0]);
}
init();

if (import.meta.env.PROD && !embedded && 'serviceWorker' in navigator && isSecureContext) {
  addEventListener('load', () => {
    navigator.serviceWorker.register(assetURL('sw.js'), { scope: assetURL('') }).catch(() => {});
  });
}
