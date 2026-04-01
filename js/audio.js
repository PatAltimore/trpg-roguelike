/* ═══════════ Procedural 8-bit Sound Effects ═══════════
   Uses Web Audio API to synthesize retro-style sounds.
   No audio files needed — everything is generated on the fly. */

let ctx = null;
let muted = false;

export function isMuted() { return muted; }
export function toggleMute() { muted = !muted; return muted; }

function ensure() {
  if (muted) return null;
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function osc(type, freq, dur, vol = 0.15, detune = 0) {
  const c = ensure();
  if (!c) return;
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
  if (!c) return;
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
  if (!c) return;
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

  /* ~4 second heroic title melody — plays once on first click */
  titleMelody() {
    /* melody: heroic ascending phrase, quick turnaround, resolving fanfare */
    const melody = [
      /* note, delay(ms), dur, type, vol */
      [262, 0,    0.18, 'square', 0.10],    /* C4  */
      [330, 180,  0.18, 'square', 0.10],    /* E4  */
      [392, 360,  0.18, 'square', 0.10],    /* G4  */
      [523, 540,  0.30, 'square', 0.12],    /* C5 (hold) */
      [494, 900,  0.14, 'square', 0.10],    /* B4  */
      [523, 1060, 0.14, 'square', 0.10],    /* C5  */
      [587, 1220, 0.30, 'square', 0.12],    /* D5 (hold) */
      [523, 1600, 0.14, 'square', 0.10],    /* C5  */
      [494, 1760, 0.14, 'square', 0.10],    /* B4  */
      [440, 1920, 0.14, 'square', 0.10],    /* A4  */
      [392, 2100, 0.30, 'square', 0.12],    /* G4 (hold) */
      [330, 2500, 0.14, 'square', 0.10],    /* E4  */
      [392, 2660, 0.18, 'square', 0.10],    /* G4  */
      [523, 2840, 0.18, 'square', 0.12],    /* C5  */
      [659, 3020, 0.18, 'square', 0.12],    /* E5  */
      [784, 3200, 0.50, 'square', 0.13],    /* G5 (finale) */
    ];
    /* bass harmony */
    const bass = [
      [131, 0,    0.35, 'triangle', 0.06],  /* C3  */
      [165, 540,  0.35, 'triangle', 0.06],  /* E3  */
      [196, 1220, 0.35, 'triangle', 0.06],  /* G3  */
      [175, 1920, 0.35, 'triangle', 0.06],  /* F3  */
      [131, 2500, 0.35, 'triangle', 0.06],  /* C3  */
      [196, 3200, 0.50, 'triangle', 0.07],  /* G3 (finale) */
    ];
    for (const [f, d, dur, type, vol] of [...melody, ...bass]) {
      setTimeout(() => osc(type, f, dur, vol), d);
    }
  },

  /* ~5 second transition melody — victory fanfare into marching tension */
  transitionMelody() {
    /* Phase 1: triumphant victory phrase (0-2.5s) */
    const victory = [
      [523, 0,    0.20, 'square', 0.11],    /* C5 — bold opening    */
      [659, 200,  0.20, 'square', 0.11],    /* E5                   */
      [784, 400,  0.35, 'square', 0.12],    /* G5 — hold            */
      [784, 800,  0.12, 'square', 0.10],    /* G5 — quick repeat    */
      [880, 960,  0.12, 'square', 0.10],    /* A5                   */
      [1047,1120, 0.40, 'square', 0.13],    /* C6 — triumphant peak */
      [988, 1600, 0.15, 'square', 0.10],    /* B5 — graceful turn   */
      [880, 1800, 0.15, 'square', 0.10],    /* A5                   */
      [784, 2000, 0.35, 'square', 0.12],    /* G5 — resolves        */
    ];
    /* Phase 2: marching tension builds (2.5-5s) */
    const march = [
      [330, 2600, 0.14, 'square', 0.09],    /* E4 — drops low       */
      [349, 2780, 0.14, 'square', 0.09],    /* F4                   */
      [330, 2960, 0.14, 'square', 0.09],    /* E4 — restless loop   */
      [294, 3140, 0.20, 'square', 0.10],    /* D4 — descend         */
      [330, 3400, 0.14, 'square', 0.09],    /* E4                   */
      [392, 3560, 0.14, 'square', 0.10],    /* G4 — rising hope     */
      [440, 3720, 0.14, 'square', 0.10],    /* A4                   */
      [392, 3900, 0.20, 'square', 0.10],    /* G4 — pulls back      */
      [349, 4100, 0.14, 'square', 0.09],    /* F4                   */
      [330, 4280, 0.14, 'square', 0.09],    /* E4                   */
      [294, 4440, 0.25, 'square', 0.10],    /* D4 — suspense        */
      [262, 4720, 0.40, 'square', 0.11],    /* C4 — unresolved end  */
    ];
    /* bass: victory chords then tense pedal tone */
    const bass = [
      [131, 0,    0.40, 'triangle', 0.06],  /* C3                   */
      [165, 400,  0.35, 'triangle', 0.06],  /* E3                   */
      [131, 1120, 0.45, 'triangle', 0.07],  /* C3                   */
      [196, 2000, 0.40, 'triangle', 0.06],  /* G3 — resolves        */
      [165, 2600, 0.30, 'triangle', 0.05],  /* E3 — tension starts  */
      [147, 3140, 0.30, 'triangle', 0.05],  /* D3                   */
      [131, 3720, 0.30, 'triangle', 0.05],  /* C3                   */
      [110, 4280, 0.50, 'triangle', 0.06],  /* A2 — dark rumble     */
    ];
    /* percussion: snare-like march rhythm in phase 2 */
    const drums = [
      [2600], [2960], [3400], [3720], [4100], [4440], [4720],
    ];
    for (const [f, d, dur, type, vol] of [...victory, ...march, ...bass]) {
      setTimeout(() => osc(type, f, dur, vol), d);
    }
    for (const [d] of drums) {
      setTimeout(() => noise(0.04, 0.06), d);
    }
  },

  /* ~5 second game-over melody — melancholy reflection on defeat */
  gameOverMelody() {
    /* slow, descending minor phrases with long, sorrowful notes */
    const melody = [
      [440, 0,    0.50, 'triangle', 0.11],  /* A4 — mournful open   */
      [415, 600,  0.50, 'triangle', 0.11],  /* Ab4 — chromatic ache  */
      [392, 1200, 0.60, 'triangle', 0.10],  /* G4 — settles          */
      [349, 2000, 0.40, 'triangle', 0.10],  /* F4 — sighing descent  */
      [330, 2500, 0.55, 'triangle', 0.10],  /* E4 — lingers          */
      [294, 3200, 0.40, 'triangle', 0.09],  /* D4                    */
      [262, 3700, 0.50, 'triangle', 0.09],  /* C4 — fading           */
      [247, 4300, 0.70, 'triangle', 0.08],  /* B3 — dark, unresolved */
    ];
    /* counter-melody: sparse, echoing higher notes */
    const echo = [
      [659, 300,  0.35, 'square', 0.04],    /* E5 — distant echo    */
      [587, 1500, 0.35, 'square', 0.04],    /* D5                   */
      [523, 2700, 0.35, 'square', 0.04],    /* C5                   */
      [494, 3900, 0.40, 'square', 0.03],    /* B4 — fading whisper  */
    ];
    /* bass: low, slow heartbeat-like pulse */
    const bass = [
      [110, 0,    0.80, 'sawtooth', 0.05],  /* A2                   */
      [104, 1200, 0.80, 'sawtooth', 0.05],  /* Ab2                  */
      [98,  2500, 0.80, 'sawtooth', 0.04],  /* G2                   */
      [82,  3700, 1.00, 'sawtooth', 0.04],  /* E2 — deep fade       */
    ];
    for (const [f, d, dur, type, vol] of [...melody, ...echo, ...bass]) {
      setTimeout(() => osc(type, f, dur, vol), d);
    }
  },
};
