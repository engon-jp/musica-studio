// 音源合成: Karplus-Strong ギター音 / ハモリ用シンセ声（ブラウザ専用）

import { getCtx } from './audio-engine.js';
import { midiToFreq } from './theory.js';

// Karplus-Strong 撥弦音。when は AudioContext 時刻（0 なら即時）
export function pluck(freq, when = 0, { dur = 2.0, gain = 0.35, dest = null } = {}) {
  const ctx = getCtx();
  const sr = ctx.sampleRate;
  const N = Math.max(2, Math.round(sr / freq));
  const len = Math.ceil(sr * dur);
  const buffer = ctx.createBuffer(1, len, sr);
  const d = buffer.getChannelData(0);

  // 遅延ループ: ノイズバースト → 移動平均（ローパス）＋減衰
  const ring = new Float32Array(N);
  for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
  const damp = 0.996;
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const next = (idx + 1) % N;
    d[i] = ring[idx];
    ring[idx] = damp * 0.5 * (ring[idx] + ring[next]);
    idx = next;
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(dest || ctx.destination);
  src.start(when || ctx.currentTime);
  return src;
}

export function pluckMidi(midi, when = 0, opts = {}) {
  return pluck(midiToFreq(midi), when, opts);
}

// コードのストラム（低音弦から順に少しずつ遅らせて鳴らす）
export function strum(midis, when = 0, { interval = 0.028, gain = 0.3, dur = 2.2, dest = null } = {}) {
  const ctx = getCtx();
  const t0 = when || ctx.currentTime;
  midis.forEach((m, i) => pluckMidi(m, t0 + i * interval, { gain, dur, dest }));
}

// ハモリ用のやわらかい声風シンセ（三角波＋ビブラート＋ローパス＋エンベロープ）
export function voiceNote(freq, when, dur, { gain = 0.25, dest = null } = {}) {
  const ctx = getCtx();
  const t0 = when || ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;

  // ビブラート（遅れて深くなる）
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.2;
  const lfoGain = ctx.createGain();
  lfoGain.gain.setValueAtTime(0, t0);
  lfoGain.gain.linearRampToValueAtTime(freq * 0.004, t0 + Math.min(0.4, dur * 0.5));
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1800;
  filter.Q.value = 0.7;

  const env = ctx.createGain();
  const atk = Math.min(0.05, dur * 0.3);
  const rel = Math.min(0.12, dur * 0.4);
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + atk);
  env.gain.setValueAtTime(gain, t0 + Math.max(atk, dur - rel));
  env.gain.linearRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(filter);
  filter.connect(env);
  env.connect(dest || ctx.destination);

  osc.start(t0);
  lfo.start(t0);
  osc.stop(t0 + dur + 0.05);
  lfo.stop(t0 + dur + 0.05);
  return osc;
}

export function voiceMidi(midi, when, dur, opts = {}) {
  return voiceNote(midiToFreq(midi), when, dur, opts);
}
