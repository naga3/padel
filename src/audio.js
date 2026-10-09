// 効果音は WebAudio でその場で作る（音のファイルは持たない）。
let ctx = null, master = null, noiseBuf = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setMuted(m) { if (master) master.gain.value = m ? 0 : 0.6; }

function noise(t, dur, type, freq, q, gain) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

function tone(t, dur, f0, f1, gain, type = 'sine') {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

export function sfx(kind, power = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const p = Math.min(1.5, power);
  switch (kind) {
    case 'hit':  // パコン：ラケットの乾いた音
      noise(t, 0.05, 'bandpass', 1600 + 600 * p, 1.2, 0.5 * p);
      tone(t, 0.08, 520, 260, 0.35 * p, 'triangle');
      break;
    case 'smash':
      noise(t, 0.09, 'bandpass', 1300, 0.9, 0.9);
      tone(t, 0.12, 420, 120, 0.6, 'triangle');
      break;
    case 'floor':
      noise(t, 0.035, 'bandpass', 900, 1.5, 0.25 * p);
      tone(t, 0.05, 240, 140, 0.2 * p);
      break;
    case 'glass':  // ガラス：低いドン
      tone(t, 0.16, 180, 90, 0.45);
      noise(t, 0.08, 'lowpass', 700, 0.7, 0.35);
      break;
    case 'mesh':  // 金網：ジャラッ
      for (let i = 0; i < 5; i++) noise(t + i * 0.025, 0.06, 'highpass', 3500, 0.7, 0.18);
      break;
    case 'net':
      noise(t, 0.12, 'lowpass', 500, 0.7, 0.4);
      break;
    case 'toss':
      noise(t, 0.03, 'bandpass', 800, 2, 0.12);
      break;
    case 'whiff':
      noise(t, 0.12, 'bandpass', 600, 0.6, 0.12);
      break;
    case 'cheer': {  // 拍手：短い雑音の粒をたくさん
      for (let i = 0; i < 70; i++) noise(t + Math.random() * 1.4, 0.03, 'bandpass', 1500 + Math.random() * 1500, 1, 0.08 + Math.random() * 0.06);
      break;
    }
    case 'sigh':
      noise(t, 0.6, 'lowpass', 400, 0.5, 0.15);
      break;
    case 'chime':
      tone(t, 0.25, 880, 880, 0.18);
      tone(t + 0.12, 0.35, 1320, 1320, 0.15);
      break;
  }
}
