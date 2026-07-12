// 音楽理論ユーティリティ（純関数のみ・DOM非依存 — Node テスト対象）

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function midiToFreq(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidiFloat(freq, a4 = 440) {
  return 69 + 12 * Math.log2(freq / a4);
}

export function pcName(pc, useFlat = false) {
  return (useFlat ? FLAT_NAMES : SHARP_NAMES)[((pc % 12) + 12) % 12];
}

export function midiToName(midi, useFlat = false) {
  const oct = Math.floor(midi / 12) - 1;
  return pcName(midi, useFlat) + oct;
}

export function noteToPc(name) {
  const m = /^([A-G])([#b]?)/.exec(name);
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  return (base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

// 周波数 → 最寄りの音とセントずれ
export function freqToNote(freq, a4 = 440, useFlat = false) {
  const mf = freqToMidiFloat(freq, a4);
  const midi = Math.round(mf);
  return { midi, name: midiToName(midi, useFlat), cents: (mf - midi) * 100 };
}

// ---- コード ----

export const CHORD_QUALITIES = {
  '': [0, 4, 7],
  'm': [0, 3, 7],
  '7': [0, 4, 7, 10],
  'maj7': [0, 4, 7, 11],
  'm7': [0, 3, 7, 10],
  'mmaj7': [0, 3, 7, 11],
  '6': [0, 4, 7, 9],
  'm6': [0, 3, 7, 9],
  '9': [0, 4, 7, 10, 14],
  'maj9': [0, 4, 7, 11, 14],
  'm9': [0, 3, 7, 10, 14],
  'add9': [0, 4, 7, 14],
  'madd9': [0, 3, 7, 14],
  'sus4': [0, 5, 7],
  'sus2': [0, 2, 7],
  '7sus4': [0, 5, 7, 10],
  'dim': [0, 3, 6],
  'dim7': [0, 3, 6, 9],
  'm7b5': [0, 3, 6, 10],
  'aug': [0, 4, 8],
  'aug7': [0, 4, 8, 10],
  '7b9': [0, 4, 7, 10, 13],
  '7#9': [0, 4, 7, 10, 15],
  '11': [0, 4, 7, 10, 14, 17],
  '13': [0, 4, 7, 10, 14, 21],
  '5': [0, 7],
};

const QUALITY_ALIASES = {
  'maj': '', 'M': '', 'M7': 'maj7', '△7': 'maj7', 'Δ7': 'maj7', 'M9': 'maj9',
  'min': 'm', '-': 'm', 'min7': 'm7', '-7': 'm7', 'mM7': 'mmaj7',
  '+': 'aug', '+7': 'aug7', '7#5': 'aug7', 'ø': 'm7b5', 'ø7': 'm7b5',
  'o': 'dim', 'o7': 'dim7', '(add9)': 'add9',
};

export function normalizeQuality(q) {
  if (q in QUALITY_ALIASES) return QUALITY_ALIASES[q];
  return q;
}

// "C#m7/G#" → { root, rootName, quality, qualityRaw, bass, bassName }
export function parseChord(symbol) {
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(String(symbol).trim());
  if (!m) return null;
  const quality = normalizeQuality(m[2] || '');
  if (!(quality in CHORD_QUALITIES)) return null;
  return {
    root: noteToPc(m[1]),
    rootName: m[1],
    quality,
    qualityRaw: m[2] || '',
    bass: m[3] ? noteToPc(m[3]) : null,
    bassName: m[3] || null,
  };
}

// コード構成音（ピッチクラス列。ルートから昇順）
export function chordTones(symbol) {
  const p = parseChord(symbol);
  if (!p) return null;
  return CHORD_QUALITIES[p.quality].map((iv) => (p.root + iv) % 12);
}

// 移調。useFlat=null なら元の表記（#/b）を引き継ぐ
export function transposeChord(symbol, semitones, useFlat = null) {
  const p = parseChord(symbol);
  if (!p) return symbol;
  const flat = useFlat === null ? p.rootName.includes('b') : useFlat;
  const root = pcName(p.root + semitones, flat);
  const bass = p.bassName ? '/' + pcName(p.bass + semitones, flat) : '';
  return root + p.qualityRaw + bass;
}

// ---- キー推定（Krumhansl-Kessler プロファイル相関）----

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a, b) {
  const n = a.length;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

// chroma: 長さ12の強度配列（絶対ピッチクラス、index 0 = C）
export function estimateKey(chroma) {
  const results = [];
  for (let pc = 0; pc < 12; pc++) {
    const rotated = Array.from({ length: 12 }, (_, i) => chroma[(pc + i) % 12]);
    results.push({ tonic: pc, mode: 'major', score: pearson(rotated, KK_MAJOR) });
    results.push({ tonic: pc, mode: 'minor', score: pearson(rotated, KK_MINOR) });
  }
  results.sort((x, y) => y.score - x.score);
  return results[0];
}

// ノート列（{midi, dur}）からキー推定
export function estimateKeyFromNotes(notes) {
  const chroma = new Array(12).fill(0);
  for (const n of notes) chroma[((n.midi % 12) + 12) % 12] += n.dur || 1;
  return estimateKey(chroma);
}

export function keyName(key, useFlat = false) {
  return pcName(key.tonic, useFlat) + (key.mode === 'minor' ? 'm' : '');
}

// ---- スケールとダイアトニックハモリ ----

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

function scaleOf(mode) {
  return mode === 'minor' ? MINOR_SCALE : MAJOR_SCALE;
}

// midi を keyのスケール内の最寄り音に丸め、その度数インデックスとオクターブを返す
function nearestDegree(midi, tonicPc, mode) {
  const scale = scaleOf(mode);
  const pc = (((midi - tonicPc) % 12) + 12) % 12;
  let bestIdx = 0, bestDist = 99;
  for (let i = 0; i < scale.length; i++) {
    const d = Math.min((pc - scale[i] + 12) % 12, (scale[i] - pc + 12) % 12);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  const base = tonicPc + scale[bestIdx];
  const oct = Math.round((midi - base) / 12);
  return { idx: bestIdx, oct };
}

export function snapToScale(midi, tonicPc, mode) {
  const { idx, oct } = nearestDegree(midi, tonicPc, mode);
  return tonicPc + scaleOf(mode)[idx] + 12 * oct;
}

// スケール内で degreeShift 度ずらす（+2 = 3度上, -2 = 3度下, +5 = 6度上, +7/-7 = オクターブ）
export function diatonicShift(midi, tonicPc, mode, degreeShift) {
  const scale = scaleOf(mode);
  const { idx, oct } = nearestDegree(midi, tonicPc, mode);
  const t = idx + degreeShift;
  const newIdx = ((t % 7) + 7) % 7;
  const octShift = Math.floor(t / 7);
  return tonicPc + scale[newIdx] + 12 * (oct + octShift);
}

// ハモリライン生成。notes: [{midi, start, dur}] → 同型の配列
export const HARMONY_PRESETS = {
  'third-up': { label: '3度上', shift: 2 },
  'third-down': { label: '3度下', shift: -2 },
  'sixth-up': { label: '6度上', shift: 5 },
  'sixth-down': { label: '6度下（3度上の1オク下）', shift: -5 },
  'octave-up': { label: 'オクターブ上', shift: 7 },
  'octave-down': { label: 'オクターブ下', shift: -7 },
};

export function generateHarmony(notes, tonicPc, mode, degreeShift) {
  return notes.map((n) => ({
    ...n,
    midi: diatonicShift(n.midi, tonicPc, mode, degreeShift),
  }));
}
