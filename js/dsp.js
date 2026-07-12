// DSP ユーティリティ: FFT・クロマ（音階エネルギー）・コード候補（純関数・DOM非依存 — Node テスト対象）

// 基数2 FFT（in-place）。re/im は長さが2の冪の Float32Array
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2], ai = im[i + k + len / 2];
        const vr = ar * cr - ai * ci;
        const vi = ar * ci + ai * cr;
        re[i + k + len / 2] = re[i + k] - vr;
        im[i + k + len / 2] = im[i + k] - vi;
        re[i + k] += vr;
        im[i + k] += vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

// フレームの振幅スペクトル（長さ n/2）
export function spectrum(frame, win = null) {
  const n = frame.length;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = win ? frame[i] * win[i] : frame[i];
  fft(re, im);
  const mag = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

// モノラル信号 → クロマ（12次元・最大1に正規化）
export function chromaOf(data, sampleRate, opts = {}) {
  const { fftSize = 4096, hop = 2048, fmin = 65, fmax = 5000 } = opts;
  const chroma = new Array(12).fill(0);
  const win = hannWindow(fftSize);
  for (let pos = 0; pos + fftSize <= data.length; pos += hop) {
    const mag = spectrum(data.subarray(pos, pos + fftSize), win);
    for (let k = 1; k < mag.length; k++) {
      const f = (k * sampleRate) / fftSize;
      if (f < fmin || f > fmax) continue;
      const midi = 69 + 12 * Math.log2(f / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += mag[k] * mag[k];
    }
  }
  const max = Math.max(...chroma, 1e-12);
  return chroma.map((v) => v / max);
}

// コードテンプレート照合（コサイン類似度）
const TEMPLATES = [
  { suffix: '', ivs: [[0, 1.0], [4, 0.9], [7, 0.9]] },
  { suffix: 'm', ivs: [[0, 1.0], [3, 0.9], [7, 0.9]] },
  { suffix: '7', ivs: [[0, 1.0], [4, 0.85], [7, 0.8], [10, 0.75]] },
  { suffix: 'm7', ivs: [[0, 1.0], [3, 0.85], [7, 0.8], [10, 0.75]] },
  { suffix: 'maj7', ivs: [[0, 1.0], [4, 0.85], [7, 0.8], [11, 0.75]] },
];

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function chordCandidates(chroma, topN = 5) {
  const norm = Math.hypot(...chroma) || 1e-12;
  const results = [];
  for (let root = 0; root < 12; root++) {
    for (const t of TEMPLATES) {
      const tpl = new Array(12).fill(0);
      for (const [iv, w] of t.ivs) tpl[(root + iv) % 12] = w;
      const tnorm = Math.hypot(...tpl);
      let dot = 0;
      for (let i = 0; i < 12; i++) dot += chroma[i] * tpl[i];
      results.push({ chord: SHARP[root] + t.suffix, score: dot / (norm * tnorm) });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topN);
}

// 区間を等分してそれぞれのコード候補トップを返す
export function chordSegments(data, sampleRate, nSeg) {
  const segLen = Math.floor(data.length / nSeg);
  const out = [];
  for (let i = 0; i < nSeg; i++) {
    const seg = data.subarray(i * segLen, (i + 1) * segLen);
    const cands = chordCandidates(chromaOf(seg, sampleRate), 3);
    out.push({ index: i, candidates: cands });
  }
  return out;
}
