// コードタブ: コード譜エディタ（[C]歌詞 記法）・移調・カポ提案・ダイアグラム・再生

import { parseChord, transposeChord, chordTones, pcName } from '../theory.js';
import { getShape, shapeToMidis, capoSuggestions, STANDARD_TUNING } from '../chord-shapes.js';
import { strum } from '../synth.js';
import { resumeCtx, getCtx } from '../audio-engine.js';

// サンプル曲（歌詞・旋律とも著作権保護期間満了のもののみ）
const SAMPLE_SONGS = [
  {
    id: 'sample-furusato',
    title: '故郷（ふるさと）',
    transpose: 0,
    capo: 0,
    text: `[C]兎追いし [F]かの[C]山
[C]小鮒釣りし [G7]かの[C]川
[F]夢は[C]今も めぐ[G7]りて
[C]忘れ[F]がたき [G7]故[C]郷

[C]如何にいます [F]父[C]母
[C]恙なしや [G7]友が[C]き
[F]雨に[C]風に つけ[G7]ても
[C]思い[F]出づる [G7]故[C]郷`,
  },
  {
    id: 'sample-akatombo',
    title: '赤とんぼ 〜カポ提案のデモ',
    transpose: 0,
    capo: 0,
    text: `[Eb]夕焼小焼の [Ab]赤と[Eb]んぼ
[Cm]負われて見たのは [Bb7]いつの[Eb]日か

※E♭キーはバレーコードだらけ。下の「カポ位置の提案」を見ると
　カポ1で D・G・Bm・A7、カポ3で C・F・Am・G7 などの
　楽なフォームに変わります（好きな行をタップ！）`,
  },
  {
    id: 'sample-amazing-grace',
    title: 'Amazing Grace 〜移調のデモ',
    transpose: 0,
    capo: 0,
    text: `[G]Amazing [G7]grace! How [C]sweet the [G]sound
That [G]saved a [Em]wretch like [D]me!
[G]I once was [G7]lost, but [C]now am [G]found,
Was [Em]blind, but [D]now I [G]see.

※「♭−1 / ♯＋1」で自分の声に合うキーへ。
　「移調をテキストに反映」で歌詞ごと書き換えもできます`,
  },
  {
    id: 'sample-canon',
    title: 'カノン進行 〜再生のデモ',
    transpose: 0,
    capo: 0,
    text: `[C] [G] [Am] [Em] [F] [C] [F] [G]

「▶ コード進行を再生」でギター音のストラムが流れます。
下のコードダイアグラムをタップしても1つずつ鳴ります`,
  },
];

let panel;
let state = {
  songId: 'sample-furusato',
  title: SAMPLE_SONGS[0].title,
  text: SAMPLE_SONGS[0].text,
  transpose: 0,
  capo: 0,
  flat: false,
};
let playTimer = null;
let renderTimer = null;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function init(el) {
  panel = el;
  panel.innerHTML = `
    <div class="card">
      <div class="row">
        <select id="ch-songs" style="max-width: 180px"></select>
        <button class="btn small" id="ch-new">＋新規</button>
        <button class="btn small primary" id="ch-save">保存</button>
        <button class="btn small danger" id="ch-del">削除</button>
        <button class="btn small" id="ch-export">書き出し</button>
        <button class="btn small" id="ch-import">読み込み</button>
        <input type="file" id="ch-import-file" accept=".json" hidden>
      </div>
    </div>
    <div class="card">
      <div class="row">
        <input type="text" id="ch-title" placeholder="曲名" style="flex:1; min-width: 160px">
      </div>
      <div class="row">
        <textarea id="ch-text" placeholder="[C]歌詞の途中に[G]コードを[Am]書きます"></textarea>
      </div>
      <p class="hint">記法: 歌詞の中にコードを [C] [G/B] [F#m7] のように書く。コードだけの行もOK。</p>
    </div>
    <div class="card">
      <div class="row">
        <label>移調</label>
        <button class="btn small" id="ch-tr-down">♭ −1</button>
        <span id="ch-tr-val" style="min-width:3em; text-align:center; font-weight:700">0</span>
        <button class="btn small" id="ch-tr-up">♯ ＋1</button>
        <button class="btn small" id="ch-tr-reset">リセット</button>
        <span class="chip" id="ch-flat">♭表記</span>
        <label style="margin-left:8px">カポ表示
          <select id="ch-capo">${[0, 1, 2, 3, 4, 5, 6, 7].map((c) => `<option value="${c}">${c === 0 ? 'なし' : 'カポ' + c}</option>`).join('')}</select>
        </label>
        <button class="btn small" id="ch-apply">移調をテキストに反映</button>
      </div>
    </div>
    <div class="card">
      <div class="row" style="justify-content: space-between">
        <h2 style="margin:0" id="ch-sheet-title"></h2>
        <button class="btn small" id="ch-play">▶ コード進行を再生</button>
      </div>
      <div id="ch-sheet" style="margin-top:8px"></div>
    </div>
    <div class="card">
      <h2>使用コード（タップで音が鳴ります）</h2>
      <div class="chord-diagrams" id="ch-diagrams"></div>
    </div>
    <div class="card">
      <h2>カポ位置の提案</h2>
      <div style="overflow-x:auto"><table class="capo-table" id="ch-capo-table"></table></div>
      <p class="hint">★はコードフォームの押さえやすさ。行をタップするとそのカポ表示に切り替わります。</p>
    </div>
  `;

  seedSamples();
  loadCurrent();
  refreshSongSelect();
  bind();
  render();
}

