// MPM (McLeod Pitch Method) 単音ピッチ検出（純関数・DOM非依存 — Node テスト対象）
// 参考: McLeod & Wyvill, "A Smarter Way to Find Pitch" (2005)

export function detectPitch(buf, sampleRate, opts = {}) {
  const {
    minFreq = 60,
    maxFreq = 1600,
    clarityThreshold = 0.8,
    rmsThreshold = 0.004,
  } = opts;

  const n = buf.length;
  let sumSq = 0;
  for (let i = 0; i < n; i++) sumSq += buf[i] * buf[i];
  const rms = Math.sqrt(sumSq / n);
  if (rms < rmsThreshold) return null;

  const maxTau = Math.min(Math.floor(sampleRate / minFreq), n - 2);
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  if (maxTau <= minTau) return null;

  // NSDF: nsdf[tau] = 2*Σ x[i]x[i+tau] / Σ (x[i]² + x[i+tau]²)
  const nsdf = new Float32Array(maxTau + 1);
  for (let tau = minTau; tau <= maxTau; tau++) {
    let acf = 0, norm = 0;
    for (let i = 0; i + tau < n; i++) {
      acf += buf[i] * buf[i + tau];
      norm += buf[i] * buf[i] + buf[i + tau] * buf[i + tau];
    }
    nsdf[tau] = norm > 0 ? (2 * acf) / norm : 0;
  }

  // 正のゼロ交差区間ごとの極大（key maxima）を収集
  const maxima = [];
  let tau = minTau;
  while (tau <= maxTau && nsdf[tau] > 0) tau++; // 最初の正ローブ（tau≈0 の名残）を読み飛ばす
  while (tau <= maxTau) {
    while (tau <= maxTau && nsdf[tau] <= 0) tau++;
    let best = -Infinity, bestTau = -1;
    while (tau <= maxTau && nsdf[tau] > 0) {
      if (nsdf[tau] > best) { best = nsdf[tau]; bestTau = tau; }
      tau++;
    }
    if (bestTau > 0) maxima.push([bestTau, best]);
  }
  if (maxima.length === 0) return null;

  let overall = -Infinity;
  for (const [, v] of maxima) if (v > overall) overall = v;
  if (overall < clarityThreshold) return null;

  // 最大値の90%を超える最初の極大を採用（オクターブ下への誤検出防止）
  const threshold = 0.9 * overall;
  const [ct, cv] = maxima.find(([, v]) => v >= threshold);

  // 放物線補間でサブサンプル精度に
  let refined = ct;
  if (ct > minTau && ct < maxTau) {
    const a = nsdf[ct - 1], b = nsdf[ct], c = nsdf[ct + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) refined = ct + (0.5 * (a - c)) / denom;
  }

  return { freq: sampleRate / refined, clarity: cv, rms };
}

// 単純平均によるダウンサンプリング（ピッチ検出の高速化用。〜1.2kHzの検出には11kHz程度で十分）
export function downsample(data, factor) {
  if (factor <= 1) return data;
  const out = new Float32Array(Math.floor(data.length / factor));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    const base = i * factor;
    for (let j = 0; j < factor; j++) s += data[base + j];
    out[i] = s / factor;
  }
  return out;
}

// 音源バッファからピッチ軌跡を抽出（耳コピ・ハモリ用）
// data: Float32Array（モノラル）→ [{t, freq, clarity}]（無音/不明瞭は freq:null）
export function pitchTrack(data, sampleRate, opts = {}) {
  const { windowSize = 2048, hopSize = 512, ...detectOpts } = opts;
  const frames = [];
  for (let pos = 0; pos + windowSize <= data.length; pos += hopSize) {
    const frame = data.subarray(pos, pos + windowSize);
    const r = detectPitch(frame, sampleRate, detectOpts);
    frames.push({
      t: (pos + windowSize / 2) / sampleRate,
      freq: r ? r.freq : null,
      clarity: r ? r.clarity : 0,
    });
  }
  return frames;
}

// ピッチ軌跡 → ノート列 [{midi, start, dur}]
// 半音に量子化し、同じ音が続く区間をノートにまとめる
export function framesToNotes(frames, a4 = 440, opts = {}) {
  const { minDur = 0.06, maxGapFrames = 1 } = opts;
  // 中央値フィルタ（幅3）でスパイク除去
  const midis = frames.map((f) =>
    f.freq ? Math.round(69 + 12 * Math.log2(f.freq / a4)) : null
  );
  const smooth = midis.map((m, i) => {
    const win = [midis[i - 1], m, midis[i + 1]].filter((x) => x !== null);
    if (m === null || win.length < 2) return m;
    win.sort((a, b) => a - b);
    return win[Math.floor(win.length / 2)];
  });

  const notes = [];
  let cur = null; // {midi, startIdx, lastIdx, gap}
  const flush = (endIdx) => {
    if (!cur) return;
    const start = frames[cur.startIdx].t;
    const end = frames[Math.min(endIdx, frames.length - 1)].t;
    if (end - start >= minDur) notes.push({ midi: cur.midi, start, dur: end - start });
    cur = null;
  };
  for (let i = 0; i < smooth.length; i++) {
    const m = smooth[i];
    if (m === null) {
      if (cur && ++cur.gap > maxGapFrames) flush(cur.lastIdx);
      continue;
    }
    if (cur && m === cur.midi) {
      cur.lastIdx = i;
      cur.gap = 0;
    } else {
      if (cur) flush(cur.lastIdx);
      cur = { midi: m, startIdx: i, lastIdx: i, gap: 0 };
    }
  }
  flush(cur ? cur.lastIdx : 0);
  return notes;
}
