// ギターのコードフォーム辞書（純データ＋純関数・DOM非依存 — Node テスト対象）
// frets: 6弦(低E)→1弦(高e) の押弦。-1=ミュート, 0=開放
// barres: [{fret, from, to}] （from/to は弦インデックス 0=6弦〜5=1弦）
// ease: 弾きやすさ 1〜10（カポ提案のスコアに使用）

import { parseChord, pcName, transposeChord } from './theory.js';

export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4
export const BASS_TUNING = [28, 33, 38, 43]; // E1 A1 D2 G2

// MIDIノートを弦とフレットに割り当てる（最も低いポジション優先。範囲外は null）
export function fretForMidi(midi, tuning, maxFret = 15) {
  let best = null;
  tuning.forEach((open, string) => {
    const fret = midi - open;
    if (fret >= 0 && fret <= maxFret && (!best || fret < best.fret)) best = { string, fret };
  });
  return best;
}

export const OPEN_SHAPES = {
  // メジャー
  'C': { frets: [-1, 3, 2, 0, 1, 0], ease: 10 },
  'D': { frets: [-1, -1, 0, 2, 3, 2], ease: 10 },
  'E': { frets: [0, 2, 2, 1, 0, 0], ease: 10 },
  'F': { frets: [1, 3, 3, 2, 1, 1], barres: [{ fret: 1, from: 0, to: 5 }], ease: 3 },
  'G': { frets: [3, 2, 0, 0, 0, 3], ease: 10 },
  'A': { frets: [-1, 0, 2, 2, 2, 0], ease: 10 },
  'B': { frets: [-1, 2, 4, 4, 4, 2], barres: [{ fret: 2, from: 1, to: 5 }], ease: 3 },
  // マイナー
  'Am': { frets: [-1, 0, 2, 2, 1, 0], ease: 10 },
  'Bm': { frets: [-1, 2, 4, 4, 3, 2], barres: [{ fret: 2, from: 1, to: 5 }], ease: 3 },
  'Cm': { frets: [-1, 3, 5, 5, 4, 3], barres: [{ fret: 3, from: 1, to: 5 }], ease: 3 },
  'Dm': { frets: [-1, -1, 0, 2, 3, 1], ease: 9 },
  'Em': { frets: [0, 2, 2, 0, 0, 0], ease: 10 },
  'Fm': { frets: [1, 3, 3, 1, 1, 1], barres: [{ fret: 1, from: 0, to: 5 }], ease: 3 },
  'F#m': { frets: [2, 4, 4, 2, 2, 2], barres: [{ fret: 2, from: 0, to: 5 }], ease: 3 },
  'Gm': { frets: [3, 5, 5, 3, 3, 3], barres: [{ fret: 3, from: 0, to: 5 }], ease: 3 },
  // 7th
  'A7': { frets: [-1, 0, 2, 0, 2, 0], ease: 10 },
  'B7': { frets: [-1, 2, 1, 2, 0, 2], ease: 7 },
  'C7': { frets: [-1, 3, 2, 3, 1, 0], ease: 8 },
  'D7': { frets: [-1, -1, 0, 2, 1, 2], ease: 9 },
  'E7': { frets: [0, 2, 0, 1, 0, 0], ease: 10 },
  'G7': { frets: [3, 2, 0, 0, 0, 1], ease: 9 },
  // m7
  'Am7': { frets: [-1, 0, 2, 0, 1, 0], ease: 10 },
  'Bm7': { frets: [-1, 2, 0, 2, 0, 2], ease: 7 },
  'Dm7': { frets: [-1, -1, 0, 2, 1, 1], ease: 8 },
  'Em7': { frets: [0, 2, 0, 0, 0, 0], ease: 10 },
  // maj7
  'Cmaj7': { frets: [-1, 3, 2, 0, 0, 0], ease: 9 },
  'Dmaj7': { frets: [-1, -1, 0, 2, 2, 2], ease: 8 },
  'Emaj7': { frets: [0, 2, 1, 1, 0, 0], ease: 8 },
  'Fmaj7': { frets: [-1, -1, 3, 2, 1, 0], ease: 8 },
  'Gmaj7': { frets: [3, 2, 0, 0, 0, 2], ease: 8 },
  'Amaj7': { frets: [-1, 0, 2, 1, 2, 0], ease: 8 },
  // sus / add9
  'Asus2': { frets: [-1, 0, 2, 2, 0, 0], ease: 9 },
  'Asus4': { frets: [-1, 0, 2, 2, 3, 0], ease: 8 },
  'Dsus2': { frets: [-1, -1, 0, 2, 3, 0], ease: 9 },
  'Dsus4': { frets: [-1, -1, 0, 2, 3, 3], ease: 9 },
  'Esus4': { frets: [0, 2, 2, 2, 0, 0], ease: 9 },
  'Cadd9': { frets: [-1, 3, 2, 0, 3, 0], ease: 8 },
  // 6th系（ボサノヴァ・ジャズで頻出のオープン形）
  'C6': { frets: [-1, 3, 2, 2, 1, 0], ease: 7 },
  'G6': { frets: [3, 2, 0, 0, 0, 0], ease: 9 },
  'D6': { frets: [-1, -1, 0, 2, 0, 2], ease: 8 },
  'A6': { frets: [-1, 0, 2, 2, 2, 2], ease: 6 },
  'Am6': { frets: [-1, 0, 2, 2, 1, 2], ease: 7 },
  'Dm6': { frets: [-1, -1, 0, 2, 0, 1], ease: 8 },
  'Em6': { frets: [0, 2, 2, 0, 2, 0], ease: 8 },
  // その他
  'Ddim7': { frets: [-1, -1, 0, 1, 0, 1], ease: 6 },
  'E5': { frets: [0, 2, 2, -1, -1, -1], ease: 9 },
  'A5': { frets: [-1, 0, 2, 2, -1, -1], ease: 9 },
};