function bind() {
  const $ = (id) => panel.querySelector(id);
  $('#ch-title').addEventListener('input', (e) => { state.title = e.target.value; });
  $('#ch-text').addEventListener('input', (e) => {
    state.text = e.target.value;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 250);
  });
  $('#ch-tr-up').addEventListener('click', () => { state.transpose++; render(); });
  $('#ch-tr-down').addEventListener('click', () => { state.transpose--; render(); });
  $('#ch-tr-reset').addEventListener('click', () => { state.transpose = 0; render(); });
  $('#ch-flat').addEventListener('click', () => {
    state.flat = !state.flat;
    $('#ch-flat').classList.toggle('active', state.flat);
    render();
  });
  $('#ch-capo').addEventListener('change', (e) => { state.capo = Number(e.target.value); render(); });
  $('#ch-apply').addEventListener('click', applyTranspose);
  $('#ch-play').addEventListener('click', togglePlay);
  $('#ch-new').addEventListener('click', newSong);
  $('#ch-save').addEventListener('click', saveSong);
  $('#ch-del').addEventListener('click', deleteSong);
  $('#ch-export').addEventListener('click', exportSongs);
  $('#ch-import').addEventListener('click', () => $('#ch-import-file').click());
  $('#ch-import-file').addEventListener('change', importSongs);
  $('#ch-songs').addEventListener('change', (e) => selectSong(e.target.value));
}

// ---- 曲の保存管理 ----

const loadSongs = () => JSON.parse(localStorage.getItem('ms-songs') || '[]');
const saveSongs = (s) => localStorage.setItem('ms-songs', JSON.stringify(s));
const persistCurrent = () => localStorage.setItem('ms-chords-current', JSON.stringify(state));

// 初回起動時にサンプル曲を登録（既存の曲がある場合は何もしない）
function seedSamples() {
  if (loadSongs().length === 0) saveSongs(SAMPLE_SONGS.map((s) => ({ ...s })));
}

function loadCurrent() {
  try {
    const saved = JSON.parse(localStorage.getItem('ms-chords-current'));
    // 旧バージョンの初期サンプルが残っていたら新サンプルに差し替え
    if (saved && typeof saved.text === 'string' && !saved.text.startsWith('[C]ドドソソ')) {
      state = { ...state, ...saved };
    }
  } catch { /* 初回 */ }
  panel.querySelector('#ch-title').value = state.title;
  panel.querySelector('#ch-text').value = state.text;
  panel.querySelector('#ch-capo').value = String(state.capo);
  panel.querySelector('#ch-flat').classList.toggle('active', state.flat);
}

