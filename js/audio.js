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

  /* ~5 second hero's journey title melody — hopeful departure, rising courage */
  titleMelody() {
    /* The melody tells a story:
       1. Quiet, contemplative start — a lone hero at dawn
       2. A call to adventure — ascending with growing confidence
       3. A brief moment of doubt — descending minor turn
       4. Resolute determination — the hero steps forward into the unknown */
    const melody = [
      /* ── dawn: soft, open, a single figure on the horizon ── */
      [330, 0,    0.35, 'square', 0.08],    /* E4 — gentle open       */
      [392, 400,  0.30, 'square', 0.08],    /* G4 — looking outward   */
      [440, 750,  0.45, 'square', 0.09],    /* A4 — the road ahead    */
      /* ── the call: courage builds, steps quicken ── */
      [392, 1300, 0.18, 'square', 0.10],    /* G4 — first step        */
      [440, 1500, 0.18, 'square', 0.10],    /* A4 — then another      */
      [523, 1700, 0.18, 'square', 0.11],    /* C5 — confidence grows  */
      [587, 1900, 0.35, 'square', 0.12],    /* D5 — heart swells      */
      [659, 2300, 0.40, 'square', 0.12],    /* E5 — the horizon calls */
      /* ── doubt: a brief shadow crosses the path ── */
      [587, 2800, 0.20, 'square', 0.10],    /* D5 — hesitation        */
      [523, 3000, 0.20, 'square', 0.10],    /* C5 — looking back      */
      [494, 3200, 0.30, 'square', 0.09],    /* B4 — the weight of it  */
      /* ── resolve: turns forward, strides into destiny ── */
      [523, 3600, 0.18, 'square', 0.11],    /* C5 — deep breath       */
      [587, 3800, 0.18, 'square', 0.11],    /* D5 — shoulders square  */
      [659, 4000, 0.22, 'square', 0.12],    /* E5 — eyes ahead        */
      [784, 4250, 0.60, 'square', 0.13],    /* G5 — into the unknown  */
    ];
    /* warm sustained harmony — like a campfire or a remembered home */
    const harmony = [
      [330, 0,    0.50, 'triangle', 0.05],  /* E4 — warmth            */
      [262, 750,  0.45, 'triangle', 0.05],  /* C4 — hearth            */
      [294, 1700, 0.35, 'triangle', 0.05],  /* D4 — the road          */
      [330, 2300, 0.40, 'triangle', 0.05],  /* E4 — courage           */
      [262, 3200, 0.35, 'triangle', 0.05],  /* C4 — memory            */
      [294, 3800, 0.20, 'triangle', 0.05],  /* D4 — resolve           */
      [330, 4250, 0.60, 'triangle', 0.06],  /* E4 — onward            */
    ];
    /* bass: slow, grounding footsteps of the journey */
    const bass = [
      [165, 0,    0.50, 'triangle', 0.06],  /* E3 — dawn              */
      [131, 750,  0.50, 'triangle', 0.06],  /* C3 — home              */
      [147, 1700, 0.40, 'triangle', 0.06],  /* D3 — the path          */
      [165, 2300, 0.45, 'triangle', 0.06],  /* E3 — ascending         */
      [131, 3200, 0.40, 'triangle', 0.06],  /* C3 — shadow            */
      [147, 3800, 0.25, 'triangle', 0.06],  /* D3 — turning point     */
      [196, 4250, 0.70, 'triangle', 0.07],  /* G3 — destiny           */
    ];
    /* gentle percussion — like distant drums or a heartbeat */
    const drums = [
      [1300], [1700], [1900], [3600], [3800], [4000],
    ];
    for (const [f, d, dur, type, vol] of [...melody, ...harmony, ...bass]) {
      setTimeout(() => osc(type, f, dur, vol), d);
    }
    for (const [d] of drums) {
      setTimeout(() => noise(0.03, 0.04), d);
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

  /* ~6 second victory fanfare — triumphant, celebratory, resolving */
  victoryMelody() {
    /* heroic ascending fanfare */
    const melody = [
      [523, 0,    0.25, 'square', 0.12],    /* C5 — bold start       */
      [659, 280,  0.25, 'square', 0.12],    /* E5                    */
      [784, 560,  0.40, 'square', 0.13],    /* G5 — hold             */
      [1047,1050, 0.25, 'square', 0.13],    /* C6 — triumphant leap  */
      [988, 1350, 0.20, 'square', 0.12],    /* B5                    */
      [1047,1580, 0.20, 'square', 0.12],    /* C6                    */
      [1175,1800, 0.50, 'square', 0.14],    /* D6 — soaring peak     */
      [1047,2400, 0.20, 'square', 0.12],    /* C6 — gentle descent   */
      [988, 2650, 0.20, 'square', 0.12],    /* B5                    */
      [880, 2900, 0.20, 'square', 0.12],    /* A5                    */
      [784, 3150, 0.50, 'square', 0.13],    /* G5 — rest             */
      /* peaceful resolution */
      [659, 3750, 0.20, 'square', 0.11],    /* E5                    */
      [784, 4000, 0.25, 'square', 0.12],    /* G5                    */
      [880, 4280, 0.20, 'square', 0.12],    /* A5                    */
      [1047,4520, 0.70, 'square', 0.13],    /* C6 — final resolve    */
    ];
    /* harmony — warm major thirds */
    const harmony = [
      [392, 0,    0.25, 'triangle', 0.06],  /* G4                    */
      [523, 560,  0.40, 'triangle', 0.06],  /* C5                    */
      [659, 1050, 0.25, 'triangle', 0.06],  /* E5                    */
      [784, 1800, 0.50, 'triangle', 0.07],  /* G5                    */
      [659, 2900, 0.20, 'triangle', 0.06],  /* E5                    */
      [523, 3150, 0.50, 'triangle', 0.06],  /* C5                    */
      [523, 4000, 0.25, 'triangle', 0.06],  /* C5                    */
      [659, 4520, 0.70, 'triangle', 0.07],  /* E5 — warm close       */
    ];
    /* bass: solid major foundation */
    const bass = [
      [131, 0,    0.50, 'triangle', 0.07],  /* C3                    */
      [165, 1050, 0.50, 'triangle', 0.07],  /* E3                    */
      [196, 1800, 0.50, 'triangle', 0.07],  /* G3                    */
      [131, 2900, 0.50, 'triangle', 0.07],  /* C3                    */
      [131, 4000, 0.40, 'triangle', 0.06],  /* C3                    */
      [131, 4520, 0.80, 'triangle', 0.08],  /* C3 — final            */
    ];
    for (const [f, d, dur, type, vol] of [...melody, ...harmony, ...bass]) {
      setTimeout(() => osc(type, f, dur, vol), d);
    }
  },
};
