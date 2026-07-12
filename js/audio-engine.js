// AudioContext・マイク・音源デコードの共有基盤（ブラウザ専用）

let ctx = null;

export function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

// iOS Safari はユーザー操作内で resume が必要
export async function resumeCtx() {
  const c = getCtx();
  if (c.state === 'suspended') await c.resume();
  return c;
}

let micStream = null;
let micSource = null;

export async function startMic() {
  const c = await resumeCtx();
  if (!micStream) {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    micSource = c.createMediaStreamSource(micStream);
  }
  return micSource;
}

export function stopMic() {
  if (micStream) {
    for (const t of micStream.getTracks()) t.stop();
    micStream = null;
    micSource = null;
  }
}

export function micActive() {
  return micStream !== null;
}

export async function decodeFile(file) {
  const c = await resumeCtx();
  const buf = await file.arrayBuffer();
  return c.decodeAudioData(buf);
}

// AudioBuffer → モノラル Float32Array
export function toMono(audioBuffer) {
  const n = audioBuffer.length;
  const out = new Float32Array(n);
  const chs = audioBuffer.numberOfChannels;
  for (let ch = 0; ch < chs; ch++) {
    const d = audioBuffer.getChannelData(ch);
    for (let i = 0; i < n; i++) out[i] += d[i] / chs;
  }
  return out;
}
