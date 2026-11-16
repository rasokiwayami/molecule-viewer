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

const HAND_ERRORS = {
  denied: 'カメラが許可されていません',
  'no-camera': 'カメラが見つかりません',
  failed: 'カメラを使えませんでした',
};

let catalog = [];
let currentId = null;
// Only the most recent request may update the screen.
let latestRequest = 0;

const ui = createUI({ onSelect: selectBuiltin });
const search = $('search');

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
    onChange: ui.setHandsState,
    onHands: ui.showHands,
    onError: (reason) => ui.toast(HAND_ERRORS[reason]),
  });
$('hands-toggle').onclick = () => hands?.toggle();

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

search.addEventListener('input', () => {
  const matches = matchCatalog(catalog, search.value);
  ui.renderChips(matches.length ? matches : catalog);
});

$('search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const query = search.value.trim();
  if (!query) return;
  const match = matchCatalog(catalog, query)[0];
  if (match) selectBuiltin(match);
  else searchOnline(query);
});

setupVoice($('voice'), (heard) => {
  search.value = heard;
  const match = exactMatch(catalog, heard) || matchCatalog(catalog, heard)[0];
  if (match) selectBuiltin(match);
  else searchOnline(heard);
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

if (import.meta.env.PROD && 'serviceWorker' in navigator && isSecureContext) {
  addEventListener('load', () => {
    navigator.serviceWorker.register(assetURL('sw.js'), { scope: assetURL('') }).catch(() => {});
  });
}