function refreshSongSelect() {
  const sel = panel.querySelector('#ch-songs');
  const songs = loadSongs();
  sel.innerHTML = `<option value="">— 保存済みの曲 —</option>` +
    songs.map((s) => `<option value="${s.id}" ${s.id === state.songId ? 'selected' : ''}>${esc(s.title)}</option>`).join('');
}

function selectSong(id) {
  if (!id) return;
  const song = loadSongs().find((s) => s.id === id);
  if (!song) return;
  state = { ...state, songId: song.id, title: song.title, text: song.text, transpose: song.transpose || 0, capo: song.capo || 0 };
  panel.querySelector('#ch-title').value = state.title;
  panel.querySelector('#ch-text').value = state.text;
  panel.querySelector('#ch-capo').value = String(state.capo);
  render();
}

function newSong() {
  state = { ...state, songId: null, title: '', text: '', transpose: 0, capo: 0 };
  panel.querySelector('#ch-title').value = '';
  panel.querySelector('#ch-text').value = '';
  refreshSongSelect();
  render();
}

function saveSong() {
  const songs = loadSongs();
  if (!state.title.trim()) state.title = '無題 ' + new Date().toLocaleString('ja-JP');
  panel.querySelector('#ch-title').value = state.title;
  if (state.songId) {
    const i = songs.findIndex((s) => s.id === state.songId);
    if (i >= 0) songs[i] = { ...songs[i], title: state.title, text: state.text, transpose: state.transpose, capo: state.capo };
  } else {
    state.songId = 'song-' + Date.now();
    songs.push({ id: state.songId, title: state.title, text: state.text, transpose: state.transpose, capo: state.capo });
  }
  saveSongs(songs);
  refreshSongSelect();
  flashButton('#ch-save', '保存した ✓');
}

function deleteSong() {
  if (!state.songId) return;
  if (!confirm(`「${state.title}」を削除しますか？`)) return;
  saveSongs(loadSongs().filter((s) => s.id !== state.songId));
  newSong();
}

function exportSongs() {
  const blob = new Blob([JSON.stringify(loadSongs(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'musica-studio-songs.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importSongs(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const incoming = JSON.parse(await file.text());
    if (!Array.isArray(incoming)) throw new Error('形式が違います');
    const songs = loadSongs();
    for (const s of incoming) {
      if (!s.id || !songs.some((x) => x.id === s.id)) songs.push({ ...s, id: s.id || 'song-' + Math.random().toString(36).slice(2) });
    }
    saveSongs(songs);
    refreshSongSelect();
    flashButton('#ch-import', `${incoming.length}曲読込 ✓`);
  } catch (err) {
    alert('読み込み失敗: ' + err.message);
  }
  e.target.value = '';
}

function flashButton(id, text) {
  const btn = panel.querySelector(id);
  const orig = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = orig; }, 1200);
}

// ---- 表示 ----

// 表示用コード（移調・カポフォーム反映）
function displayChord(raw) {
  const ok = parseChord(raw) !== null;
  if (!ok) return { ok, text: raw };
  return { ok, text: transposeChord(raw, state.transpose - state.capo, state.flat || null) };
}

// テキスト中の全コードトークン（出現順・移調後の実音キー）
function chordSequence() {
  const seq = [];
  const re = /\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(state.text))) {
    if (parseChord(m[1])) seq.push(transposeChord(m[1], state.transpose, state.flat || null));
  }
  return seq;
}

function render() {
  persistCurrent();
  panel.querySelector('#ch-tr-val').textContent = (state.transpose > 0 ? '+' : '') + state.transpose;

  // シート
  const titleEl = panel.querySelector('#ch-sheet-title');
  titleEl.textContent = (state.title || '（無題）') + (state.capo > 0 ? ` — カポ${state.capo}表示` : '');
  panel.querySelector('#ch-sheet').innerHTML = renderSheet();

  // ダイアグラム
  const uniq = [...new Set(chordSequence().map((c) => transposeChord(c, -state.capo, state.flat || null)))];
  panel.querySelector('#ch-diagrams').innerHTML = uniq.map(diagramHtml).join('') || '<p class="hint">コードがまだありません</p>';
  panel.querySelectorAll('#ch-diagrams figure').forEach((fig) =>
    fig.addEventListener('click', async () => {
      await resumeCtx();
      playChordSymbol(fig.dataset.chord);
    })
  );

  // カポ提案
  renderCapoTable();
}

