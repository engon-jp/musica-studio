// コード進行トラッカー（純関数・DOM非依存 — Node テスト対象）
// パイプライン: STFT → オンセット強度 → テンポ推定 → DPビートトラッキング(Ellis風)
//   → ビート同期クロマ ＋ ベース音検出(MPM) → ジャズ語彙のビタビ平滑化 → セグメント列
// 出力は「候補」。テンションは気配のみ添える（最終判断は耳に委ねる設計）。

import { fft, hannWindow } from './dsp.js';
import { detectPitch, downsample } from './pitch.js';
import { estimateKey, pcName, MAJOR_SCALE, MINOR_SCALE } from './theory.js';

// コードファミリー（ルートからの音程と重み。重み=そのコードでの音の重要度）
const FAMILIES = [
  { suffix: '', ivs: [[0, 1.0], [4, 0.85], [7, 0.75]] },
  { suffix: 'm', ivs: [[0, 1.0], [3, 0.85], [7, 0.75]] },
  { suffix: '7', ivs: [[0, 1.0], [4, 0.8], [7, 0.6], [10, 0.8]] },
  { suffix: 'maj7', ivs: [[0, 1.0], [4, 0.8], [7, 0.6], [11, 0.8]] },
  { suffix: 'm7', ivs: [[0, 1.0], [3, 0.8], [7, 0.6], [10, 0.8]] },
  { suffix: 'm7b5', ivs: [[0, 1.0], [3, 0.8], [6, 0.75], [10, 0.75]] },
  { suffix: 'dim7', ivs: [[0, 1.0], [3, 0.8], [6, 0.75], [9, 0.75]] },
  { suffix: '6', ivs: [[0, 1.0], [4, 0.8], [7, 0.6], [9, 0.75]] },
  { suffix: 'm6', ivs: [[0, 1.0], [3, 0.8], [7, 0.6], [9, 0.75]] },
];

const N_STATES = FAMILIES.length * 12;

// 移動平均ローパス（ベース検出前に中高域のコード音を除く）
function lowpassMA(x, k, passes = 2) {
  let cur = x;
  for (let p = 0; p < passes; p++) {
    const out = new Float32Array(cur.length);
    let acc = 0;
    for (let i = 0; i < cur.length; i++) {
      acc += cur[i];
      if (i >= k) acc -= cur[i - k];
      out[i] = acc / Math.min(i + 1, k);
    }
    cur = out;
  }
  return cur;
}

