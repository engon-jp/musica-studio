// メトロノームの純ロジック（DOM/Audio非依存 — Node テスト対象）

// タップ時刻列(ms) → BPM。直近6打・間隔2.5秒以内だけを使う。判定不能なら null
export function tapTempo(taps) {
  if (taps.length < 2) return null;
  const recent = taps.slice(-7);
  const intervals = [];
  for (let i = 1; i < recent.length; i++) {
    const d = recent[i] - recent[i - 1];
    if (d > 0 && d < 2500) intervals.push(d);
  }
  if (intervals.length === 0) return null;
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const bpm = Math.round(60000 / avg);
  return Math.min(300, Math.max(20, bpm));
}

// スピードトレーナー: barCount 小節終了時点の次のBPM
export function trainerNextBpm(bpm, { inc, every, max }, barCount) {
  if (barCount > 0 && every > 0 && barCount % every === 0) {
    return Math.min(max, bpm + inc);
  }
  return bpm;
}

export function defaultBeatStates(n) {
  return Array.from({ length: n }, (_, i) => (i === 0 ? 'accent' : 'on'));
}

export function cycleBeatState(s) {
  return s === 'accent' ? 'on' : s === 'on' ? 'mute' : 'accent';
}

export function ticksPerBar(beats, subdiv) {
  return beats * subdiv;
}

// 適応先読み: スケジューラ呼び出しの実測間隔(秒)から、音を先読みスケジュールする幅を決める。
// バックグラウンドでタイマーが1秒に絞られても途切れないよう、間隔の2.5倍を確保する
export function adaptiveAhead(gapSec) {
  return Math.max(0.15, Math.min(2.5, gapSec * 2.5));
}

// tick（小節内インデックス）→ 鳴らす音の種類
// 戻り値: { beatIdx, isBeat, sound: 'accent'|'beat'|'sub'|'mute' }
export function tickKind(tick, beats, subdiv, beatStates) {
  const beatIdx = Math.floor(tick / subdiv) % beats;
  const isBeat = tick % subdiv === 0;
  const st = beatStates[beatIdx] || 'on';
  let sound;
  if (st === 'mute') sound = 'mute';
  else if (isBeat) sound = st === 'accent' ? 'accent' : 'beat';
  else sound = 'sub';
  return { beatIdx, isBeat, sound };
}