function renderSheet() {
  const lines = state.text.split('\n');
  return lines.map((line) => {
    if (!line.trim()) return '<div class="sheet-space"></div>';
    const re = /\[([^\]]*)\]/g;
    const parts = [];
    let last = 0, pending = null, m;
    while ((m = re.exec(line))) {
      const chunk = line.slice(last, m.index);
      if (chunk || pending !== null) parts.push({ chord: pending, text: chunk });
      pending = m[1];
      last = re.lastIndex;
    }
    parts.push({ chord: pending, text: line.slice(last) });

    if (parts.length === 1 && parts[0].chord === null) {
      return `<div class="lyric-only">${esc(line)}</div>`;
    }
    const segs = parts.map((p) => {
      let c = '';
      if (p.chord !== null) {
        const d = displayChord(p.chord);
        c = d.ok ? esc(d.text) : `<span class="bad">${esc(p.chord)}?</span>`;
      }
      return `<span class="seg"><span class="c">${c}</span><span class="t">${esc(p.text) || ' '}</span></span>`;
    });
    return `<div class="cline">${segs.join('')}</div>`;
  }).join('');
}

// ---- ダイアグラム ----

function diagramHtml(symbol) {
  const shape = getShape(symbol);
  const svg = shape ? chordSVG(shape) : `<div style="width:96px;height:112px;display:flex;align-items:center;justify-content:center" class="hint">${
    (chordTones(symbol) || []).map((pc) => pcName(pc, state.flat)).join('·') || '?'
  }</div>`;
  return `<figure data-chord="${esc(symbol)}" style="cursor:pointer">${svg}<figcaption>${esc(symbol)}</figcaption></figure>`;
}

