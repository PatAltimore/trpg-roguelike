/* ═══════════ Procedural 8-bit Sound Effects ═══════════
   Uses Web Audio API to synthesize retro-style sounds.
   No audio files needed — everything is generated on the fly. */

let ctx = null;

function ensure() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function osc(type, freq, dur, vol = 0.15, detune = 0) {
  const c = ensure();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime);
  o.stop(c.currentTime + dur);
}

function noise(dur, vol = 0.08) {
  const c = ensure();
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  const g = c.createGain();
  src.buffer = buf;
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  src.connect(g).connect(c.destination);
  src.start();
}

function sweep(type, f1, f2, dur, vol = 0.12) {
  const c = ensure();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(f2, c.currentTime + dur);
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime);
  o.stop(c.currentTime + dur);
}

export const SFX = {
  select() {
    osc('square', 600, 0.06, 0.1);
    setTimeout(() => osc('square', 800, 0.08, 0.1), 50);
  },

  move() {
    osc('square', 200, 0.05, 0.08);
    setTimeout(() => osc('square', 250, 0.05, 0.08), 40);
  },

  menuOpen() {
    osc('square', 400, 0.05, 0.08);
    setTimeout(() => osc('square', 500, 0.06, 0.08), 40);
  },

  menuSelect() {
    osc('square', 500, 0.04, 0.1);
    setTimeout(() => osc('square', 700, 0.06, 0.1), 30);
  },

  menuBack() {
    osc('square', 500, 0.04, 0.08);
    setTimeout(() => osc('square', 350, 0.06, 0.08), 30);
  },

  hit() {
    noise(0.08, 0.12);
    osc('square', 160, 0.1, 0.1);
  },

  miss() {
    sweep('square', 400, 200, 0.15, 0.08);
  },

  crit() {
    noise(0.06, 0.15);
    osc('square', 200, 0.08, 0.12);
    setTimeout(() => {
      noise(0.08, 0.15);
      osc('square', 300, 0.12, 0.12);
    }, 80);
  },

  kill() {
    sweep('square', 500, 80, 0.3, 0.12);
    noise(0.2, 0.1);
  },

  levelUp() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => setTimeout(() => osc('square', f, 0.12, 0.1), i * 100));
  },

  win() {
    const notes = [523, 659, 784, 659, 784, 1047];
    notes.forEach((f, i) => setTimeout(() => osc('square', f, 0.15, 0.12), i * 120));
  },

  lose() {
    const notes = [400, 350, 300, 200];
    notes.forEach((f, i) => setTimeout(() => osc('sawtooth', f, 0.25, 0.1), i * 200));
  },

  turnEnd() {
    osc('triangle', 350, 0.1, 0.08);
    setTimeout(() => osc('triangle', 250, 0.12, 0.08), 80);
  },

  enemyPhase() {
    osc('sawtooth', 200, 0.1, 0.08);
    setTimeout(() => osc('sawtooth', 300, 0.1, 0.08), 100);
    setTimeout(() => osc('sawtooth', 250, 0.15, 0.08), 200);
  },

  playerPhase() {
    osc('square', 400, 0.08, 0.08);
    setTimeout(() => osc('square', 500, 0.08, 0.08), 80);
    setTimeout(() => osc('square', 600, 0.12, 0.08), 160);
  },

  start() {
    const notes = [330, 392, 523, 659];
    notes.forEach((f, i) => setTimeout(() => osc('square', f, 0.15, 0.1), i * 130));
  },
};
