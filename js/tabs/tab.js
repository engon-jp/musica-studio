// タブ譜タブ: グリッド入力・再生・ASCII出力・印刷（ギター6弦／ベース4弦）

import { resumeCtx, getCtx } from '../audio-engine.js';
import { pluckMidi } from '../synth.js';
import { STANDARD_TUNING, BASS_TUNING, fretForMidi } from '../chord-shapes.js';

const INSTRUMENTS = {
  guitar: { label: 'ギター（6弦）', tuning: STANDARD_TUNING, labels: ['e', 'B', 'G', 'D', 'A', 'E'] },
  bass: { label: 'ベース（4弦）', tuning: BASS_TUNING, labels: ['G', 'D', 'A', 'E'] },
};
const STEPS_PER_BAR = 16; // 16分音符

let panel;
let instrument = 'guitar';
let bars = 2;
let cells = {}; // "step:stringIdx"(0=最低音弦) → fret
let selected = null;
let typeBuf = '';
let typeTimer = null;
let playing = null;

const totalSteps = () => bars * STEPS_PER_BAR;
const inst = () => INSTRUMENTS[instrument];
const nStrings = () => inst().tuning.length;

export function init(el) {
  panel = el;
  panel.innerHTML = `
    <div class="card no-print">
      <div class="row">
        <select id="tb-inst">${Object.entries(INSTRUMENTS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
        <button class="btn primary" id="tb-play">▶ 再生</button>
        <label>BPM <input type="number" id="tb-bpm" value="100" min="40" max="240"></label>
        <button class="btn small" id="tb-add-bar">＋小節</button>
        <button class="btn small" id="tb-del-bar">−小節</button>
        <button class="btn small danger" id="tb-clear">全消去</button>
      </div>
      <div class="row">
        <label>フレット:</label>
        <div id="tb-frets" class="row" style="gap:4px">
          ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((f) => `<button class="btn small" data-fret="${f}">${f}</button>`).join('')}
          <button class="btn small danger" data-fret="-1">✕消</button>
        </div>
      </div>
      <p class="hint" id="tb-hint">マスを選択してフレット番号ボタン（またはキーボードの数字）で入力。PCでは0〜24を直接タイプ、Backspaceで削除。</p>
    </div>
    <div class="card">
      <div class="tab-grid-wrap"><table class="tab-grid" id="tb-grid"></table></div>
    </div>
    <div class="card">
      <div class="row no-print">
        <button class="btn small" id="tb-copy">ASCIIタブをコピー</button>
        <button class="btn small" id="tb-print">🖨 印刷</button>
      </div>
      <pre class="ascii-tab" id="tb-ascii"></pre>
    </div>
  `;

  const $ = (s) => panel.querySelector(s);
  $('#tb-inst').addEventListener('change', (e) => switchInstrument(e.target.value));
  $('#tb-play').addEventListener('click', togglePlay);
  $('#tb-add-bar').addEventListener('click', () => { bars = Math.min(32, bars + 1); refresh(); });
  $('#tb-del-bar').addEventListener('click', () => {
    bars = Math.max(1, bars - 1);
    for (const k of Object.keys(cells)) if (Number(k.split(':')[0]) >= totalSteps()) delete cells[k];
    refresh();
  });
  $('#tb-clear').addEventListener('click', () => { if (confirm('全て消去しますか？')) { cells = {}; refresh(); } });
  panel.querySelectorAll('#tb-frets button').forEach((b) =>
    b.addEventListener('click', () => setFret(Number(b.dataset.fret)))
  );
  $('#tb-copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(ascii());
    $('#tb-copy').textContent = 'コピーした ✓';
    setTimeout(() => { $('#tb-copy').textContent = 'ASCIIタブをコピー'; }, 1200);
  });
  $('#tb-print').addEventListener('click', () => window.print());

  document.addEventListener('keydown', onKey);
  load();
  refresh();
}

function switchInstrument(next, force = false) {
  if (next === instrument) return;
  if (!force && Object.keys(cells).length > 0 && !confirm('楽器を切り替えると現在の入力を消去します。よいですか？')) {
    panel.querySelector('#tb-inst').value = instrument;
    return;
  }
  instrument = next;
  cells = {};
  selected = null;
  panel.querySelector('#tb-inst').value = instrument;
  refresh();
}

// 耳コピタブの「ベースライン」受信: notes = [{midi, startBeat, beats}]
export function receive(key, value) {
  if (key !== 'bassline') return;
  instrument = 'bass';
  panel.querySelector('#tb-inst').value = 'bass';
  cells = {};
  selected = null;
  const maxStep = Math.max(...value.notes.map((n) => (n.startBeat + n.beats) * 4), STEPS_PER_BAR);
  bars = Math.min(32, Math.max(1, Math.ceil(maxStep / STEPS_PER_BAR)));
  let placed = 0;
  for (const n of value.notes) {
    // ベース音域に収める（オクターブ誤検出の補正）
    let m = n.midi;
    while (m > BASS_TUNING[3] + 12) m -= 12;
    while (m < BASS_TUNING[0]) m += 12;
    const pos = fretForMidi(m, BASS_TUNING);
    if (!pos) continue;
    const step = Math.round(n.startBeat * 4);
    if (step >= totalSteps()) continue;
    cells[`${step}:${pos.string}`] = pos.fret;
    placed++;
  }
  if (value.bpm) panel.querySelector('#tb-bpm').value = value.bpm;
  refresh();
  panel.querySelector('#tb-hint').textContent =
    `ベースライン ${placed} 音を配置しました（自動採譜は候補です。拍のアタマ単位・最低ポジション運指）。マスをタップして修正できます`;
}