// 可動フォーム。rel: null=ミュート、数値=基準位置からの相対フレット（負もあり）
// barre:false はジャズ/ボサノヴァ定番のコンパクト4声ボイシング（drop系）で、優先的に使う
const MOVABLE_FORMS = [
  {
    rootPc: 4, barre: false, // ルート6弦 drop3
    shapes: {
      'maj7': [0, null, 1, 1, 0, null],
      '7': [0, null, 0, 1, 0, null],
      'm7': [0, null, 0, 0, 0, null],
      'm7b5': [0, null, 0, 0, -1, null],
      'dim7': [0, null, -1, 0, -1, null],
      '6': [0, null, -1, 1, 0, null],
      '13': [0, null, 0, 1, 2, null],
    },
  },
  {
    rootPc: 9, barre: false, // ルート5弦 drop2
    shapes: {
      'maj7': [null, 0, 2, 1, 2, null],
      '7': [null, 0, 2, 0, 2, null],
      'm7': [null, 0, 2, 0, 1, null],
      'm7b5': [null, 0, 1, 0, 1, null],
      'dim7': [null, 0, 1, -1, 1, null],
      '9': [null, 0, -1, 0, 0, null],
      'm9': [null, 0, -2, 0, 0, null],
      '7b9': [null, 0, -1, 0, -1, null],
      '13': [null, 0, -1, 0, 2, null],
      '6': [null, 0, 2, 2, 2, 2],
      'm6': [null, 0, 2, 2, 1, 2],
      'mmaj7': [null, 0, 2, 1, 1, null],
    },
  },
  {
    rootPc: 4, barre: true, // E フォーム（フルバレー）
    shapes: {
      '': [0, 2, 2, 1, 0, 0],
      'm': [0, 2, 2, 0, 0, 0],
      'sus4': [0, 2, 2, 2, 0, 0],
      '7sus4': [0, 2, 0, 2, 0, 0],
      '5': [0, 2, 2, null, null, null],
    },
  },
  {
    rootPc: 9, barre: true, // A フォーム（フルバレー）
    shapes: {
      '': [null, 0, 2, 2, 2, 0],
      'm': [null, 0, 2, 2, 1, 0],
      'sus4': [null, 0, 2, 2, 3, 0],
      '5': [null, 0, 2, 2, null, null],
    },
  },
];

// コードシンボル → フォーム（見つからなければ null）
export function getShape(symbol) {
  const p = parseChord(symbol);
  if (!p) return null;

  const sharpKey = pcName(p.root, false) + p.quality;
  const flatKey = pcName(p.root, true) + p.quality;
  const open = OPEN_SHAPES[sharpKey] || OPEN_SHAPES[flatKey];
  if (open) return { ...open, barres: open.barres || [], name: symbol };

  // 可動フォームから最も低い位置を選ぶ（同フレットならジャズ形＝配列前方を優先）
  let best = null;
  for (const form of MOVABLE_FORMS) {
    const tpl = form.shapes[p.quality];
    if (!tpl) continue;
    let fret = (((p.root - form.rootPc) % 12) + 12) % 12;
    const rels = tpl.filter((f) => f !== null);
    const minRel = Math.min(...rels);
    if (fret + minRel < 0) fret += 12;       // 相対マイナスがはみ出す位置は1オクターブ上へ
    if (fret === 0 && form.barre) fret = 12; // 0フレットのフルバレーは意味がない
    if (fret + Math.max(...rels) > 15) continue;
    if (!best || fret < best.fret) best = { fret, form, tpl };
  }
  if (!best) return null;

  const frets = best.tpl.map((f) => (f === null ? -1 : f + best.fret));
  const played = best.tpl.map((f, i) => (f !== null ? i : -1)).filter((i) => i >= 0);
  const barres = best.form.barre
    ? [{ fret: best.fret, from: played[0], to: played[played.length - 1] }]
    : [];
  const ease = best.form.barre
    ? (best.fret <= 3 ? 4 : best.fret <= 7 ? 3 : 2)
    : (best.fret <= 5 ? 5 : best.fret <= 9 ? 4 : 3);
  return { frets, barres, ease, name: symbol };
}

export function easeScore(symbol) {
  const s = getShape(symbol);
  return s ? s.ease : 1;
}

// フォーム → 実音 MIDI ノート列（capo 分を加算）
export function shapeToMidis(shape, capo = 0) {
  const midis = [];
  shape.frets.forEach((f, i) => {
    if (f >= 0) midis.push(STANDARD_TUNING[i] + f + capo);
  });
  return midis;
}

// カポ位置の提案。chords: 曲中のコード列 → [{capo, chords, score}] を capo 昇順で
export function capoSuggestions(chords, maxCapo = 7) {
  const unique = [...new Set(chords)];
  if (unique.length === 0) return [];
  const rows = [];
  for (let capo = 0; capo <= maxCapo; capo++) {
    const forms = unique.map((c) => (capo === 0 ? c : transposeChord(c, -capo)));
    const score = forms.reduce((s, c) => s + easeScore(c), 0) / forms.length;
    rows.push({ capo, chords: forms, score });
  }
  return rows;
}
