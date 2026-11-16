import qrcode from 'qrcode-generator';
import { BLURBS } from './blurbs.js';
import { element } from './elements.js';
import { CONFIG } from './config.js';

export const $ = (id) => document.getElementById(id);

function node(tag, text = '', className = '') {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

/** "C8H10N4O2" with the digits as subscripts. */
function formulaNodes(formula) {
  return (String(formula).match(/\d+|\D+/g) || []).map((part) =>
    /^\d+$/.test(part) ? node('sub', part) : document.createTextNode(part),
  );
}

function legendNodes(atoms) {
  const counts = new Map();
  for (const atom of atoms) counts.set(atom.el, (counts.get(atom.el) || 0) + 1);
  return [...counts].map(([symbol, count]) => {
    const item = node('li');
    const dot = node('i');
    dot.style.background = dot.style.color = element(symbol).color;
    item.append(dot, node('b', symbol), String(count));
    return item;
  });
}

export function createUI({ onSelect }) {
  const info = $('info');
  const watermark = $('watermark');
  const status = $('status');
  const panel = $('panel');
  let activeId = null;
  let statusTimer = 0;

  function toast(message) {
    clearTimeout(statusTimer);
    status.textContent = message;
    status.classList.toggle('show', Boolean(message));
    if (message) statusTimer = setTimeout(() => status.classList.remove('show'), 4000);
  }

  function renderChips(items) {
    $('chips').replaceChildren(
      ...items.map((item) => {
        const chip = node('button', item.ja);
        chip.type = 'button';
        chip.dataset.id = item.id;
        chip.setAttribute('aria-pressed', String(item.id === activeId));
        chip.onclick = () => onSelect(item);
        return chip;
      }),
    );
  }

  function markActiveChip() {
    for (const chip of $('chips').children) {
      const active = chip.dataset.id === activeId;
      chip.setAttribute('aria-pressed', String(active));
      if (active) chip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }

  function showMolecule(item) {
    activeId = item.id;
    // Hide the old text at once, then let the new text rise in with the molecule.
    info.classList.add('swap');
    watermark.classList.add('swap');
    void info.offsetWidth;

    $('molecule-name').textContent = item.ja;
    $('molecule-en').textContent = item.en;
    $('formula').replaceChildren(...formulaNodes(item.formula));
    $('weight').textContent = `${item.weight} g/mol`;
    $('blurb').textContent = BLURBS[item.id] || '';
    $('legend').replaceChildren(...legendNodes(item.structure.atoms));
    info.classList.toggle('long', item.ja.length >= 7);
    watermark.textContent = item.en;
    watermark.style.setProperty('--letters', Math.max(5, item.en.length));

    info.classList.remove('swap');
    watermark.classList.remove('swap');
    markActiveChip();
  }

  function openPanel(...children) {
    $('panel-content').replaceChildren(...children);
    panel.showModal();
  }
  $('panel-close').onclick = () => panel.close();
  panel.addEventListener('click', (event) => {
    if (event.target === panel) panel.close();
  });

  $('qr-open').onclick = () => {
    const url = new URL(location.href);
    url.searchParams.set('m', activeId || 'caffeine');
    const qr = qrcode(0, 'M');
    qr.addData(url.href);
    qr.make();
    const code = node('div', '', 'qr');
    code.innerHTML = qr.createSvgTag({ scalable: true, margin: 0 });
    openPanel(node('h2', 'スマホで開く'), code);
  };

  $('about-open').onclick = () => {
    const credit = node('p', '構造データ：', 'credit');
    const source = node('a', 'PubChem');
    source.href = 'https://pubchem.ncbi.nlm.nih.gov/';
    const licences = node('a', 'ライセンス');
    licences.href = './licenses.txt';
    for (const link of [source, licences]) {
      link.target = '_blank';
      link.rel = 'noopener';
    }
    credit.append(source, '　', licences);

    const children = [
      node('h2', 'てのひら分子'),
      node(
        'p',
        '分子の名前を入れると、その形が立体で現れます。カメラに手をかざすと、つまんで回せます。',
      ),
      node('p', 'このアプリはAIに頼んで作りました。'),
    ];
    if (CONFIG.workshop.trim()) children.push(node('p', CONFIG.workshop.trim(), 'workshop'));
    openPanel(...children, credit);
  };

  /** Reflects the state of hand control: 'off' | 'starting' | 'on'. */
  function setHandsState(state) {
    const button = $('hands-toggle');
    button.dataset.state = state;
    button.setAttribute('aria-pressed', String(state !== 'off'));
    $('hands-text').textContent = { off: '手で動かす', starting: '準備中', on: '手で操作中' }[
      state
    ];
    $('camera-panel').hidden = state === 'off';
  }

  /** Draws a ring on the stage for each detected hand; it shrinks while pinching. */
  function showHands(hands) {
    const layer = $('reticles');
    while (layer.children.length < hands.length) layer.append(node('i'));
    while (layer.children.length > hands.length) layer.lastChild.remove();
    hands.forEach((hand, i) => {
      const ring = layer.children[i];
      ring.style.transform = `translate(${hand.x * innerWidth}px, ${hand.y * innerHeight}px)`;
      ring.classList.toggle('pinched', hand.pinched);
    });
  }

  function showUnsupported() {
    document.body.append(node('p', 'このブラウザでは3D表示ができません。', 'unsupported'));
    $('hands-toggle').disabled = true;
  }

  return { toast, renderChips, showMolecule, setHandsState, showHands, showUnsupported, panel };
}