function persist() {
  localStorage.setItem('ms-tab', JSON.stringify({ bars, cells, instrument }));
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem('ms-tab'));
    if (d && d.cells && Object.keys(d.cells).length > 0) {
      bars = d.bars || 2;
      cells = d.cells;
      instrument = d.instrument || 'guitar';
      panel.querySelector('#tb-inst').value = instrument;
      return;
    }
  } catch { /* 初回 */ }
  seedDemo();
}

// 初回起動時のデモ: きらきら星の単音メロディ（ギター）
function seedDemo() {
  instrument = 'guitar';
  bars = 4;
  cells = {};
  const seq = [
    [0, 4, 1], [4, 4, 1], [8, 5, 3], [12, 5, 3], [16, 5, 5], [20, 5, 5], [24, 5, 3],
    [32, 5, 1], [36, 5, 1], [40, 5, 0], [44, 5, 0], [48, 4, 3], [52, 4, 3], [56, 4, 1],
  ];
  for (const [step, str, fret] of seq) cells[`${step}:${str}`] = fret;
}

function refresh() {
  persist();
  buildGrid();
  panel.querySelector('#tb-ascii').textContent = ascii();
}

// ---- グリッド ----

function buildGrid() {
  const tbl = panel.querySelector('#tb-grid');
  const n = totalSteps();
  const ns = nStrings();
  let html = '<tr><th></th>';
  for (let s = 0; s < n; s++) html += `<th>${s % 4 === 0 ? s / 4 + 1 : ''}</th>`;
  html += '</tr>';
  for (let row = 0; row < ns; row++) {
    const str = ns - 1 - row;
    html += `<tr><th>${inst().labels[row]}</th>`;
    for (let s = 0; s < n; s++) {
      const v = cells[`${s}:${str}`];
      const cls = [s % 4 === 0 ? 'beat-start' : '', selected && selected.step === s && selected.str === str ? 'active' : ''].join(' ');
      html += `<td class="${cls}" data-step="${s}" data-str="${str}">${v ?? ''}</td>`;
    }
    html += '</tr>';
  }
  tbl.innerHTML = html;
  tbl.querySelectorAll('td').forEach((td) =>
    td.addEventListener('click', () => {
      selected = { step: Number(td.dataset.step), str: Number(td.dataset.str) };
      buildGrid();
    })
  );
}

function setFret(f) {
  if (!selected) return;
  const key = `${selected.step}:${selected.str}`;
  if (f < 0) delete cells[key];
  else {
    cells[key] = f;
    resumeCtx().then(() => pluckMidi(inst().tuning[selected.str] + f, 0, { gain: 0.4, dur: 1.4 }));
  }
  refresh();
}

function onKey(e) {
  if (!selected || panel.hidden || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (e.key >= '0' && e.key <= '9') {
    typeBuf += e.key;
    clearTimeout(typeTimer);
    const commit = () => {
      const f = Math.min(24, Number(typeBuf));
      typeBuf = '';
      setFret(f);
    };
    if (Number(typeBuf) > 2 || typeBuf.length >= 2) commit();
    else typeTimer = setTimeout(commit, 500);
    e.preventDefault();
  } else if (e.key === 'Backspace' || e.key === 'Delete') {
    setFret(-1);
    e.preventDefault();
  } else if (e.key.startsWith('Arrow')) {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    selected = {
      step: Math.max(0, Math.min(totalSteps() - 1, selected.step + d[0])),
      str: Math.max(0, Math.min(nStrings() - 1, selected.str + d[1])),
    };
    buildGrid();
    e.preventDefault();
  }
}

// ---- 再生 ----

async function togglePlay() {
  const btn = panel.querySelector('#tb-play');
  if (playing) { stopPlay(); return; }
  await resumeCtx();
  const ctx = getCtx();
  const bpm = Number(panel.querySelector('#tb-bpm').value) || 100;
  const stepDur = 60 / bpm / 4;
  const t0 = ctx.currentTime + 0.1;
  const n = totalSteps();
  for (let s = 0; s < n; s++) {
    for (let str = 0; str < nStrings(); str++) {
      const f = cells[`${s}:${str}`];
      if (f !== undefined) {
        pluckMidi(inst().tuning[str] + f, t0 + s * stepDur, {
          gain: instrument === 'bass' ? 0.5 : 0.35,
          dur: instrument === 'bass' ? 2 : 1.5,
        });
      }
    }
  }
  playing = { t0, stepDur, n };
  btn.textContent = '⏹ 停止';
  const tick = () => {
    if (!playing) return;
    playing.raf = requestAnimationFrame(tick);
    const cur = Math.floor((getCtx().currentTime - playing.t0) / playing.stepDur);
    panel.querySelectorAll('#tb-grid td').forEach((td) =>
      td.classList.toggle('playing', Number(td.dataset.step) === cur)
    );
    if (cur > playing.n) stopPlay();
  };
  tick();
}

function stopPlay() {
  if (playing?.raf) cancelAnimationFrame(playing.raf);
  playing = null;
  panel.querySelector('#tb-play').textContent = '▶ 再生';
  panel.querySelectorAll('#tb-grid td.playing').forEach((td) => td.classList.remove('playing'));
}

// ---- ASCII 出力 ----

function ascii() {
  const n = totalSteps();
  const ns = nStrings();
  const lines = [];
  for (let row = 0; row < ns; row++) {
    const str = ns - 1 - row;
    let line = inst().labels[row] + '|';
    for (let s = 0; s < n; s++) {
      const v = cells[`${s}:${str}`];
      line += v === undefined ? '---' : String(v).padEnd(2, '-') + '-';
      if ((s + 1) % STEPS_PER_BAR === 0) line += '|';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export function deactivate() {
  stopPlay();
  persist();
}