function chordSVG(shape) {
  const played = shape.frets.filter((f) => f > 0);
  const maxF = Math.max(...played, 1);
  const minF = Math.min(...played.filter((f) => f > 0).length ? played : [1]);
  const baseFret = maxF <= 4 ? 1 : minF;
  const nFrets = Math.max(4, maxF - baseFret + 1);
  const W = 96, H = 96 + 22;
  const x0 = 16, xStep = (W - 30) / 5;
  const y0 = 24, yStep = (H - 32) / nFrets;
  let s = '';

  // フレット線・弦
  for (let f = 0; f <= nFrets; f++) {
    s += `<line x1="${x0}" y1="${y0 + f * yStep}" x2="${x0 + 5 * xStep}" y2="${y0 + f * yStep}" stroke="var(--text-dim)" stroke-width="1"/>`;
  }
  if (baseFret === 1) s += `<rect x="${x0 - 1}" y="${y0 - 3}" width="${5 * xStep + 2}" height="3.5" fill="var(--text)"/>`;
  else s += `<text x="${x0 - 12}" y="${y0 + yStep * 0.65}" fill="var(--text-dim)" font-size="11">${baseFret}</text>`;
  for (let i = 0; i < 6; i++) {
    s += `<line x1="${x0 + i * xStep}" y1="${y0}" x2="${x0 + i * xStep}" y2="${y0 + nFrets * yStep}" stroke="var(--text-dim)" stroke-width="1"/>`;
  }

  // バレー
  for (const b of shape.barres || []) {
    const rel = b.fret - baseFret + 1;
    if (rel < 1) continue;
    const y = y0 + (rel - 0.5) * yStep;
    s += `<rect x="${x0 + b.from * xStep - 5}" y="${y - 5}" width="${(b.to - b.from) * xStep + 10}" height="10" rx="5" fill="var(--accent)"/>`;
  }

  // 押弦・開放・ミュート
  shape.frets.forEach((f, i) => {
    const x = x0 + i * xStep;
    if (f === -1) s += `<text x="${x}" y="${y0 - 8}" fill="var(--text-dim)" font-size="11" text-anchor="middle">✕</text>`;
    else if (f === 0) s += `<circle cx="${x}" cy="${y0 - 11}" r="4" fill="none" stroke="var(--text-dim)" stroke-width="1.5"/>`;
    else {
      const inBarre = (shape.barres || []).some((b) => b.fret === f && i >= b.from && i <= b.to);
      if (!inBarre) {
        const rel = f - baseFret + 1;
        s += `<circle cx="${x}" cy="${y0 + (rel - 0.5) * yStep}" r="6" fill="var(--accent)"/>`;
      }
    }
  });

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${s}</svg>`;
}

function playChordSymbol(symbol) {
  const shape = getShape(symbol);
  if (shape) {
    strum(shapeToMidis(shape, state.capo));
  } else {
    const tones = chordTones(symbol);
    if (tones) {
      const rootMidi = 48 + ((tones[0] - 0 + 12) % 12);
      const midis = tones.map((pc, i) => rootMidi + (((pc - tones[0]) % 12) + 12) % 12 + (i > 0 && pc < tones[0] ? 12 : 0));
      strum(midis);
    }
  }
}

// ---- コード進行の再生 ----

async function togglePlay() {
  const btn = panel.querySelector('#ch-play');
  if (playTimer) {
    clearTimeout(playTimer);
    playTimer = null;
    btn.textContent = '▶ コード進行を再生';
    return;
  }
  const seq = chordSequence().map((c) => transposeChord(c, -state.capo, state.flat || null));
  if (seq.length === 0) return;
  await resumeCtx();
  let i = 0;
  const beat = (60 / 88) * 2 * 1000; // 88bpm・2拍ごと
  const step = () => {
    if (i >= seq.length) {
      btn.textContent = '▶ コード進行を再生';
      playTimer = null;
      return;
    }
    playChordSymbol(seq[i]);
    btn.textContent = `⏹ 停止（${i + 1}/${seq.length}: ${seq[i]}）`;
    i++;
    playTimer = setTimeout(step, beat);
  };
  step();
}

// ---- カポ提案 ----

function renderCapoTable() {
  const seq = chordSequence();
  const table = panel.querySelector('#ch-capo-table');
  if (seq.length === 0) { table.innerHTML = ''; return; }
  const rows = capoSuggestions(seq);
  const bestScore = Math.max(...rows.map((r) => r.score));
  table.innerHTML =
    '<tr><th>カポ</th><th>フォーム</th><th>押さえやすさ</th></tr>' +
    rows.map((r) => {
      const stars = '★'.repeat(Math.round(r.score / 2)) || '☆';
      const best = r.score === bestScore ? ' class="best"' : '';
      return `<tr${best} data-capo="${r.capo}" style="cursor:pointer"><td>${r.capo === 0 ? 'なし' : r.capo}</td><td>${r.chords.map(esc).join('  ')}</td><td>${stars} <span class="hint">${r.score.toFixed(1)}</span></td></tr>`;
    }).join('');
  table.querySelectorAll('tr[data-capo]').forEach((tr) =>
    tr.addEventListener('click', () => {
      state.capo = Number(tr.dataset.capo);
      panel.querySelector('#ch-capo').value = String(state.capo);
      render();
    })
  );
}

// ---- 移調のテキスト反映 ----

function applyTranspose() {
  if (state.transpose === 0) return;
  state.text = state.text.replace(/\[([^\]]*)\]/g, (whole, c) =>
    parseChord(c) ? `[${transposeChord(c, state.transpose, state.flat || null)}]` : whole
  );
  state.transpose = 0;
  panel.querySelector('#ch-text').value = state.text;
  render();
}

// 耳コピタブの「コード進行解析」からの受信
export function receive(key, value) {
  if (key !== 'analyzed') return;
  state = { ...state, songId: null, title: value.title, text: value.text, transpose: 0, capo: 0 };
  panel.querySelector('#ch-title').value = state.title;
  panel.querySelector('#ch-text').value = state.text;
  panel.querySelector('#ch-capo').value = '0';
  refreshSongSelect();
  render();
}

export function deactivate() {
  if (playTimer) {
    clearTimeout(playTimer);
    playTimer = null;
    const btn = panel.querySelector('#ch-play');
    if (btn) btn.textContent = '▶ コード進行を再生';
  }
  persistCurrent();
}