export async function trackChords(input, sampleRate, opts = {}) {
  const { onProgress = null, maxSeconds = 480 } = opts;
  const data = input.length > sampleRate * maxSeconds
    ? input.subarray(0, sampleRate * maxSeconds)
    : input;

  // --- 1) 約22kHzへ間引き、STFT ---
  const factor = Math.max(1, Math.round(sampleRate / 22050));
  const ds = downsample(data, factor);
  const sr = sampleRate / factor;
  const fftSize = 4096, hop = 1024;
  const win = hannWindow(fftSize);
  const nFrames = Math.floor((ds.length - fftSize) / hop) + 1;
  if (!(nFrames >= 8)) return null;

  const kLo = Math.max(1, Math.ceil((100 * fftSize) / sr));
  const kHi = Math.min(fftSize / 2 - 1, Math.floor((5000 * fftSize) / sr));

  const flux = new Float32Array(nFrames);
  const chromaFrames = new Array(nFrames);
  const re = new Float32Array(fftSize), im = new Float32Array(fftSize);
  let prevMag = null;

  for (let i = 0; i < nFrames; i++) {
    const off = i * hop;
    for (let k = 0; k < fftSize; k++) { re[k] = ds[off + k] * win[k]; im[k] = 0; }
    fft(re, im);
    const mag = new Float32Array(fftSize / 2);
    for (let k = 1; k < fftSize / 2; k++) mag[k] = Math.hypot(re[k], im[k]);

    if (prevMag) {
      let s = 0;
      for (let k = kLo; k <= kHi; k++) {
        const d = mag[k] - prevMag[k];
        if (d > 0) s += d;
      }
      flux[i] = s;
    }
    prevMag = mag;

    const ch = new Float32Array(12);
    for (let k = kLo; k <= kHi; k++) {
      const f = (k * sr) / fftSize;
      const pc = ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12;
      ch[pc] += mag[k] * mag[k];
    }
    chromaFrames[i] = ch;

    if (onProgress && i % 128 === 0) {
      onProgress((0.75 * i) / nFrames);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // --- 2) テンポ推定（オンセット強度の自己相関、0.3〜1.0秒周期）---
  const frameDur = hop / sr;
  let fluxMean = 0;
  for (let i = 0; i < nFrames; i++) fluxMean += flux[i];
  fluxMean /= nFrames;

  const minLag = Math.max(2, Math.round(0.3 / frameDur));
  const maxLag = Math.min(Math.round(1.0 / frameDur), nFrames - 2);
  let P = minLag, bestV = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < nFrames; i++) s += flux[i] * flux[i - lag];
    // 中庸なテンポ（周期0.5秒≒120bpm）をゆるく優遇
    const pref = Math.exp(-Math.pow(Math.log2((lag * frameDur) / 0.5), 2) / 1.62);
    s *= pref;
    if (s > bestV) { bestV = s; P = lag; }
  }
  const bpm = Math.round(60 / (P * frameDur));

  // --- 3) DPビートトラッキング ---
  const C = new Float32Array(nFrames);
  const back = new Int32Array(nFrames).fill(-1);
  const alpha = 3 * fluxMean * P;
  for (let i = 0; i < nFrames; i++) {
    C[i] = flux[i];
    const lo = Math.max(0, i - Math.round(1.7 * P));
    const hi = i - Math.max(1, Math.round(0.5 * P));
    for (let j = lo; j <= hi; j++) {
      const dev = Math.log2((i - j) / P);
      const v = C[j] + flux[i] - alpha * dev * dev;
      if (v > C[i]) { C[i] = v; back[i] = j; }
    }
  }
  let end = nFrames - 1, bv = -Infinity;
  for (let i = Math.max(0, nFrames - Math.round(1.6 * P)); i < nFrames; i++) {
    if (C[i] > bv) { bv = C[i]; end = i; }
  }
  let beatFrames = [];
  for (let i = end; i >= 0; i = back[i]) {
    beatFrames.unshift(i);
    if (back[i] < 0) break;
  }
  if (beatFrames.length < 4) {
    // オンセットが乏しい音源: 固定グリッドにフォールバック
    beatFrames = [];
    for (let i = 0; i + P <= nFrames; i += P) beatFrames.push(i);
  }
  const beatTimes = beatFrames.map((i) => (i * hop + fftSize / 2) / sr);

  // --- 4) ビート同期クロマ ＋ ベース音（原データを低域MPM）---
  const nBeats = beatFrames.length;
  const beatChroma = [];
  const bassPc = [];
  const bassMidi = []; // オクターブ込みのベース音（ベースライン採譜用）
  const bassFactor = Math.max(1, Math.round(sampleRate / 2756));
  for (let b = 0; b < nBeats; b++) {
    const f0 = beatFrames[b];
    const f1 = b + 1 < nBeats ? beatFrames[b + 1] : nFrames;
    const ch = new Float32Array(12);
    for (let i = f0; i < f1; i++) {
      for (let p = 0; p < 12; p++) ch[p] += chromaFrames[i][p];
    }
    const mx = Math.max(...ch, 1e-12);
    beatChroma.push(Array.from(ch, (v) => v / mx));

    const t0 = beatTimes[b];
    const t1 = b + 1 < nBeats ? beatTimes[b + 1] : t0 + P * frameDur;
    const s0 = Math.floor(t0 * sampleRate);
    const segLen = Math.min(Math.floor((t1 - t0) * sampleRate), Math.floor(0.45 * sampleRate));
    const seg = data.subarray(s0, Math.min(data.length, s0 + segLen));
    const low = lowpassMA(downsample(seg, bassFactor), 9, 2);
    const r = low.length > 128
      ? detectPitch(low, sampleRate / bassFactor, { minFreq: 32, maxFreq: 210, clarityThreshold: 0.6, rmsThreshold: 0.002 })
      : null;
    let m = r ? Math.round(69 + 12 * Math.log2(r.freq / 440)) : null;
    if (m !== null) {
      // ベース音域 E1〜A3 に正規化（オクターブ誤検出の保険）
      while (m > 57) m -= 12;
      while (m < 28) m += 12;
    }
    bassMidi.push(m);
    bassPc.push(m !== null ? ((m % 12) + 12) % 12 : null);
  }
  if (onProgress) { onProgress(0.85); await new Promise((r) => setTimeout(r, 0)); }

  // --- 5) キー推定（全体クロマ）---
  const globalCh = new Array(12).fill(0);
  for (const ch of beatChroma) for (let p = 0; p < 12; p++) globalCh[p] += ch[p];
  const key = estimateKey(globalCh);
  const scale = key.mode === 'minor' ? MINOR_SCALE : MAJOR_SCALE;
  const scaleSet = new Set(scale.map((iv) => (key.tonic + iv) % 12));

  // --- 6) ビタビ平滑化 ---
  // 状態 = ルート12 × ファミリー。放射スコア = クロマ照合 + ベース一致 + キー適合
  const templates = [];
  for (let root = 0; root < 12; root++) {
    for (const fam of FAMILIES) {
      const t = new Array(12).fill(0);
      for (const [iv, w] of fam.ivs) t[(root + iv) % 12] = w;
      const norm = Math.hypot(...t);
      templates.push({ root, fam, t, norm });
    }
  }
  const emit = (b, s) => {
    const { root, fam, t, norm } = templates[s];
    const ch = beatChroma[b];
    let dot = 0, cn = 0;
    for (let p = 0; p < 12; p++) { dot += ch[p] * t[p]; cn += ch[p] * ch[p]; }
    const cos = dot / (Math.sqrt(cn) * norm + 1e-12);
    let bass = 0;
    const bp = bassPc[b];
    if (bp !== null) {
      if (bp === root) bass = 0.9;
      else if (fam.ivs.some(([iv]) => (root + iv) % 12 === bp)) bass = 0.3;
      else bass = -0.25;
    }
    let inKey = 0;
    for (const [iv] of fam.ivs) if (scaleSet.has((root + iv) % 12)) inKey++;
    return 3.0 * cos + bass + 0.35 * (inKey / fam.ivs.length);
  };

  const STAY = 0.8;
  let prev = new Float32Array(N_STATES);
  const bp2 = []; // backpointers
  for (let s = 0; s < N_STATES; s++) prev[s] = emit(0, s);
  for (let b = 1; b < nBeats; b++) {
    const cur = new Float32Array(N_STATES);
    const bpRow = new Int32Array(N_STATES);
    let bestPrev = 0;
    for (let s = 1; s < N_STATES; s++) if (prev[s] > prev[bestPrev]) bestPrev = s;
    for (let s = 0; s < N_STATES; s++) {
      // 遷移: 同一コード継続ボーナス vs どこからでも乗り換え
      const stayV = prev[s] + STAY;
      const moveV = prev[bestPrev];
      if (stayV >= moveV) { cur[s] = stayV + emit(b, s); bpRow[s] = s; }
      else { cur[s] = moveV + emit(b, s); bpRow[s] = bestPrev; }
    }
    bp2.push(bpRow);
    prev = cur;
    if (onProgress && b % 64 === 0) onProgress(0.85 + (0.15 * b) / nBeats);
  }
  let curState = 0;
  for (let s = 1; s < N_STATES; s++) if (prev[s] > prev[curState]) curState = s;
  const states = new Array(nBeats);
  states[nBeats - 1] = curState;
  for (let b = nBeats - 2; b >= 0; b--) {
    curState = bp2[b][curState];
    states[b] = curState;
  }

  // --- 7) セグメント化 ＋ テンションの気配 ---
  const majorPc = key.mode === 'minor' ? (key.tonic + 3) % 12 : key.tonic;
  const useFlat = [1, 3, 5, 8, 10].includes(majorPc);
  const segments = [];
  let segStart = 0;
  const endTime = beatTimes[nBeats - 1] + (beatTimes[nBeats - 1] - (beatTimes[nBeats - 2] ?? 0));
  for (let b = 1; b <= nBeats; b++) {
    if (b === nBeats || states[b] !== states[segStart]) {
      const st = templates[states[segStart]];
      const chordName = pcName(st.root, useFlat) + st.fam.suffix;
      // 平均クロマからテンションの気配（9th / 13th）
      const avg = new Array(12).fill(0);
      for (let i = segStart; i < b; i++) for (let p = 0; p < 12; p++) avg[p] += beatChroma[i][p];
      const mx = Math.max(...avg, 1e-12);
      let hint = '';
      if (['7', 'maj7', 'm7'].includes(st.fam.suffix)) {
        if (avg[(st.root + 2) % 12] / mx > 0.62) hint = '(9)';
        if (st.fam.suffix === '7' && avg[(st.root + 9) % 12] / mx > 0.62) hint = '(13)';
      }
      let conf = 0;
      for (let i = segStart; i < b; i++) conf += emit(i, states[segStart]);
      segments.push({
        chord: chordName,
        hint,
        start: beatTimes[segStart],
        end: b === nBeats ? endTime : beatTimes[b],
        beats: b - segStart,
        conf: conf / (b - segStart),
      });
      segStart = b;
    }
  }

  // --- 8) ベースライン（拍単位、同音の連続をまとめる）---
  const bassline = [];
  let runStart = -1;
  for (let b = 0; b <= nBeats; b++) {
    const cur = b < nBeats ? bassMidi[b] : null;
    const prev2 = runStart >= 0 ? bassMidi[runStart] : null;
    if (cur !== prev2) {
      if (runStart >= 0 && prev2 !== null) {
        bassline.push({ midi: prev2, startBeat: runStart, beats: b - runStart });
      }
      runStart = cur !== null ? b : -1;
    }
  }

  if (onProgress) onProgress(1);
  return { bpm, beats: beatTimes, key, useFlat, segments, bassline };
}
