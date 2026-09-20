import {
  TILE, COLS, ROWS, SIDEBAR_W, CANVAS_W, CANVAS_H, C,
  T_PLAIN, T_FOREST, T_MOUNTAIN, T_WATER, T_WALL, T_ROAD, T_FORT,
  T_HILL, T_SWAMP, T_FORD, T_BRIDGE,
  S_TITLE, S_ACTION_MENU, S_WIN, S_LOSE, S_ATK_SELECT, S_COMBAT_ANIM,
  S_TRANS_OUT, S_TRANS_IN, S_VICTORY, S_DRAFT, S_BONUS, FINAL_FLOOR,
} from './constants.js';
import { forecast, canCounter, inRange } from './combat.js';
import { isMuted } from './audio.js';
import { CLASS_INFO, DRAFT_POOL, XP_PER_LEVEL } from './units.js';

const FONT = '"Press Start 2P", monospace';

/* Portrait info-pane font/spacing scale — always at least MIN (readability
   is the priority: a phone-shaped viewport pays for this with a little
   letterboxing on the map, which is an acceptable trade), but grows past
   that for free on taller aspect ratios up to CAP, where it stops growing
   even on unusually tall/narrow viewports. */
const SIDEBAR_MIN_SCALE = 2.0;
const SIDEBAR_SCALE_CAP = 2.6;

/* Every text element in the info panel — unit stats, terrain, combat/
   heal/steal forecasts, play log, and the header (LEVEL/floor/phase/
   turn) — is drawn at this one consistent size, so nothing in the pane
   reads bigger or smaller than anything else. It used to get an extra
   2x boost on top of the ambient scale below (in portrait only), which
   made it inconsistent with the header text (drawn at the ambient scale
   alone) — retired in favor of one flat size for all of it, matching
   the header's own "LEVEL 1" size, confirmed the right readable size.
   The action buttons stay at the ambient scale alone (confirmed a good
   size already) and are untouched by this constant. */
const PANE_FONT = 10;

/* Local height budget for the portrait sidebar's content (see
   _applyLayout) — since every element now scales only with the ambient
   ratio below rather than an extra content-specific multiplier, this no
   longer needs the much larger budget the old 2x-boosted content used
   to require. Growing this past what the content actually needs shrinks
   the map (the fit-to-screen zoom goes height-bound instead of
   width-bound — see the comment above _sidebar()'s budget math), so it's
   kept close to the real worst-case content height. */
const PORTRAIT_INFO_BUDGET = 620;

/* Portrait title-screen canvas — genuinely portrait-shaped (unlike the
   1024×600 landscape one) so the starfield background, battle scene and
   buttons all fill a tall phone screen instead of sitting in a small
   landscape rectangle in the middle of it. */
const TITLE_PORTRAIT_W = 480;
const TITLE_PORTRAIT_H = 820;

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.cx = canvas.getContext('2d');
    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;
    this.t = 0;
    this._btn = null;             /* end-turn button bounds */
    this._sndBtn = null;          /* sound toggle button bounds */
    this._draftBounds = null;     /* draft screen click targets */
    this._bonusBounds = null;     /* bonus screen click targets */
    this._rewindBtnBounds = null; /* ↺ charge counter bounds (informational) */
    this._logEntryBounds = null;  /* clickable log entry hit areas */
    this._logScrollUp    = null;  /* ▲ scroll arrow bounds */
    this._logScrollDown  = null;  /* ▼ scroll arrow bounds */
    this._logPanelBounds = null;  /* full log panel area (for wheel events) */
    this._histContinueBtn     = null; /* history view CONTINUE button */
    this._histCancelBtn       = null; /* history view CANCEL button */
    this._atkConfirmAttackBtn = null; /* attack confirm ATTACK button */
    this._atkConfirmCancelBtn = null; /* attack confirm CANCEL button */
    this._victoryBtns         = null; /* {end, cont} victory screen buttons */
    this._regenBtn            = null; /* regen map button (visible at level start only) */
    this._histNavOlder        = null; /* ◄ OLDER button in history banner */
    this._histNavNewer        = null; /* NEWER ► button in history banner */
    this._menuGeom            = { rowOffset: 20, itemH: 40 }; /* action-menu row geometry (see _menu) */

    /* ── responsive layout ── */
    this._sideRect = { x: COLS * TILE, y: 0, w: SIDEBAR_W, h: CANVAS_H, scale: 1 }; /* current info-pane rect */
    this._useCoverFit = false; /* true in portrait gameplay — see _applyLayout */
    this.onResize  = null; /* set by Game — called when the canvas backing store is resized */
  }

  tick() { this.t++; }
  get endTurnBtn() { return this._btn; }
  get soundBtn()   { return this._sndBtn; }

  /* ═══════════ RESPONSIVE LAYOUT ═══════════
     Decides whether the info pane sits beside the map (landscape) or
     below it (portrait), and resizes the canvas backing store to match.
     The team-draft screen reflows to a single column in portrait, and the
     title screen switches to a genuinely portrait-shaped canvas.
     Bonus/Victory keep the fixed widescreen canvas — they're full-bleed
     art screens with no responsive layout of their own. */
  _applyLayout(g) {
    const vp = window.visualViewport;
    const vw = vp ? vp.width  : window.innerWidth;
    const vh = vp ? vp.height : window.innerHeight;
    const portrait = vh > vw;
    const gameplay = g.state !== S_TITLE && g.state !== S_DRAFT &&
                     g.state !== S_BONUS && g.state !== S_VICTORY;
    const mapW = COLS * TILE, mapH = ROWS * TILE;

    let w, h;
    this._draftPortrait = false;
    this._titlePortrait = false;
    /* gameplay's portrait canvas is deliberately much taller than the
       viewport (map on top, full-width info pane below) — told to
       TouchController so it can fill the screen edge-to-edge on the map
       instead of letterboxing to fit the whole tall canvas in view; see
       the comment in touch.js._fitToScreen(). */
    this._useCoverFit = gameplay && portrait;

    if (gameplay && portrait) {
      /* Grow the panel's own font/spacing scale to fill the screen — a
         MIN is guaranteed regardless of aspect ratio (readability over a
         perfectly letterbox-free map), and it grows further for free on
         tall/narrow phones where there's more room to give, up to CAP. */
      const maxCanvasH = vh * (mapW / vw);        // canvas height before the fit becomes height-bound
      const maxSideH   = Math.max(CANVAS_H, maxCanvasH - mapH);
      const safeScale  = maxSideH / CANVAS_H;
      const scale      = Math.min(SIDEBAR_SCALE_CAP, Math.max(SIDEBAR_MIN_SCALE, safeScale));

      w = mapW;
      /* the local height budget is bigger than the landscape design's 600
         (PORTRAIT_INFO_BUDGET) to fit the boosted info content below the
         buttons without clipping it or squeezing the log to its minimum —
         `scale` above is intentionally still computed from the plain 600
         reference so it keeps sizing the buttons the same either way */
      h = mapH + Math.round(PORTRAIT_INFO_BUDGET * scale);
      /* panel spans the full map width below it; _sidebar() renders its
         content in a local, unscaled coordinate space and stretches it to
         fill this rect, so it's always "as wide as the playfield" */
      this._sideRect = { x: 0, y: mapH, w: mapW, h: h - mapH, scale };
    } else if (g.state === S_DRAFT && portrait) {
      /* team-draft screen: stack the class cards in a single column so
         reading them only ever needs vertical scrolling/zooming */
      this._draftPortrait = true;
      w = mapW;
      h = this._draftPortraitHeight(g);
    } else if (g.state === S_TITLE && portrait) {
      this._titlePortrait = true;
      w = TITLE_PORTRAIT_W;
      h = TITLE_PORTRAIT_H;
    } else {
      w = CANVAS_W;
      h = CANVAS_H;
      if (gameplay) this._sideRect = { x: mapW, y: 0, w: SIDEBAR_W, h: CANVAS_H, scale: 1 };
    }

    const changed = this.cv.width !== w || this.cv.height !== h;
    if (changed) { this.cv.width = w; this.cv.height = h; }
    return changed;
  }

  /* Total canvas height needed to stack every draft-pool class card in a
     single column (pool size is fixed once the draft screen opens, so this
     never changes mid-screen — no resize jank while picking). */
  _draftPortraitHeight(g) {
    const n = (g._draftPool && g._draftPool.length) || 7;
    const cardH = 220, gap = 12, startY = 160, footerH = 110;
    return startY + n * (cardH + gap) - gap + footerH;
  }

  /* ═══════════ MAIN DRAW ═══════════ */
  draw(g) {
    const c = this.cx;
    if (this._applyLayout(g) && this.onResize) this.onResize();
    c.clearRect(0, 0, this.cv.width, this.cv.height);

    if (g.state === S_TITLE) {
      this._title(g);
      this._soundToggle(0, this._titlePortrait ? 12 : CANVAS_H - 40, this.cv.width);
      return;
    }
    if (g.state === S_DRAFT)   { this._draftScreen(g); return; }
    if (g.state === S_BONUS)   { this._bonusScreen(g); return; }
    if (g.state === S_VICTORY) { this._victoryScreen(g); return; }

    this._map(g.map);

    /* transition overlays — skip normal highlights/units */
    if (g.state === S_TRANS_OUT || g.state === S_TRANS_IN) {
      this._transOverlay(g);
      this._sidebar(g);
      return;
    }

    /* ── history view — frozen snapshot of the past ── */
    if (g._historyView) {
      const snap = g._historyView.snap;
      this._droppedItemsList(snap.droppedItems);
      this._unitsFromSnap(snap);
      this._historyOverlay(g);
      this._sidebar(g);
      return;
    }

    this._highlights(g);
    this._droppedItems(g);
    this._units(g);

    this._cursor(g);
    this._battleToasts(g);
    this._sidebar(g);
    if (g.state === S_ACTION_MENU) this._menu(g);
    if (g.state === S_ATK_SELECT) this._atkPrompt();
    if (g._atkConfirm) this._atkConfirmOverlay(g);
    if (g.state === S_COMBAT_ANIM && g._enemyCombatPending) this._enemyAtkBanner();
    this._tutBanner(g);
    if (g.state === S_WIN || g.state === S_LOSE) this._overlay(g);
  }

  /* ═══════════ BATTLE TOASTS ═══════════
     Play-log entries that happen at a spot on the map (strikes, misses,
     heals, level-ups…) float over that tile: fade in while the text grows,
     hold, then fade out — see Game._addLog. */
  _battleToasts(g) {
    const toasts = g._toasts;
    if (!toasts || !toasts.length) return;
    const c = this.cx;
    const mapW = COLS * TILE, mapH = ROWS * TILE;
    const units = [...g.players, ...g.enemies].filter(u => u.alive);
    /* timeline (ms): fade in while growing, sit fully expanded long enough to
       read, then fade out */
    const GROW = 500, HOLD = 10000, FADE = 700;
    const START = 0.75, END = 1.35; // text size multiplier at birth / fully grown
    const now = performance.now();

    for (let i = toasts.length - 1; i >= 0; i--) {
      if (now - toasts[i].born >= GROW + HOLD + FADE) toasts.splice(i, 1);
    }

    /* the map is drawn at a fixed size and then shrunk to fit a phone, so
       bump the text with the info pane's portrait scale to keep it legible */
    const base = 11 * Math.max(1, this._sideRect.scale * 0.4);
    const maxW = mapW * 0.8;
    const placed = [];

    c.save();
    c.textAlign = 'center';
    c.lineJoin = 'round';
    for (const t of toasts) {          // oldest first, so newer text stacks above
      const elapsed = now - t.born;
      const grow = Math.min(1, elapsed / GROW);

      /* wrap once at the largest size so lines don't reflow while it grows */
      if (t._wrapBase !== base) {
        c.font = `${base * END}px ${FONT}`;
        /* lines are char ranges into the text, so name colours survive wrapping */
        const lines = [];
        let start = 0, pos = 0;
        for (const word of t.text.split(' ')) {
          const end = pos + word.length;
          if (end > start && pos > start && c.measureText(t.text.slice(start, end)).width > maxW) {
            lines.push({ s: start, e: pos - 1 });
            start = pos;
          }
          pos = end + 1;
        }
        lines.push({ s: start, e: t.text.length });
        t._lines = lines.slice(0, 4).map(l => this._sliceRuns(t.runs, l.s, l.e));
        t._wrapBase = base;
      }

      const fs = base * (START + (END - START) * grow);
      const lineH = fs * 1.35;
      const alpha = elapsed < GROW ? grow
                  : elapsed > GROW + HOLD ? 1 - (elapsed - GROW - HOLD) / FADE
                  : 1;
      c.font = `${fs}px ${FONT}`;
      const w = Math.max(...t._lines.map(l => this._runsWidth(l)));
      const h = t._lines.length * lineH;

      /* the fight fills these tiles; the text sits above or below them so it
         never covers the fighters (and steers clear of other units too) */
      const bx = (Math.min(t.tx, t.ox) + Math.max(t.tx, t.ox) + 1) * TILE / 2;
      const by0 = Math.min(t.ty, t.oy) * TILE, by1 = (Math.max(t.ty, t.oy) + 1) * TILE;
      const cx = Math.min(mapW - w / 2 - 6, Math.max(w / 2 + 6, bx));
      const gap = 6 + 8 * (base / 11) * grow;   // drifts away from the fight as it grows
      const rectAt = top => ({ x: cx - w / 2, y: top, w, h });
      const hits = r => placed.some(p => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y);
      const place = dir => {
        let top = dir < 0 ? by0 - gap - h : by1 + gap;
        for (let n = 0; n < 12 && hits(rectAt(top)); n++) top += dir * lineH * 0.5;
        return top;
      };
      if (!t._side) {   // pick a side once, so the text doesn't jump if units move
        const cost = top => {
          const r = rectAt(top);
          const off = Math.max(0, 2 - top) + Math.max(0, top + h - (mapH - 2));
          const onUnit = units.filter(u => r.x < (u.x + 1) * TILE && r.x + r.w > u.x * TILE
                                        && r.y < (u.y + 1) * TILE && r.y + r.h > u.y * TILE).length;
          return off * 10 + onUnit * 100;
        };
        t._side = cost(place(1)) < cost(place(-1)) ? 1 : -1;   // ties go above
      }
      let top = place(t._side);
      top = Math.max(2, Math.min(mapH - h - 2, top));
      placed.push(rectAt(top));

      c.globalAlpha = Math.max(0, Math.min(1, alpha));
      c.lineWidth = Math.max(3, fs * 0.3);
      c.strokeStyle = 'rgba(0,0,0,0.85)';
      t._lines.forEach((runs, i) => this._fillRuns(runs, cx, top + fs + i * lineH, 'center', t.color, true));
    }
    c.restore();
  }

  /* ── coloured text runs [{t, c?}] — unit names carry their own colour, the
     rest falls back to the entry colour (see Game._nameRuns) ── */
  _runsWidth(runs) {
    return runs.reduce((sum, r) => sum + this.cx.measureText(r.t).width, 0);
  }

  /* the part of `runs` covering chars [s, e) */
  _sliceRuns(runs, s, e) {
    const out = [];
    let pos = 0;
    for (const r of runs) {
      const a = Math.max(s, pos), b = Math.min(e, pos + r.t.length);
      if (b > a) out.push({ t: r.t.slice(a - pos, b - pos), c: r.c });
      pos += r.t.length;
    }
    return out;
  }

  /* draw one line of runs at baseline y; font must already be set */
  _fillRuns(runs, x, y, align, defColor, outline = false) {
    const c = this.cx;
    const prev = c.textAlign;
    const total = this._runsWidth(runs);
    let px = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    c.textAlign = 'left';
    for (const r of runs) {
      if (outline) c.strokeText(r.t, px, y);
      c.fillStyle = r.c || defColor;
      c.fillText(r.t, px, y);
      px += c.measureText(r.t).width;
    }
    c.textAlign = prev;
  }

  /* ═══════════ TITLE ═══════════ */
  _title(g) {
    const c = this.cx;
    const W = this.cv.width, H = this.cv.height;
    c.fillStyle = '#0a0a1a';
    c.fillRect(0, 0, W, H);

    /* stars — fill whatever shape the canvas actually is (portrait or
       landscape) so the starfield is never a landscape-only backdrop.
       Twinkling (brightness animated per-star via `t`) rather than static,
       same formula as the victory screen's starfield. */
    for (let i = 0; i < 160; i++) {
      const sx = (i * 137 + 50) % W;
      const sy = (i * 97  + 30) % H;
      const twinkle = 0.3 + Math.sin(this.t * 0.05 + i * 2) * 0.7;
      c.fillStyle = `rgba(255,255,255,${Math.max(0, twinkle)})`;
      c.fillRect(sx, sy, 1 + (i % 2), 1 + (i % 2));
    }

    if (this._titlePortrait) { this._titlePortraitLayout(g, W, H); return; }

    const mx = W / 2, my = H / 2;

    /* ── 8-bit battle scene ── */
    this._titleBattle(c, mx, my);

    /* title text */
    c.textAlign = 'center';
    c.fillStyle = C.GOLD;
    c.font = `24px ${FONT}`;
    c.fillText('EMBLEM TACTICS', mx, my - 100);

    c.fillStyle = '#5050cc';
    c.font = `10px ${FONT}`;
    c.fillText('ROGUELIKE TACTICAL RPG', mx, my - 72);

    /* menu buttons */
    const bw = 200, bh = 32, gap = 10;
    const bx = mx - bw / 2;
    const hasSave = g && g._hasSave;

    /* shift everything down one slot if CONTINUE is shown */
    const contY = hasSave ? my + 30 : null;
    const by0   = hasSave ? my + 30 + bh + gap : my + 72;  // TUTORIAL
    const by1   = by0 + bh + gap;                           // EASY
    const by2   = by1 + bh + gap;                           // MEDIUM
    const by3   = by2 + bh + gap;                           // HARD

    /* CONTINUE (only when a save exists) */
    if (hasSave) {
      c.fillStyle = '#1a1505'; c.fillRect(bx, contY, bw, bh);
      c.strokeStyle = C.GOLD;  c.lineWidth = 2; c.strokeRect(bx, contY, bw, bh);
      c.fillStyle = C.GOLD; c.font = `9px ${FONT}`; c.textAlign = 'center';
      c.fillText('CONTINUE', mx, contY + 21);
    }

    /* TUTORIAL button */
    c.fillStyle = '#1a2a60'; c.fillRect(bx, by0, bw, bh);
    c.strokeStyle = '#4060d0'; c.lineWidth = 2; c.strokeRect(bx, by0, bw, bh);
    c.fillStyle = '#80b0ff'; c.font = `10px ${FONT}`; c.textAlign = 'center';
    c.fillText('TUTORIAL', mx, by0 + 21);

    /* EASY button */
    c.fillStyle = '#1a3010'; c.fillRect(bx, by1, bw, bh);
    c.strokeStyle = '#40a030'; c.lineWidth = 2; c.strokeRect(bx, by1, bw, bh);
    c.fillStyle = '#60e040'; c.font = `10px ${FONT}`;
    c.fillText('EASY', mx, by1 + 21);

    /* MEDIUM button */
    c.fillStyle = '#2a1a10'; c.fillRect(bx, by2, bw, bh);
    c.strokeStyle = '#c08030'; c.lineWidth = 2; c.strokeRect(bx, by2, bw, bh);
    c.fillStyle = C.GOLD; c.font = `10px ${FONT}`;
    c.fillText('MEDIUM', mx, by2 + 21);

    /* HARD button */
    c.fillStyle = '#301010'; c.fillRect(bx, by3, bw, bh);
    c.strokeStyle = '#c03030'; c.lineWidth = 2; c.strokeRect(bx, by3, bw, bh);
    c.fillStyle = '#ff4040'; c.font = `10px ${FONT}`;
    c.fillText('HARD', mx, by3 + 21);

    /* store button bounds for click detection */
    this._titleBtns = {
      tutorial: { x: bx, y: by0, w: bw, h: bh },
      easy:     { x: bx, y: by1, w: bw, h: bh },
      medium:   { x: bx, y: by2, w: bw, h: bh },
      hard:     { x: bx, y: by3, w: bw, h: bh },
    };
    if (hasSave) this._titleBtns.cont = { x: bx, y: contY, w: bw, h: bh };

    c.fillStyle = '#606060';
    c.font = `7px ${FONT}`;
    c.fillText('Select unit \u2192 click destination \u2192 Attack / Wait', mx, by3 + bh + 20);
    c.fillText('Defeat all enemies to advance.  Lord dies = Game Over.', mx, by3 + bh + 36);
    c.fillText('Weapon triangle: Sword > Axe > Lance > Sword', mx, by3 + bh + 52);
  }

  /* Portrait title layout — a genuinely tall/narrow arrangement rather
     than the landscape design shrunk to fit. Buttons were already stacked
     vertically, so the main changes are: bigger fonts/buttons throughout,
     and the battle scene (self-contained, drawn relative to its own
     center) scaled up in place via a transform instead of redrawn. */
  _titlePortraitLayout(g, W, H) {
    const c = this.cx;
    const mx = W / 2;
    c.textAlign = 'center';

    /* title */
    c.fillStyle = C.GOLD;
    c.font = `28px ${FONT}`;
    c.fillText('EMBLEM TACTICS', mx, 76);
    c.fillStyle = '#5050cc';
    c.font = `12px ${FONT}`;
    c.fillText('ROGUELIKE TACTICAL RPG', mx, 104);

    /* battle scene, scaled up around its own center point */
    const bScale = 1.25, bCenterY = 300;
    c.save();
    c.translate(mx, bCenterY);
    c.scale(bScale, bScale);
    this._titleBattle(c, 0, 0);
    c.restore();

    /* menu buttons */
    const bw = 280, bh = 44, gap = 14;
    const bx = mx - bw / 2;
    const hasSave = g && g._hasSave;

    const startY = 460;
    const contY = hasSave ? startY : null;
    const by0   = hasSave ? startY + bh + gap : startY;  // TUTORIAL
    const by1   = by0 + bh + gap;                         // EASY
    const by2   = by1 + bh + gap;                         // MEDIUM
    const by3   = by2 + bh + gap;                         // HARD

    /* CONTINUE (only when a save exists) */
    if (hasSave) {
      c.fillStyle = '#1a1505'; c.fillRect(bx, contY, bw, bh);
      c.strokeStyle = C.GOLD;  c.lineWidth = 2; c.strokeRect(bx, contY, bw, bh);
      c.fillStyle = C.GOLD; c.font = `13px ${FONT}`; c.textAlign = 'center';
      c.fillText('CONTINUE', mx, contY + bh / 2 + 5);
    }

    /* TUTORIAL button */
    c.fillStyle = '#1a2a60'; c.fillRect(bx, by0, bw, bh);
    c.strokeStyle = '#4060d0'; c.lineWidth = 2; c.strokeRect(bx, by0, bw, bh);
    c.fillStyle = '#80b0ff'; c.font = `13px ${FONT}`; c.textAlign = 'center';
    c.fillText('TUTORIAL', mx, by0 + bh / 2 + 5);

    /* EASY button */
    c.fillStyle = '#1a3010'; c.fillRect(bx, by1, bw, bh);
    c.strokeStyle = '#40a030'; c.lineWidth = 2; c.strokeRect(bx, by1, bw, bh);
    c.fillStyle = '#60e040'; c.font = `13px ${FONT}`;
    c.fillText('EASY', mx, by1 + bh / 2 + 5);

    /* MEDIUM button */
    c.fillStyle = '#2a1a10'; c.fillRect(bx, by2, bw, bh);
    c.strokeStyle = '#c08030'; c.lineWidth = 2; c.strokeRect(bx, by2, bw, bh);
    c.fillStyle = C.GOLD; c.font = `13px ${FONT}`;
    c.fillText('MEDIUM', mx, by2 + bh / 2 + 5);

    /* HARD button */
    c.fillStyle = '#301010'; c.fillRect(bx, by3, bw, bh);
    c.strokeStyle = '#c03030'; c.lineWidth = 2; c.strokeRect(bx, by3, bw, bh);
    c.fillStyle = '#ff4040'; c.font = `13px ${FONT}`;
    c.fillText('HARD', mx, by3 + bh / 2 + 5);

    /* store button bounds for click detection — already absolute, no
       transform is active here (only the battle scene above used one,
       and it was restored) */
    this._titleBtns = {
      tutorial: { x: bx, y: by0, w: bw, h: bh },
      easy:     { x: bx, y: by1, w: bw, h: bh },
      medium:   { x: bx, y: by2, w: bw, h: bh },
      hard:     { x: bx, y: by3, w: bw, h: bh },
    };
    if (hasSave) this._titleBtns.cont = { x: bx, y: contY, w: bw, h: bh };

    c.fillStyle = '#707070';
    c.font = `7px ${FONT}`;
    c.fillText('Select unit → click destination → Attack / Wait', mx, by3 + bh + 26);
    c.fillText('Defeat all enemies to advance.  Lord dies = Game Over.', mx, by3 + bh + 44);
    c.fillText('Weapon triangle: Sword > Axe > Lance > Sword', mx, by3 + bh + 62);
  }

  /* ── Pixel art battle scene for title screen ──
     A looping fight: the Lord strikes the Brigand, the Brigand strikes back,
     then both go for it at once and the weapons clash. Each blow is a
     wind-up, a fast lunging swing, then an impact — sparks at the weapon
     tip, a damage number, recoil, a white hit-flash and a little screen
     shake. Everything is drawn in "art pixels" (P screen px each) relative
     to the fighter's feet. */
  _titleBattle(c, mx, my) {
    const P = 3;
    const CYCLE = 300;
    const ph = this.t % CYCLE;
    const ease = k => k * k * (3 - 2 * k);
    const lerp = (a, b, k) => a + (b - a) * k;

    /* a blow starts at frame s and lands HIT frames later */
    const LORD_ATK = 30, BRIG_ATK = 130, CLASH_ATK = 210, HIT = 34;
    const BLOW  = { reach: 22, strike: 0.15, follow: 0.45 };   // aimed at the chest
    const CLASH = { reach: 15, strike: -0.25, follow: -0.05 }; // weapons meet high, in the middle
    const REST = -1.2, WIND = -2.6;                            // weapon-arm angle: 0 = forward, negative = up/back

    const pose = (s, b) => {
      const u = ph - s;
      if (u < 0 || u >= 80) return { theta: REST, lunge: 0 };
      if (u < 25) { const k = ease(u / 25);           return { theta: lerp(REST, WIND, k),         lunge: lerp(0, -4, k) }; }
      if (u < HIT) { const k = (u - 25) / (HIT - 25); return { theta: lerp(WIND, b.strike, k * k), lunge: lerp(-4, b.reach, ease(k)) }; }
      if (u < 50) { const k = (u - HIT) / 16;         return { theta: lerp(b.strike, b.follow, k), lunge: b.reach }; }
      const k = ease((u - 50) / 30);                  return { theta: lerp(b.follow, REST, k),     lunge: lerp(b.reach, 0, k) };
    };
    const lordPose = ph >= CLASH_ATK ? pose(CLASH_ATK, CLASH) : pose(LORD_ATK, BLOW);
    const brigPose = ph >= CLASH_ATK ? pose(CLASH_ATK, CLASH) : pose(BRIG_ATK, BLOW);

    /* how a fighter reacts to being hit at frame `at` */
    const react = at => {
      const dt = ph - at;
      if (dt < 0 || dt > 40) return { push: 0, flash: false, shake: 0 };
      return {
        push: 16 * Math.exp(-dt / 9),
        flash: dt < 8 && (dt < 4 || dt % 2 === 0),
        shake: dt < 12 ? Math.sin(dt * 2.2) * 3 * (1 - dt / 12) : 0,
      };
    };
    const onBrig = react(LORD_ATK + HIT);    // Lord's blow lands on the Brigand
    const onLord = react(BRIG_ATK + HIT);    // Brigand's blow lands on the Lord
    const clash  = react(CLASH_ATK + HIT);   // both recoil from the clash
    const lordPush = onLord.push + clash.push, brigPush = onBrig.push + clash.push;
    const lordFlash = onLord.flash || clash.flash, brigFlash = onBrig.flash || clash.flash;
    const shakeX = onBrig.shake + onLord.shake + clash.shake * 1.6;
    const shakeY = Math.abs(clash.shake) * 0.5;

    const feetY = my + 42;
    const lordX = mx - 58 + lordPose.lunge - lordPush;
    const brigX = mx + 58 - brigPose.lunge + brigPush;
    const sway  = th => (th === REST ? Math.sin(this.t * 0.09) * 0.08 : 0);
    const lb = Math.round(Math.sin(this.t * 0.12));
    const bb = Math.round(Math.sin(this.t * 0.12 + 1.5));
    const flutter = Math.round(Math.sin(this.t * 0.15));

    c.save();
    c.translate(Math.round(shakeX), Math.round(shakeY));

    /* ground / terrain */
    c.fillStyle = '#2d5a27';
    c.fillRect(mx - 160, my + 40, 320, 60);
    c.fillStyle = '#5a8a20';
    c.fillRect(mx - 160, my + 30, 320, 14);
    c.fillStyle = '#3a6a18';
    for (const gx of [-140, -100, -20, 26, 100, 138]) {
      c.fillRect(mx + gx, my + 32, 9, 3);
      c.fillRect(mx + gx + 12, my + 30, 6, 3);
    }

    /* shadows */
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(lordX - 24, feetY + 1, 48, 5);
    c.fillRect(brigX - 27, feetY + 1, 54, 5);

    /* dust kicked up as each fighter lunges */
    const dust = (x, dir, s) => {
      const u = ph - (s + 25);
      if (u < 0 || u > 22) return;
      c.fillStyle = `rgba(190,170,120,${1 - u / 22})`;
      for (let i = 0; i < 3; i++) {
        c.fillRect(Math.round(x - dir * (6 + i * 7 + u * 0.8)), Math.round(feetY - 2 - i * 2 - u * 0.4), 5 - i, 5 - i);
      }
    };
    dust(lordX, 1, LORD_ATK);  dust(brigX, -1, BRIG_ATK);
    dust(lordX, 1, CLASH_ATK); dust(brigX, -1, CLASH_ATK);

    /* fighters are drawn facing right with (0,0) at their feet; R() takes art pixels */
    let flashing = false;
    const R = (x, y, w, h, col) => {
      c.fillStyle = flashing ? '#ffffff' : col;
      c.fillRect(x * P, y * P, w * P, h * P);
    };

    /* ── Blue Lord ── */
    c.save();
    c.translate(Math.round(lordX), feetY);
    flashing = lordFlash;
    /* cape */
    R(-8, -22 + lb, 3, 14, '#1040a0'); R(-9 + flutter, -16 + lb, 2, 10, '#0c3080');
    /* legs and boots */
    R(-5, -10, 3, 8, '#1a3080'); R(-6, -2, 4, 2, '#4a3020');
    R(0, -10, 3, 8, '#1a3080');  R(0, -2, 5, 2, '#4a3020');
    /* torso, belt, chest highlight */
    R(-5, -22 + lb, 9, 12, '#2860f0'); R(-3, -20 + lb, 2, 4, '#5090ff');
    R(-5, -11 + lb, 9, 1, '#c0a000');
    /* shield */
    R(-4, -19 + lb, 5, 8, '#3070d0');
    R(-4, -19 + lb, 5, 1, '#c0a000'); R(-4, -12 + lb, 5, 1, '#c0a000');
    R(-4, -19 + lb, 1, 8, '#c0a000'); R(0, -19 + lb, 1, 8, '#c0a000');
    R(-2, -16 + lb, 1, 2, '#c0a000');
    /* head, helmet, plume */
    R(-2, -29 + lb, 6, 6, '#f0c890');
    R(-3, -32 + lb, 8, 5, '#c0a000'); R(-1, -34 + lb, 4, 2, '#c0a000');
    R(1, -27 + lb, 3, 1, '#a08000'); R(2, -26 + lb, 1, 1, '#202020');
    R(-6 + flutter, -33 + lb, 3, 2, '#e02020'); R(-8 + flutter, -31 + lb, 3, 2, '#e02020');
    /* sword arm — swings about the shoulder */
    c.save();
    c.translate(3 * P, (-19 + lb) * P);
    c.rotate(lordPose.theta + sway(lordPose.theta));
    R(0, -1, 5, 3, '#f0c890');
    R(5, -3, 2, 7, '#c0a000');
    R(7, -1, 15, 2, '#d0d0e0'); R(9, -1, 10, 1, '#ffffff'); R(22, 0, 1, 1, '#d0d0e0');
    c.restore();
    c.restore();

    /* ── Red Brigand (mirrored to face left) ── */
    c.save();
    c.translate(Math.round(brigX), feetY);
    c.scale(-1, 1);
    flashing = brigFlash;
    /* legs and boots */
    R(-5, -11, 4, 9, '#604020'); R(-6, -2, 5, 2, '#3a2a1a');
    R(0, -11, 4, 9, '#604020');  R(0, -2, 6, 2, '#3a2a1a');
    /* torso, vest, belt */
    R(-7, -25 + bb, 13, 15, '#904020'); R(-5, -23 + bb, 3, 5, '#a85028');
    R(-7, -13 + bb, 13, 2, '#604020'); R(-1, -13 + bb, 3, 2, '#c0a000');
    /* head, bandana, scowl */
    R(-3, -33 + bb, 8, 8, '#d0a870');
    R(0, -26 + bb, 5, 2, '#4a2a18');
    R(-4, -31 + bb, 10, 3, '#c02020');
    R(-8 + flutter, -30 + bb, 4, 2, '#c02020'); R(-10 + flutter, -28 + bb, 3, 2, '#c02020');
    R(1, -30 + bb, 4, 1, '#3a1a10'); R(2, -29 + bb, 2, 1, '#202020');
    /* shoulder pad and off-hand fist */
    R(3, -25 + bb, 4, 3, '#606070'); R(4, -17 + bb, 3, 3, '#d0a870');
    /* axe arm — swings about the shoulder */
    c.save();
    c.translate(4 * P, (-21 + bb) * P);
    c.rotate(brigPose.theta + sway(brigPose.theta));
    R(0, -1, 6, 3, '#d0a870');
    R(3, -1, 19, 2, '#6a4a2a');
    R(17, -4, 2, 7, '#808090'); R(18, -6, 5, 11, '#808090');
    R(22, -6, 1, 11, '#c0c0d0'); R(19, -5, 2, 2, '#e0e0f0');
    c.restore();
    c.restore();
    flashing = false;

    /* impact effects: a burst of sparks at the weapon tip, and a floating number */
    const burst = (cx, cy, at, big) => {
      const age = ph - at;
      if (age < 0 || age > 18) return;
      c.save();
      c.globalAlpha = 1 - age / 18;
      const rays = big ? 12 : 8, dist = age * (big ? 3.4 : 2.6) + 4;
      const cols = ['#ffff80', '#ffffff', '#ffb040'];
      const s = age < 8 ? 6 : 4;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2 + (big ? 0.2 : 0);
        c.fillStyle = cols[i % 3];
        c.fillRect(Math.round(cx + Math.cos(a) * dist - s / 2), Math.round(cy + Math.sin(a) * dist - s / 2), s, s);
      }
      if (age < 6) {
        c.fillStyle = '#ffffff';
        const r = big ? 14 : 9;
        c.fillRect(cx - 2, cy - r, 4, r * 2); c.fillRect(cx - r, cy - 2, r * 2, 4);
      }
      c.restore();
    };
    const floatText = (x, at, text, col) => {
      const age = ph - at;
      if (age < 2 || age > 45) return;
      c.save();
      c.globalAlpha = Math.min(1, (45 - age) / 20);
      c.font = `10px ${FONT}`; c.textAlign = 'center';
      c.lineWidth = 3; c.lineJoin = 'round'; c.strokeStyle = 'rgba(0,0,0,0.85)';
      const y = Math.round(feetY - 100 - age * 0.28);
      c.strokeText(text, Math.round(x), y);
      c.fillStyle = col;
      c.fillText(text, Math.round(x), y);
      c.restore();
    };
    /* where each weapon tip is at the moment of impact (shoulder + arm + blade,
       at the blow's lunge and strike angle) */
    const lordTip = b => [mx - 58 + b.reach + 3 * P + 22 * P * Math.cos(b.strike), feetY - 19 * P + 22 * P * Math.sin(b.strike)];
    const brigTip = b => [mx + 58 - b.reach - 4 * P - 23 * P * Math.cos(b.strike), feetY - 21 * P + 23 * P * Math.sin(b.strike)];
    const [lx, ly] = lordTip(BLOW), [rx, ry] = brigTip(BLOW);
    burst(lx, ly, LORD_ATK + HIT, false);
    burst(rx, ry, BRIG_ATK + HIT, false);
    const [cl, cy1] = lordTip(CLASH), [cr, cy2] = brigTip(CLASH);
    burst((cl + cr) / 2, (cy1 + cy2) / 2, CLASH_ATK + HIT, true);
    floatText(brigX, LORD_ATK + HIT, '-8', '#ffe060');
    floatText(lordX, BRIG_ATK + HIT, '-6', '#ff6060');
    floatText(mx, CLASH_ATK + HIT, 'CLASH!', '#ffd700');

    c.restore();
  }

  /* ═══════════ MAP TILES ═══════════ */
  _map(map) {
    const c = this.cx;
    for (let r = 0; r < ROWS; r++)
      for (let cl = 0; cl < COLS; cl++)
        this._tile(cl, r, map.at(cl, r));
  }

  _tile(col, row, t) {
    const c = this.cx, x = col * TILE, y = row * TILE, T = TILE;
    c.fillStyle = t.color;
    c.fillRect(x, y, T, T);

    if (t === T_FOREST) {
      c.fillStyle = '#1a3d15'; c.fillRect(x+T/2-6, y+12, 12, 14);
      c.fillStyle = '#2a5d25'; c.fillRect(x+T/2-8, y+8, 16, 8); c.fillRect(x+T/2-6, y+2, 12, 8);
      c.fillStyle = '#5a3010'; c.fillRect(x+T/2-2, y+26, 4, 6);
    } else if (t === T_MOUNTAIN) {
      c.fillStyle = '#6a5a50';
      c.beginPath(); c.moveTo(x+T/2,y+4); c.lineTo(x+T-4,y+T-4); c.lineTo(x+4,y+T-4); c.closePath(); c.fill();
      c.fillStyle = '#ddd';
      c.beginPath(); c.moveTo(x+T/2,y+4); c.lineTo(x+T/2+7,y+14); c.lineTo(x+T/2-7,y+14); c.closePath(); c.fill();
    } else if (t === T_WATER) {
      c.fillStyle = '#2060b0'; c.fillRect(x,y,T,T);
      c.fillStyle = '#4090d0';
      const off = (this.t >> 4) % 4;
      for (let i = 0; i < 3; i++) c.fillRect(x + (i*14 + off*4) % T, y+8+i*10, 10, 2);
    } else if (t === T_WALL) {
      c.fillStyle = '#252530'; c.fillRect(x,y,T,T);
      c.strokeStyle = '#1a1a22'; c.lineWidth = 0.5;
      for (let br = 0; br < 3; br++) for (let bc = 0; bc < 3; bc++) {
        c.strokeRect(x + bc*14 - (br%2)*7, y + br*14, 12, 12);
      }
    } else if (t === T_FORT) {
      c.fillStyle = '#9a7a40'; c.fillRect(x+4,y+4,T-8,T-8);
      c.fillStyle = '#b89060'; c.fillRect(x+6,y+6,T-12,T-12);
      c.fillStyle = '#7a5a30';
      for (let i = 0; i < 3; i++) c.fillRect(x+6+i*10, y+2, 6, 6);
    } else if (t === T_ROAD) {
      c.fillStyle = '#b89860';
      c.fillRect(x+10, y, 4, T); c.fillRect(x+T-14, y, 4, T);
    } else if (t === T_HILL) {
      /* stacked mounds — grassy, so it reads as high ground and not a mountain */
      c.fillStyle = '#7a7638';
      c.beginPath(); c.moveTo(x+4, y+T-6); c.quadraticCurveTo(x+T/2, y+4, x+T-4, y+T-6); c.closePath(); c.fill();
      c.fillStyle = '#a49f58';
      c.beginPath(); c.moveTo(x+12, y+T-6); c.quadraticCurveTo(x+T/2, y+14, x+T-12, y+T-6); c.closePath(); c.fill();
      c.fillStyle = '#6a6630'; c.fillRect(x+8, y+T-8, 3, 2); c.fillRect(x+T-13, y+T-9, 3, 2);
    } else if (t === T_SWAMP) {
      /* murky puddles and reeds */
      c.fillStyle = '#2c4636';
      c.fillRect(x+6, y+12, 18, 8); c.fillRect(x+T-22, y+T-20, 16, 8);
      c.fillStyle = '#5f7a55';
      for (const rx of [10, 26, T-14]) { c.fillRect(x+rx, y+T-18, 2, 10); c.fillRect(x+rx-2, y+T-20, 6, 3); }
    } else if (t === T_FORD) {
      /* shallow water with stepping stones */
      const off = (this.t >> 5) % 4;
      c.fillStyle = '#5aa0c8';
      for (let i = 0; i < 2; i++) c.fillRect(x + (i*24 + off*4) % (T-10), y+12+i*22, 10, 2);
      c.fillStyle = '#8a9aa0';
      c.fillRect(x+12, y+T-22, 8, 6); c.fillRect(x+T-22, y+16, 8, 6); c.fillRect(x+T/2-4, y+T/2, 8, 6);
    } else if (t === T_BRIDGE) {
      /* planks over the water, with rails */
      c.fillStyle = '#2060b0'; c.fillRect(x, y, T, T);
      c.fillStyle = '#9a7a44'; c.fillRect(x+6, y, T-12, T);
      c.fillStyle = '#7a5a30';
      for (let py = 4; py < T; py += 10) c.fillRect(x+6, y+py, T-12, 2);
      c.fillStyle = '#5a3a1a'; c.fillRect(x+4, y, 3, T); c.fillRect(x+T-7, y, 3, T);
    } else {
      /* plain – grass detail */
      c.fillStyle = '#4a7a10';
      c.fillRect(x+6, y+T-8, 2, 4); c.fillRect(x+T-10, y+6, 2, 4);
    }

    /* grid */
    c.strokeStyle = 'rgba(0,0,0,0.15)'; c.lineWidth = 0.5;
    c.strokeRect(x, y, T, T);
  }

  /* ═══════════ HIGHLIGHTS ═══════════ */
  _highlights(g) {
    const c = this.cx;
    if (g.moveRange) for (const p of g.moveRange) { c.fillStyle = C.MOVE_HL; c.fillRect(p.x*TILE, p.y*TILE, TILE, TILE); }
    if (g.atkRange)  for (const p of g.atkRange)  { c.fillStyle = C.ATK_HL;  c.fillRect(p.x*TILE, p.y*TILE, TILE, TILE); }
  }

  /* ═══════════ DROPPED ITEMS ═══════════ */
  _droppedItems(g) {
    if (!g.droppedItems || !g.droppedItems.length) return;
    const c = this.cx;
    for (const d of g.droppedItems) {
      const x = d.x * TILE, y = d.y * TILE;
      /* pulsing glow */
      const pulse = 0.5 + Math.sin(this.t * 0.1 + d.x + d.y) * 0.3;
      c.fillStyle = `rgba(255,215,0,${pulse * 0.3})`;
      c.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
      /* chest/bag icon */
      c.fillStyle = `rgba(200,160,40,${pulse + 0.2})`;
      c.fillRect(x + 12, y + 14, 16, 12);
      c.fillStyle = `rgba(255,215,0,${pulse + 0.2})`;
      c.fillRect(x + 14, y + 12, 12, 4);
      /* latch */
      c.fillStyle = '#fff';
      c.fillRect(x + 18, y + 18, 4, 4);
    }
  }

  /* ═══════════ DROPPED ITEMS (list variant) ═══════════ */
  /* Renders a dropped-items array directly (used by history view) */
  _droppedItemsList(items) {
    if (!items || !items.length) return;
    const c = this.cx;
    for (const d of items) {
      const x = d.x * TILE, y = d.y * TILE;
      const pulse = 0.5 + Math.sin(this.t * 0.1 + d.x + d.y) * 0.3;
      c.fillStyle = `rgba(255,215,0,${pulse * 0.3})`;
      c.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
      c.fillStyle = `rgba(200,160,40,${pulse + 0.2})`;
      c.fillRect(x + 12, y + 14, 16, 12);
      c.fillStyle = `rgba(255,215,0,${pulse + 0.2})`;
      c.fillRect(x + 14, y + 12, 12, 4);
      c.fillStyle = '#fff';
      c.fillRect(x + 18, y + 18, 4, 4);
    }
  }

  /* ═══════════ UNITS (history snapshot) ═══════════ */
  /* Renders units from a snapshot state without touching live unit objects */
  _unitsFromSnap(snap) {
    const fakeG = { sel: null, state: 0, _combatDef: null };
    const allStates = [...snap.playerStates, ...snap.enemyStates];
    for (const s of allStates) {
      if (!s.alive) continue;
      /* build a plain render proxy with historical position/hp */
      const u = {
        x: s.x, y: s.y,
        hp: s.hp, maxHp: s.unit.maxHp,
        hue: s.unit.hue, lbl: s.unit.lbl,
        key: s.unit.key, isPlayer: s.unit.isPlayer,
        done: s.moved && s.acted,
      };
      this._unit(u, fakeG);
    }
  }

  /* ── History map overlay (dim tint + banner with nav buttons) ── */
  _historyOverlay(g) {
    const c = this.cx;
    const mapW = COLS * TILE, mapH = ROWS * TILE;
    /* dim the entire map area */
    c.fillStyle = 'rgba(0,0,30,0.38)';
    c.fillRect(0, 0, mapW, mapH);
    /* top banner — taller than a single line needs, so the log entry
       text below (the part that's hardest to read once the canvas is
       letterboxed down to phone width) can run at a legible size */
    const bannerH = 70;
    c.fillStyle = 'rgba(5,10,40,0.90)';
    c.fillRect(0, 0, mapW, bannerH);
    c.strokeStyle = 'rgba(80,120,255,0.75)';
    c.lineWidth = 1;
    c.strokeRect(0, 0, mapW, bannerH);
    const snap = g._historyView.snap;

    /* ── OLDER / NEWER navigation buttons ── */
    const btnW = 84, btnH = 28, btnY = (bannerH - btnH) / 2;
    const olderX = 8, newerX = mapW - btnW - 8;

    /* OLDER */
    c.fillStyle = '#0e1a30'; c.fillRect(olderX, btnY, btnW, btnH);
    c.strokeStyle = '#3050a0'; c.lineWidth = 1; c.strokeRect(olderX, btnY, btnW, btnH);
    c.fillStyle = '#6080d0'; c.font = `7px ${FONT}`; c.textAlign = 'center';
    c.fillText('<< OLDER', olderX + btnW / 2, btnY + 17);
    this._histNavOlder = { x: olderX, y: btnY, w: btnW, h: btnH };

    /* NEWER */
    c.fillStyle = '#0e1a30'; c.fillRect(newerX, btnY, btnW, btnH);
    c.strokeStyle = '#3050a0'; c.lineWidth = 1; c.strokeRect(newerX, btnY, btnW, btnH);
    c.fillStyle = '#6080d0'; c.font = `7px ${FONT}`; c.textAlign = 'center';
    c.fillText('NEWER >>', newerX + btnW / 2, btnY + 17);
    this._histNavNewer = { x: newerX, y: btnY, w: btnW, h: btnH };

    /* ── centre label ── */
    c.textAlign = 'center';
    c.fillStyle = '#8090ff';
    c.font = `12px ${FONT}`;
    c.fillText(`PLAY HISTORY \u00B7 Turn ${snap.turn}`, mapW / 2, 24);
    const entryText = g._historyView.entry ? g._historyView.entry.text : '';
    c.fillStyle = g._historyView.entry ? g._historyView.entry.color || '#a0a0c0' : '#505880';
    /* the space between the nav buttons — shrink as needed so a long
       entry never runs under them */
    const entrySafeW = newerX - (olderX + btnW) - 20;
    let entryFont = 15;
    c.font = `${entryFont}px ${FONT}`;
    while (entryFont > 9 && c.measureText(entryText).width > entrySafeW) {
      entryFont--;
      c.font = `${entryFont}px ${FONT}`;
    }
    const entryRuns = g._historyView.entry ? g._historyView.entry.runs : null;
    this._fillRuns(entryRuns || [{ t: entryText }], mapW / 2, 54, 'center', c.fillStyle);
  }

  /* ═══════════ UNITS ═══════════ */
  _units(g) {
    for (const u of [...g.players, ...g.enemies]) if (u.alive) this._unit(u, g);
  }

  _unit(u, g) {
    const c = this.cx, x0 = u.x*TILE, y0 = u.y*TILE, T = TILE;
    const dim = u.isPlayer && u.done;
    /* The sprite below (body/head/helmet/eyes/border) is drawn at fixed
       pixel offsets designed for the original 40px tile — centered
       horizontally on it, and deliberately sitting slightly above center
       vertically to leave the HP bar/label room underneath. Recenter that
       same fixed-size sprite within whatever TILE actually is now (bigger
       tiles = more margin around it) instead of redrawing it at a new
       size, so it stays anchored to the tile's true center either way. */
    const off = (T - 40) / 2;
    const x = x0 + off, y = y0 + off;

    /* body */
    c.fillStyle = dim ? this._dim(u.hue) : u.hue;
    c.fillRect(x+8, y+14, 24, 16);

    /* head */
    c.fillStyle = dim ? '#9a8a6a' : '#f0c890';
    c.fillRect(x+12, y+4, 16, 14);

    /* eyes */
    c.fillStyle = '#202020';
    c.fillRect(x+14, y+10, 3, 3); c.fillRect(x+23, y+10, 3, 3);

    /* helmet */
    c.fillStyle = this._helm(u.key);
    c.fillRect(x+10, y+2, 20, 6);

    /* team border */
    c.strokeStyle = u.isPlayer ? '#80a0ff' : '#ff8080';
    c.lineWidth = 2;
    c.strokeRect(x+6, y+2, 28, 30);

    /* selection ring */
    if (g.sel === u) {
      const p = Math.sin(this.t * 0.15) * 2;
      c.strokeStyle = '#ffff00'; c.lineWidth = 2;
      c.strokeRect(x+4-p, y+0-p, 32+p*2, 34+p*2);
    }

    /* combat target flash — pulsing red overlay on the defender */
    if (g.state === S_COMBAT_ANIM && g._combatDef === u) {
      const pulse = 0.3 + Math.sin(this.t * 0.3) * 0.25;
      c.fillStyle = `rgba(255,60,60,${pulse})`;
      c.fillRect(x+6, y+2, 28, 30);
      /* red crosshair on target — centered on the whole tile, not the
         (recentred, possibly offset) sprite sub-box above */
      c.strokeStyle = `rgba(255,100,100,${0.6 + Math.sin(this.t * 0.2) * 0.4})`;
      c.lineWidth = 2;
      const cx2 = x0 + T/2, cy2 = y0 + T/2, s = 14 + Math.sin(this.t * 0.15) * 2;
      c.beginPath();
      c.moveTo(cx2 - s, cy2); c.lineTo(cx2 - s + 6, cy2);
      c.moveTo(cx2 + s, cy2); c.lineTo(cx2 + s - 6, cy2);
      c.moveTo(cx2, cy2 - s); c.lineTo(cx2, cy2 - s + 6);
      c.moveTo(cx2, cy2 + s); c.lineTo(cx2, cy2 + s - 6);
      c.stroke();
    }

    /* attack target indicator — pulsing crosshair on targetable enemies */
    if (g.state === S_ATK_SELECT && !u.isPlayer && g.sel && inRange(g.sel, u.x, u.y)) {
      const pulse = 0.6 + Math.sin(this.t * 0.2) * 0.4;
      c.strokeStyle = `rgba(255,255,0,${pulse})`;
      c.lineWidth = 3;
      /* crosshair corners — centered on the whole tile */
      const cx = x0 + T/2, cy = y0 + T/2, s = 16 + Math.sin(this.t * 0.15) * 2;
      c.beginPath();
      c.moveTo(cx - s, cy - s); c.lineTo(cx - s + 8, cy - s);
      c.moveTo(cx - s, cy - s); c.lineTo(cx - s, cy - s + 8);
      c.moveTo(cx + s, cy - s); c.lineTo(cx + s - 8, cy - s);
      c.moveTo(cx + s, cy - s); c.lineTo(cx + s, cy - s + 8);
      c.moveTo(cx - s, cy + s); c.lineTo(cx - s + 8, cy + s);
      c.moveTo(cx - s, cy + s); c.lineTo(cx - s, cy + s - 8);
      c.moveTo(cx + s, cy + s); c.lineTo(cx + s - 8, cy + s);
      c.moveTo(cx + s, cy + s); c.lineTo(cx + s, cy + s - 8);
      c.stroke();
    }

    /* HP bar — spans the full tile width, not the sprite sub-box */
    const pct = u.hp / u.maxHp, bw = T - 6, by = y0 + T - 8;
    c.fillStyle = C.HP_BG; c.fillRect(x0+3, by, bw, 5);
    c.fillStyle = pct > 0.5 ? C.HP_OK : pct > 0.25 ? C.HP_MID : C.HP_LOW;
    c.fillRect(x0+3, by, Math.floor(bw * pct), 5);

    /* label — sized as a fraction of the tile so it scales with TILE, at
       full tile size (0.5) it read as too big/loud for every unit at
       once, so it's smaller by default. Anchored on its bottom edge just
       above the HP bar (not centered on the shirt) so it sits lower,
       clear of the face, in the open space above the bar — using a
       'bottom' baseline means that clearance holds regardless of font
       size, so the selected unit's bigger label doesn't need a separate
       anchor. The selected unit's label grows back to that original
       bigger/bolder size so the one unit you're actually looking at is
       easy to pick out. Heavily outlined so the letter still reads over
       any body/team color. textBaseline is reset after — nothing else in
       this file sets it, so everything drawn later (sidebar, etc.)
       assumes the 'alphabetic' default. */
    const selected = g.sel === u;
    const lblSize = Math.round(T * (selected ? 0.5 : 0.3));
    const lx = x0 + T / 2, ly = y0 + T - 10; // centered, bottom-anchored just above the HP bar
    c.font = `bold ${lblSize}px monospace`; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.lineWidth = Math.max(2, Math.round(T * (selected ? 0.08 : 0.05)));
    c.strokeStyle = 'rgba(0,0,0,0.9)';
    c.strokeText(u.lbl, lx, ly);
    c.fillStyle = '#fff';
    c.fillText(u.lbl, lx, ly);
    c.textBaseline = 'alphabetic';
  }

  _helm(k) {
    return { LORD:'#c0a000', FIGHTER:'#808080', MAGE:'#a000c0', ARCHER:'#206040',
             HEALER:'#e0e040', CAVALIER:'#208040', KNIGHT:'#4060a0', THIEF:'#606020',
             SOLDIER:'#804040', BRIGAND:'#604020', DARK_MAGE:'#300060', E_ARCHER:'#604040',
             WARLORD:'#ff0000' }[k] || '#888';
  }

  _dim(hex) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `rgb(${(r*0.4)|0},${(g*0.4)|0},${(b*0.4)|0})`;
  }

  /* ═══════════ CURSOR ═══════════ */
  _cursor(g) {
    if (!g.cur) return;
    const c = this.cx, p = Math.sin(this.t * 0.15) * 2;
    c.strokeStyle = C.CURSOR; c.lineWidth = 2;
    c.strokeRect(g.cur.x*TILE+1-p/2, g.cur.y*TILE+1-p/2, TILE-2+p, TILE-2+p);
  }

  /* ═══════════ SIDEBAR ═══════════ */
  _sidebar(g) {
    const c = this.cx, { x: sx, y: sy, w: sw, h: sh, scale } = this._sideRect;
    c.fillStyle = C.SIDE_BG; c.fillRect(sx, sy, sw, sh);
    c.strokeStyle = C.SIDE_BD; c.lineWidth = 2; c.strokeRect(sx, sy, sw, sh);

    /* Every element below is drawn in a local, unscaled coordinate space —
       exactly the original 224-wide/600-tall column — then the whole thing
       is stretched by `scale` to fill the actual panel rect. In portrait
       that rect is the full map width and a taller strip, so `scale` grows
       (see _applyLayout) and fonts/spacing/buttons all grow together with
       it, filling the space without any per-element rework or distortion. */
    const lw = sw / scale; // local width — always resolves back to `sw` once scaled
    const localBudget = sh / scale; // local height budget (bigger in portrait — see _applyLayout)

    c.save();
    c.translate(sx, sy);
    c.scale(scale, scale);

    let y = 14;
    const px = 10;
    c.textAlign = 'left';

    /* floor / phase / turn */
    c.fillStyle = C.GOLD; c.font = `10px ${FONT}`;
    const floorLabel = g.floor === 0 ? 'TUTORIAL'
                     : g.floor >= FINAL_FLOOR ? 'FINAL BATTLE'
                     : `LEVEL ${g.floor}`;
    c.fillText(floorLabel, px, y); y += 20;
    /* floor theme + difficulty subtitle */
    if (g.map && g.map._floorTheme) {
      c.fillStyle = '#707090'; c.font = `6px ${FONT}`;
      const names = { forest:'The Wilds', fortress:'Enemy Stronghold', gauntlet:'Perilous Pass', open_field:'Open Field', mixed:'War Zone', boss:"Warlord's Throne" };
      c.fillText(names[g.map._floorTheme] || '', px, y); y += 12;
    }
    if (g.difficulty) {
      const dc = { easy:'#40a030', medium:'#c0a020', hard:'#c03030' };
      c.fillStyle = dc[g.difficulty] || '#707090'; c.font = `6px ${FONT}`;
      c.fillText(g.difficulty.toUpperCase(), px, y); y += 12;
    }
    c.fillStyle = g.phase === 'player' ? '#6080ff' : '#ff6060';
    c.font = `9px ${FONT}`;
    c.fillText(g.phase === 'player' ? 'PLAYER PHASE' : 'ENEMY PHASE', px, y); y += 16;
    c.fillStyle = C.TXT; c.font = `7px ${FONT}`;
    c.fillText(`Turn ${g.turn}`, px, y); y += 18;

    /* sound toggle — top-right corner, out of the vertical flow below */
    this._soundToggle(0, 12, lw);

    /* divider */
    c.fillStyle = C.SIDE_BD; c.fillRect(px-5, y, lw-10, 1); y += 10;

    /* primary controls, right under the header — whatever needs tapping
       next (end the turn, confirm/cancel a rewind, regenerate the map)
       sits in the same immediately-visible spot every time, instead of
       requiring a look at the bottom of a possibly very tall pane. Stays
       at the ambient `scale` only — not part of the info-boost below. */
    this._sidebarTopY = y;
    if (g._historyView) {
      this._historyControls(g, 0, y, lw); y += 46 + 10;
    } else {
      const showEndBtn = g.phase === 'player' && g.state !== S_ACTION_MENU && g.state !== S_ATK_SELECT;
      if (showEndBtn) { this._endBtn(0, y, lw); y += 36 + 8; } else { this._btn = null; }
      if (g._canRegen) { this._regenLevelBtn(0, y, lw); y += 36 + 8; } else { this._regenBtn = null; }
      if (showEndBtn || g._canRegen) y += 2;
    }

    /* unit info */
    const u = g.sel || this._unitAt(g, g.cur);
    if (u) y = this._unitPanel(u, px, y, lw - 20);

    /* terrain — suppressed while a combat/heal/steal forecast is active so the
       forecast always fits between the unit panel and the log without clipping */
    if (g.cur && !g.preview) y = this._terrainPanel(g, px, y, lw - 20);

    /* combat / heal / steal preview */
    if (g.preview) {
      if (g.preview.heal)       { this._healPreview(g.preview, 0, y, lw);  y += 78; }
      else if (g.preview.steal) { this._stealPreview(g.preview, 0, y, lw); y += 78; }
      else                      { this._combatPreview(g.preview, 0, y, lw); y += 132; }
      y += 8;
    }

    /* play log — fills whatever room is left down to the bottom of the
       pane, so the space freed up above goes toward more visible history
       rather than sitting blank */
    this._playLog(g, 0, y, lw, localBudget - 10 - y);

    c.restore();

    /* everything above recorded its click/wheel hit-areas in the local,
       unscaled space — convert them back to absolute canvas pixels now
       that the transform is gone (game.js hit-tests in absolute space) */
    this._toAbsBounds(sx, sy, scale);
  }


  /* Converts sidebar hit-area bounds recorded in local (unscaled) space —
     while drawing inside the translate+scale block above — into absolute
     canvas-pixel rects. */
  _toAbsBounds(sx, sy, scale) {
    const abs = r => r && { x: sx + r.x * scale, y: sy + r.y * scale, w: r.w * scale, h: r.h * scale };
    this._btn             = abs(this._btn);
    this._sndBtn           = abs(this._sndBtn);
    this._regenBtn         = abs(this._regenBtn);
    this._rewindBtnBounds  = abs(this._rewindBtnBounds);
    this._logScrollUp      = abs(this._logScrollUp);
    this._logScrollDown    = abs(this._logScrollDown);
    this._logPanelBounds   = abs(this._logPanelBounds);
    this._histContinueBtn  = abs(this._histContinueBtn);
    this._histCancelBtn    = abs(this._histCancelBtn);
    if (this._logEntryBounds) {
      this._logEntryBounds = this._logEntryBounds.map(e => ({
        x: sx + e.x * scale, y: sy + e.y * scale, w: e.w * scale, h: e.h * scale, entry: e.entry,
      }));
    }
  }

  _unitAt(g, cur) {
    if (!cur) return null;
    return [...g.players, ...g.enemies].find(u => u.alive && u.x === cur.x && u.y === cur.y) || null;
  }

  _unitPanel(u, x, y, w) {
    const c = this.cx;
    const invCount = u.inventory ? u.inventory.length : 0;
    /* stats grid — as many columns as the width comfortably fits (down to
       1 for very narrow layouts), column width and the label-value gap
       both derived from the actual width so it can never overflow
       regardless of how narrow or wide `w` ends up */
    const cols = w >= 340 ? 4 : w >= 170 ? 2 : 1;
    const colW = Math.floor(w / cols);
    const valOffset = Math.floor(colW * 0.55);
    const stats = [['STR',u.str],['MAG',u.mag],['SKL',u.skl],['SPD',u.spd],['LCK',u.lck],['DEF',u.def],['RES',u.res],['MOV',u.mov]];
    const gridRows = Math.ceil(stats.length / cols);
    const rowH = 18;
    const gridH = gridRows * rowH + 8;
    const xpRowH = u.isPlayer ? 26 : 0;
    const panelH = 60 + gridH + 60 + xpRowH + (invCount > 0 ? 18 + invCount * 16 : 0);

    c.fillStyle = u.isPlayer ? '#1a1a50' : '#501a1a';
    c.fillRect(x-4, y, w+8, panelH);
    c.strokeStyle = u.isPlayer ? '#3030a0' : '#a03030';
    c.lineWidth = 1; c.strokeRect(x-4, y, w+8, panelH);

    y += 14;
    c.fillStyle = C.GOLD; c.font = `${PANE_FONT}px ${FONT}`; c.textAlign = 'left';
    c.fillText(u.name, x, y); y += 16;
    c.fillStyle = '#8080b0'; c.font = `${PANE_FONT}px ${FONT}`;
    c.fillText(`${u.className}  Lv.${u.level}  ${u.weapon.name}`, x, y); y += 16;

    /* HP bar */
    const pct = u.hp / u.maxHp;
    const barH = 10;
    c.fillStyle = C.HP_BG; c.fillRect(x, y, w, barH);
    c.fillStyle = pct > 0.5 ? C.HP_OK : pct > 0.25 ? C.HP_MID : C.HP_LOW;
    c.fillRect(x, y, Math.floor(w * pct), barH);
    c.fillStyle = '#fff'; c.font = `${PANE_FONT}px monospace`;
    c.fillText(`${u.hp}/${u.maxHp}`, x+2, y+barH-1); y += 20;

    /* XP bar — player units only */
    if (u.isPlayer) {
      const xpPct = Math.min(1, u.xp / XP_PER_LEVEL);
      c.fillStyle = '#101030'; c.fillRect(x, y - 6, w, 6);
      c.fillStyle = '#40b0e0'; c.fillRect(x, y - 6, Math.floor(w * xpPct), 6);
      c.fillStyle = '#6080b0'; c.font = `${PANE_FONT - 2}px ${FONT}`; c.textAlign = 'right';
      c.fillText(`XP ${u.xp}/${XP_PER_LEVEL}`, x + w, y + 8);
      c.textAlign = 'left';
      y += xpRowH;
    }

    /* stats grid */
    c.font = `${PANE_FONT}px ${FONT}`;
    for (let i = 0; i < stats.length; i++) {
      const col = i % cols, row = (i / cols) | 0;
      const sx = x + col * colW, sy = y + row * rowH;
      c.fillStyle = '#6060a0'; c.fillText(stats[i][0], sx, sy);
      c.fillStyle = C.TXT;     c.fillText(String(stats[i][1]).padStart(2), sx + valOffset, sy);
    }
    y += gridH;

    /* inventory */
    if (invCount > 0) {
      c.fillStyle = '#6060a0'; c.font = `${PANE_FONT}px ${FONT}`;
      c.fillText('ITEMS', x, y); y += 14;
      for (const item of u.inventory) {
        c.fillStyle = item.type === 'weapon' ? '#80b0ff' : '#80ff80';
        c.fillText('• ' + item.name, x + 4, y);
        y += 16;
      }
    }

    return y + 4;
  }

  _terrainPanel(g, x, y, w) {
    const c = this.cx, t = g.map.at(g.cur.x, g.cur.y);
    y += 6;
    const panelH = 62;
    c.fillStyle = '#101020'; c.fillRect(x-4, y, w+8, panelH);
    c.strokeStyle = '#303050'; c.lineWidth = 1; c.strokeRect(x-4, y, w+8, panelH);
    y += 14;
    c.fillStyle = C.GOLD; c.font = `${PANE_FONT}px ${FONT}`; c.textAlign = 'left';
    c.fillText(t.name, x, y); y += 16;
    c.fillStyle = C.TXT; c.font = `${PANE_FONT}px ${FONT}`;
    const signed = n => (n < 0 ? `${n}` : `+${n}`);
    c.fillText(`DEF ${signed(t.def)}  AVO ${signed(t.avo)}`, x, y); y += 14;
    c.fillText(`Move: ${t.cost >= 99 ? '--' : t.cost}`, x, y); y += 24;
    return y;
  }

  _combatPreview(pv, sx, y, sw) {
    const c = this.cx, x = sx + 10, w = sw - 20;
    const panelH = 130;
    c.fillStyle = '#0d0d20'; c.fillRect(x-4, y, w+8, panelH);
    c.strokeStyle = '#8020c0'; c.lineWidth = 2; c.strokeRect(x-4, y, w+8, panelH);

    c.fillStyle = '#c080ff'; c.font = `${PANE_FONT}px ${FONT}`; c.textAlign = 'center';
    c.fillText('COMBAT FORECAST', sx + sw/2, y + 16);

    c.textAlign = 'left'; c.font = `${PANE_FONT}px ${FONT}`;
    /* attacker */
    c.fillStyle = '#8080ff'; c.fillText(pv.atk.name, x, y + 32);
    c.fillStyle = C.TXT;
    c.fillText(`DMG ${pv.af.dmg}  HIT ${pv.af.hit}%`, x, y + 48);
    c.fillText(`CRT ${pv.af.crit}%${pv.af.doubles ? '  x2' : ''}`, x, y + 62);

    c.fillStyle = '#404060'; c.fillRect(x, y + 68, w, 1);
    /* defender */
    c.fillStyle = '#ff8080'; c.fillText(pv.def.name, x, y + 84);
    if (pv.df) {
      c.fillStyle = C.TXT;
      c.fillText(`DMG ${pv.df.dmg}  HIT ${pv.df.hit}%`, x, y + 100);
      c.fillText(`CRT ${pv.df.crit}%${pv.df.doubles ? '  x2' : ''}`, x, y + 114);
    } else {
      c.fillStyle = '#666'; c.fillText('Cannot counter', x, y + 100);
    }
  }

  _menu(g) {
    const c = this.cx;
    /* the action menu already inherits the ambient sidebar scale below
       (2-2.6x in portrait) same as the other buttons — that was confirmed
       a good size, so it isn't boosted any further here */
    const itemH = 40, pad = 12;
    const headerFont = 8, itemFont = 10;
    const { x: sx, y: sy, w: sw, scale } = this._sideRect;
    const lw = sw / scale;
    const mw = lw - 20, mh = g.menuOpts.length * itemH + pad * 2;
    const mx = 10;
    /* same "right under the header" spot the END TURN button sits in when
       it's showing instead (tracked by _sidebar, local coords) — the
       action menu is only ever open while that button is hidden */
    const my = this._sidebarTopY || 34;

    /* drawn in the same local, unscaled space as _sidebar() — see there */
    c.save();
    c.translate(sx, sy);
    c.scale(scale, scale);

    /* background */
    c.fillStyle = '#0a0a20'; c.fillRect(mx - 2, my, mw + 4, mh);
    c.strokeStyle = '#6060d0'; c.lineWidth = 2; c.strokeRect(mx - 2, my, mw + 4, mh);

    /* header */
    c.fillStyle = '#8080cc'; c.font = `${headerFont}px ${FONT}`; c.textAlign = 'center';
    c.fillText('ACTION', lw / 2, my + 12);

    g.menuOpts.forEach((opt, i) => {
      const oy = my + pad + 8 + i * itemH;
      /* highlight */
      c.fillStyle = opt.on ? '#202060' : '#101020';
      c.fillRect(mx + 2, oy - 6, mw - 4, itemH - 6);
      if (opt.on) {
        c.strokeStyle = '#4040a0'; c.lineWidth = 1;
        c.strokeRect(mx + 2, oy - 6, mw - 4, itemH - 6);
      }
      c.fillStyle = opt.on ? '#ffffff' : '#404050';
      c.font = `${itemFont}px ${FONT}`; c.textAlign = 'center';
      c.fillText(opt.label, lw / 2, oy + 14);
    });

    c.restore();

    /* store bounds for click detection — converted to absolute canvas pixels */
    g._menuBounds = { x: sx + (mx-2)*scale, y: sy + my*scale, w: (mw+4)*scale, h: mh*scale };
    /* local (unscaled) row geometry — game.js needs this to figure out
       which option a click landed on, since it only sees absolute pixels */
    this._menuGeom = { rowOffset: pad + 8, itemH };
  }

  /* ═══════════ PLAY LOG ═══════════ */

  _playLog(g, sx, y, sw, maxH) {
    const c = this.cx, x = sx + 10, w = sw - 20;
    const LINE_H = 17;
    const headH = 18, padH = 12;
    /* fill however much room is actually left above the bottom of the pane
       instead of a fixed 7 lines — the space freed up by moving the
       buttons to the top (see _sidebar) goes toward showing more history */
    const LOG_LINES = maxH ? Math.max(5, Math.min(24, Math.floor((maxH - headH - padH) / LINE_H))) : 7;
    const panelH = headH + LOG_LINES * LINE_H + padH;
    const selectedEntry = g._historyView ? g._historyView.entry : null;
    const hasRewind = g.rewindsLeft > 0 && g.snapshots && g.snapshots.length > 0;
    const allEntries = g.playLog || [];
    const totalEntries = allEntries.length;
    const scroll = Math.max(0, Math.min(g._logScroll || 0, Math.max(0, totalEntries - LOG_LINES)));
    const endIdx   = totalEntries - scroll;
    const startIdx = Math.max(0, endIdx - LOG_LINES);
    const canScrollUp   = endIdx < totalEntries;    // older entries above
    const canScrollDown = scroll > 0;               // newer entries below

    /* panel background */
    c.fillStyle = '#080810'; c.fillRect(x - 4, y, w + 8, panelH);
    c.strokeStyle = g._historyView ? '#4050c0' : '#202040';
    c.lineWidth = 1; c.strokeRect(x - 4, y, w + 8, panelH);
    /* record panel bounds for wheel-scroll hit testing */
    this._logPanelBounds = { x: x - 4, y, w: w + 8, h: panelH };

    /* header row */
    c.fillStyle = '#4040a0'; c.font = `${PANE_FONT}px ${FONT}`; c.textAlign = 'left';
    c.fillText('PLAY LOG', x, y + 13);

    /* rewind charge counter — far right of header */
    const rbw = 48, rbh = 15, rbx = sx + sw - rbw - 6, rby = y + 1;
    c.fillStyle = hasRewind ? '#0e1e2e' : '#0a0a0a';
    c.fillRect(rbx, rby, rbw, rbh);
    c.strokeStyle = hasRewind ? '#30b0e0' : '#252530';
    c.lineWidth = 1; c.strokeRect(rbx, rby, rbw, rbh);
    c.fillStyle = hasRewind ? '#40d0f0' : '#303040';
    c.font = `7px ${FONT}`; c.textAlign = 'center';
    c.fillText(`↺ ${g.rewindsLeft}`, rbx + rbw / 2, rby + 10);
    c.textAlign = 'left';
    this._rewindBtnBounds = { x: rbx, y: rby, w: rbw, h: rbh };

    /* scroll arrow buttons — just left of the rewind counter */
    const arH = 15, arW = 15, arGap = 2;
    const arDnX = rbx - arW - 4;
    const arUpX = arDnX - arW - arGap;
    const arY   = rby;

    /* up button */
    c.fillStyle = canScrollUp ? '#0e2030' : '#0a0a0a';
    c.fillRect(arUpX, arY, arW, arH);
    c.strokeStyle = canScrollUp ? '#2080a0' : '#202030';
    c.lineWidth = 1; c.strokeRect(arUpX, arY, arW, arH);
    c.fillStyle = canScrollUp ? '#60c0e0' : '#303040';
    c.font = `9px ${FONT}`; c.textAlign = 'center';
    c.fillText('▲', arUpX + arW / 2, arY + 11);
    this._logScrollUp = { x: arUpX, y: arY, w: arW, h: arH };

    /* down button */
    c.fillStyle = canScrollDown ? '#0e2030' : '#0a0a0a';
    c.fillRect(arDnX, arY, arW, arH);
    c.strokeStyle = canScrollDown ? '#2080a0' : '#202030';
    c.lineWidth = 1; c.strokeRect(arDnX, arY, arW, arH);
    c.fillStyle = canScrollDown ? '#60c0e0' : '#303040';
    c.font = `9px ${FONT}`; c.textAlign = 'center';
    c.fillText('▼', arDnX + arW / 2, arY + 11);
    this._logScrollDown = { x: arDnX, y: arY, w: arW, h: arH };

    /* entries */
    this._logEntryBounds = [];
    const entries = allEntries.slice(startIdx, endIdx);
    /* clip rendering to log panel content area */
    c.save();
    c.beginPath(); c.rect(x - 4, y + headH, w + 8, panelH - headH); c.clip();

    /* "older above" gradient hint */
    if (canScrollUp) {
      const grd = c.createLinearGradient(0, y + headH, 0, y + headH + 12);
      grd.addColorStop(0, 'rgba(40,50,100,0.5)');
      grd.addColorStop(1, 'rgba(40,50,100,0)');
      c.fillStyle = grd;
      c.fillRect(x - 4, y + headH, w + 8, 12);
    }

    const entryFont = PANE_FONT + 1; // a touch above the rest of the pane, but Press Start 2P is ~1em/char — bigger than this eats into how much log text fits per line fast
    let ey = y + headH + 13;
    for (const entry of entries) {
      const ebx = x - 4, ebw = w + 8, ebh = LINE_H;
      const isSelected = entry === selectedEntry;
      const hasSnap    = !!entry.snap;

      /* highlight selected entry; every entry is navigable so all get a subtle row tint */
      if (isSelected) {
        c.fillStyle = 'rgba(60,80,200,0.38)';
        c.fillRect(ebx, ey - 12, ebw, ebh);
        c.strokeStyle = 'rgba(100,140,255,0.65)';
        c.lineWidth = 1; c.strokeRect(ebx, ey - 12, ebw, ebh);
      } else {
        c.fillStyle = 'rgba(30,30,80,0.14)';
        c.fillRect(ebx, ey - 12, ebw, ebh);
      }

      /* entry text — same pixel font as the rest of the game, not the
         proportional sans-serif this used to borrow for density */
      let runs = entry.runs || [{ t: entry.text }];
      const maxChars = Math.floor((w - 16) / entryFont); // Press Start 2P is ~1em per char — measured, not a sans-serif estimate
      if (entry.text.length > maxChars) runs = [...this._sliceRuns(runs, 0, maxChars - 1), { t: '…' }];
      c.font = `${entryFont}px ${FONT}`;
      this._fillRuns(runs, x + 1, ey, 'left', isSelected ? '#c0d0ff' : entry.color);

      /* selected entry gets a small marker to remind the player this is the restore point */
      if (isSelected) {
        c.fillStyle = '#6080c0';
        c.font = `7px ${FONT}`;
        c.textAlign = 'right';
        c.fillText('↺', sx + sw - 10, ey);
      }

      this._logEntryBounds.push({ x: ebx, y: ey - 12, w: ebw, h: ebh, entry });
      ey += LINE_H;
    }

    /* "newer below" gradient hint */
    if (canScrollDown) {
      const grd = c.createLinearGradient(0, y + panelH - 14, 0, y + panelH - 2);
      grd.addColorStop(0, 'rgba(40,50,100,0)');
      grd.addColorStop(1, 'rgba(40,50,100,0.5)');
      c.fillStyle = grd;
      c.fillRect(x - 4, y + panelH - 14, w + 8, 12);
    }

    c.restore();
    c.textAlign = 'left';
  }


  _endBtn(sx, y, sw) {
    const c = this.cx, bx = sx + 10, bw = sw - 20, bh = 36;
    c.fillStyle = '#103040'; c.fillRect(bx, y, bw, bh);
    c.strokeStyle = '#20a0c0'; c.lineWidth = 2; c.strokeRect(bx, y, bw, bh);
    c.fillStyle = '#40d0f0'; c.font = `9px ${FONT}`; c.textAlign = 'center';
    c.fillText('END TURN', sx + sw / 2, y + 22);
    this._btn = { x: bx, y, w: bw, h: bh };
  }

  _regenLevelBtn(sx, y, sw) {
    const c = this.cx, bx = sx + 10, bw = sw - 20, bh = 36;
    c.fillStyle = '#103040'; c.fillRect(bx, y, bw, bh);
    c.strokeStyle = '#20a0c0'; c.lineWidth = 2; c.strokeRect(bx, y, bw, bh);
    c.fillStyle = '#40d0f0'; c.font = `9px ${FONT}`; c.textAlign = 'center';
    c.fillText('REGENERATE MAP', sx + sw / 2, y + 22);
    this._regenBtn = { x: bx, y, w: bw, h: bh };
  }

  /* ── History view controls (replaces END TURN while browsing history) ── */
  _historyControls(g, sx, y, sw) {
    const c = this.cx, bx = sx + 10, bw = sw - 20;
    const hasCharge = g.rewindsLeft > 0;

    /* CONTINUE FROM HERE button (top, 20px tall) */
    c.fillStyle = hasCharge ? '#0d2a38' : '#101010';
    c.fillRect(bx, y, bw, 20);
    c.strokeStyle = hasCharge ? '#20a0c0' : '#252530';
    c.lineWidth = 2; c.strokeRect(bx, y, bw, 20);
    c.fillStyle = hasCharge ? '#40d0f0' : '#404050';
    c.font = `7px ${FONT}`; c.textAlign = 'center';
    c.fillText(`REWIND  (\u21BA ${g.rewindsLeft} left)`, sx + sw / 2, y + 13);
    this._histContinueBtn = { x: bx, y, w: bw, h: 20 };

    /* CANCEL button (below, 20px tall, with 6px gap) */
    const cy2 = y + 26;
    c.fillStyle = '#141420';
    c.fillRect(bx, cy2, bw, 20);
    c.strokeStyle = '#404060';
    c.lineWidth = 1; c.strokeRect(bx, cy2, bw, 20);
    c.fillStyle = '#8080a0';
    c.font = `7px ${FONT}`; c.textAlign = 'center';
    c.fillText('CANCEL', sx + sw / 2, cy2 + 13);
    this._histCancelBtn = { x: bx, y: cy2, w: bw, h: 20 };
  }

  _soundToggle(sx, y, sw) {
    const c = this.cx;
    const sz = 28, bx = sx + sw - sz - 10, by = y;
    const m = isMuted();

    c.fillStyle = '#101020'; c.fillRect(bx, by, sz, sz);
    c.strokeStyle = '#404060'; c.lineWidth = 1; c.strokeRect(bx, by, sz, sz);

    /* speaker icon */
    c.fillStyle = m ? '#505050' : '#80c0ff';
    const ix = bx + 6, iy = by + 9;
    c.fillRect(ix, iy, 4, 10);
    c.beginPath();
    c.moveTo(ix + 4, iy); c.lineTo(ix + 10, iy - 4); c.lineTo(ix + 10, iy + 14); c.lineTo(ix + 4, iy + 10);
    c.closePath(); c.fill();

    if (m) {
      /* X for muted */
      c.strokeStyle = '#ff4040'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(bx + 18, by + 8); c.lineTo(bx + 24, by + 20); c.stroke();
      c.beginPath(); c.moveTo(bx + 24, by + 8); c.lineTo(bx + 18, by + 20); c.stroke();
    } else {
      /* sound waves */
      c.strokeStyle = '#80c0ff'; c.lineWidth = 1.5;
      for (let i = 1; i <= 2; i++) {
        c.beginPath();
        c.arc(ix + 10, iy + 5, 3 + i * 3, -0.6, 0.6);
        c.stroke();
      }
    }

    this._sndBtn = { x: bx, y: by, w: sz, h: sz };
  }

  /* ═══════════ TUTORIAL BANNER ═══════════ */
  _tutBanner(g) {
    if (!g.tut || g.tut.timer <= 0) return;
    const c = this.cx;
    const a = Math.min(1, g.tut.timer / 30); // fade out over last 0.5s
    const mapW = COLS * TILE;

    /* dark banner at top of map */
    c.fillStyle = `rgba(0,0,40,${0.88 * a})`;
    c.fillRect(0, 0, mapW, 48);
    c.strokeStyle = `rgba(100,100,255,${0.7 * a})`;
    c.lineWidth = 2;
    c.strokeRect(0, 0, mapW, 48);

    /* gold arrow indicator */
    c.fillStyle = `rgba(255,215,0,${a})`;
    c.font = `10px ${FONT}`;
    c.textAlign = 'center';
    c.fillText('\u25B6 ' + g.tut.msg, mapW / 2, 30);
  }

  /* ═══════════ ATTACK SELECT PROMPT ═══════════ */
  _atkPrompt() {
    const c = this.cx;
    const mapW = COLS * TILE;
    const mapH = ROWS * TILE;
    const pulse = 0.7 + Math.sin(this.t * 0.1) * 0.3;
    c.fillStyle = `rgba(60,0,0,${0.85 * pulse})`;
    c.fillRect(0, mapH - 32, mapW, 32);
    c.strokeStyle = `rgba(255,80,80,${0.8 * pulse})`;
    c.lineWidth = 1;
    c.strokeRect(0, mapH - 32, mapW, 32);
    c.fillStyle = `rgba(255,200,200,${pulse})`;
    c.font = `8px ${FONT}`;
    c.textAlign = 'center';
    c.fillText('\u2694 Click a target to attack  \u2022  Click empty tile to cancel', mapW / 2, mapH - 12);
  }

  /* ═══════════ ATTACK CONFIRMATION OVERLAY ═══════════ */
  _atkConfirmOverlay(g) {
    const c = this.cx;
    const mapW = COLS * TILE;
    const mapH = ROWS * TILE;
    const { atk, def, af, df } = g._atkConfirm;

    /* dim the map — full-map dimming, not part of the dialog box below,
       so it's drawn before the scale transform and unaffected by it */
    c.fillStyle = 'rgba(0,0,0,0.65)';
    c.fillRect(0, 0, mapW, mapH);

    /* The dialog aims to match the info pane's own ambient scale — drawn
       at its normal size then stretched from the map's center point, the
       same technique the sidebar uses so none of the many offsets below
       need to be individually rewritten. Unlike the sidebar, though, this
       dialog is confined to the fixed-size map area — it can't grow the
       canvas to make room the way the pane does, so it's capped at
       whatever still leaves the box safely inside the map. */
    const ow = 380, oh = 188;
    const scale = this._sideRect.scale;
    const maxSafeBoost = Math.min((mapW * 0.92) / ow, (mapH * 0.92) / oh);
    const boost = scale > 1 ? Math.min(scale, maxSafeBoost) : 1;
    const mx0 = mapW / 2, my0 = mapH / 2;
    c.save();
    c.translate(mx0, my0);
    c.scale(boost, boost);
    c.translate(-mx0, -my0);

    /* box */
    const ox = Math.round((mapW - ow) / 2);
    const oy = Math.round((mapH - oh) / 2);
    c.fillStyle = '#07071a'; c.fillRect(ox, oy, ow, oh);
    c.strokeStyle = '#9030d0'; c.lineWidth = 2; c.strokeRect(ox, oy, ow, oh);

    const lx = ox + 14;

    /* title */
    c.fillStyle = '#b060ff'; c.font = `8px ${FONT}`; c.textAlign = 'center';
    c.fillText('CONFIRM ATTACK', ox + ow / 2, oy + 15);
    c.fillStyle = '#402060'; c.fillRect(ox + 10, oy + 21, ow - 20, 1);

    /* ── ATK row ── */
    const atY = oy + 34;
    c.textAlign = 'left';
    c.fillStyle = '#8080ff'; c.font = `7px ${FONT}`; c.fillText('ATK', lx, atY);
    c.fillStyle = '#c0c0ff'; c.font = `8px ${FONT}`; c.fillText(atk.name, lx + 26, atY);
    const atkPredHp = df ? Math.max(0, atk.hp - df.dmg) : atk.hp;
    this._forecastBar(c, lx, atY + 5, ow - 28, 8, atk.hp, atk.maxHp, atkPredHp);
    c.fillStyle = '#9090b0'; c.font = `7px ${FONT}`; c.textAlign = 'right';
    c.fillText(`HP ${atk.hp}\u2192${atkPredHp}/${atk.maxHp}`, ox + ow - 12, atY + 14);
    c.textAlign = 'left'; c.fillStyle = C.TXT;
    c.fillText(`DMG ${af.dmg}  HIT ${af.hit}%  CRT ${af.crit}%${af.doubles ? '  \xd72' : ''}`, lx, atY + 28);

    /* divider */
    c.fillStyle = '#402060'; c.fillRect(ox + 10, oy + 78, ow - 20, 1);

    /* ── DEF row ── */
    const dfY = oy + 92;
    c.textAlign = 'left';
    c.fillStyle = '#ff8080'; c.font = `7px ${FONT}`; c.fillText('DEF', lx, dfY);
    c.fillStyle = '#ffb0b0'; c.font = `8px ${FONT}`; c.fillText(def.name, lx + 26, dfY);
    const defPredHp = Math.max(0, def.hp - af.dmg);
    this._forecastBar(c, lx, dfY + 5, ow - 28, 8, def.hp, def.maxHp, defPredHp);
    c.fillStyle = '#9090b0'; c.font = `7px ${FONT}`; c.textAlign = 'right';
    c.fillText(`HP ${def.hp}\u2192${defPredHp}/${def.maxHp}`, ox + ow - 12, dfY + 14);
    c.textAlign = 'left';
    if (df) {
      c.fillStyle = C.TXT;
      c.fillText(`DMG ${df.dmg}  HIT ${df.hit}%  CRT ${df.crit}%${df.doubles ? '  \xd72' : ''}`, lx, dfY + 28);
    } else {
      c.fillStyle = '#666'; c.fillText('Cannot counter', lx, dfY + 28);
    }

    /* ── buttons ── */
    const btnW = 140, btnH = 28;
    const btnY = oy + oh - 40;
    const aBx  = ox + ow / 2 - btnW - 8;
    const cBx  = ox + ow / 2 + 8;

    c.fillStyle = '#0a1840'; c.fillRect(aBx, btnY, btnW, btnH);
    c.strokeStyle = '#4060d0'; c.lineWidth = 2; c.strokeRect(aBx, btnY, btnW, btnH);
    c.fillStyle = '#8090ff'; c.font = `8px ${FONT}`; c.textAlign = 'center';
    c.fillText('ATTACK', aBx + btnW / 2, btnY + 19);

    c.fillStyle = '#200808'; c.fillRect(cBx, btnY, btnW, btnH);
    c.strokeStyle = '#b03030'; c.lineWidth = 2; c.strokeRect(cBx, btnY, btnW, btnH);
    c.fillStyle = '#ff6060';
    c.fillText('CANCEL', cBx + btnW / 2, btnY + 19);

    c.restore();

    /* convert the button bounds recorded above (in the dialog's local,
       unscaled space) to absolute canvas pixels — game.js hit-tests in
       absolute space, same as the sidebar's own bounds conversion */
    const toAbs = (lx2, ly2, lw2, lh2) => ({
      x: mx0 + (lx2 - mx0) * boost, y: my0 + (ly2 - my0) * boost, w: lw2 * boost, h: lh2 * boost,
    });
    this._atkConfirmAttackBtn = toAbs(aBx, btnY, btnW, btnH);
    this._atkConfirmCancelBtn = toAbs(cBx, btnY, btnW, btnH);
  }

  /* HP bar that also shows predicted-loss zone after an attack */
  _forecastBar(c, x, y, w, h, hp, maxHp, predHp) {
    const m = Math.max(1, maxHp);
    /* background */
    c.fillStyle = '#1a1a2a'; c.fillRect(x, y, w, h);
    /* current HP bar */
    const curW = Math.max(0, Math.round(w * hp / m));
    c.fillStyle = hp / m > 0.5 ? '#20a020' : hp / m > 0.25 ? '#a08010' : '#a01010';
    c.fillRect(x, y, curW, h);
    /* predicted-loss zone (dark red overlay + red marker) */
    if (predHp < hp && hp > 0) {
      const predW = Math.max(0, Math.round(w * predHp / m));
      c.fillStyle = 'rgba(180,0,0,0.55)';
      c.fillRect(x + predW, y, curW - predW, h);
      if (predW > 0) { c.fillStyle = '#ff4040'; c.fillRect(x + predW - 1, y, 2, h); }
    }
    /* border */
    c.strokeStyle = '#333344'; c.lineWidth = 1; c.strokeRect(x, y, w, h);
  }

  _enemyAtkBanner() {
    const c = this.cx;
    const mapW = COLS * TILE;
    const pulse = 0.7 + Math.sin(this.t * 0.12) * 0.3;
    c.fillStyle = `rgba(80,0,0,${0.9 * pulse})`;
    c.fillRect(0, 0, mapW, 32);
    c.strokeStyle = `rgba(255,60,60,${0.8 * pulse})`;
    c.lineWidth = 1;
    c.strokeRect(0, 0, mapW, 32);
    c.fillStyle = `rgba(255,180,180,${pulse})`;
    c.font = `9px ${FONT}`;
    c.textAlign = 'center';
    c.fillText('\u2694 Enemy attacks!', mapW / 2, 20);
  }

  _transOverlay(g) {
    const c = this.cx;
    const tr = g.trans;
    if (!tr) return;

    /* draw walker units (including off-screen partial visibility at edges) */
    const mapH = ROWS * TILE;
    c.save();
    c.beginPath();
    c.rect(0, 0, COLS * TILE, mapH);
    c.clip();
    for (const w of tr.walkers) {
      if (w.unit.alive) this._unit(w.unit, g);
    }
    c.restore();

    /* banner text */
    const mx = (COLS * TILE) / 2;
    const pulse = 0.7 + Math.sin(this.t * 0.08) * 0.3;
    c.fillStyle = `rgba(0,0,0,${0.5 * pulse})`;
    c.fillRect(0, mapH / 2 - 20, COLS * TILE, 40);
    c.textAlign = 'center';
    c.fillStyle = C.GOLD;
    c.font = `12px ${FONT}`;
    if (tr.dir === 'out') {
      c.fillText('MARCHING ONWARD...', mx, mapH / 2 + 5);
    } else {
      c.fillText(g.floor === 0 ? 'TUTORIAL' : `LEVEL ${g.floor}`, mx, mapH / 2 + 5);
    }
  }

  _overlay(g) {
    const c = this.cx, W = this.cv.width, H = this.cv.height;
    c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(0, 0, W, H);
    const mx = W / 2, my = H / 2;
    c.textAlign = 'center';

    if (g.state === S_WIN) {
      c.fillStyle = C.GOLD; c.font = `22px ${FONT}`;
      const title = g.floor === 0 ? 'TUTORIAL CLEAR!'
                  : g.floor >= FINAL_FLOOR ? 'WARLORD DEFEATED!'
                  : 'VICTORY!';
      c.fillText(title, mx, my - 30);
      c.fillStyle = C.TXT;  c.font = `10px ${FONT}`;
      const sub = g.floor === 0 ? 'You learned the basics!'
                : g.floor >= FINAL_FLOOR ? 'The darkness has been vanquished!'
                : `Level ${g.floor} cleared!`;
      c.fillText(sub, mx, my + 10);
      c.fillText('Tap or click to continue', mx, my + 40);
    } else {
      c.fillStyle = '#ff2020'; c.font = `22px ${FONT}`; c.fillText('GAME OVER', mx, my - 30);
      c.fillStyle = C.TXT;    c.font = `10px ${FONT}`; c.fillText('Your Lord has fallen!', mx, my + 10);
      c.fillText('Tap or click to restart', mx, my + 40);
    }
  }

  /* ═══════════ VICTORY SCREEN ═══════════ */
  _victoryScreen(g) {
    const c = this.cx;
    const t = this.t;

    /* dark sky with animated stars */
    c.fillStyle = '#060618';
    c.fillRect(0, 0, CANVAS_W, CANVAS_H);

    /* twinkling stars */
    for (let i = 0; i < 80; i++) {
      const sx = (i * 137 + 50) % CANVAS_W;
      const sy = (i * 97  + 30) % CANVAS_H;
      const twinkle = 0.3 + Math.sin(t * 0.05 + i * 2) * 0.7;
      c.fillStyle = `rgba(255,255,255,${Math.max(0, twinkle)})`;
      c.fillRect(sx, sy, 1 + (i % 2), 1 + (i % 2));
    }

    /* golden sunrise glow at the bottom */
    const grd = c.createLinearGradient(0, CANVAS_H - 120, 0, CANVAS_H);
    grd.addColorStop(0, 'rgba(255,180,40,0)');
    grd.addColorStop(1, 'rgba(255,140,20,0.3)');
    c.fillStyle = grd;
    c.fillRect(0, CANVAS_H - 120, CANVAS_W, 120);

    /* ground */
    c.fillStyle = '#2a4a12';
    c.fillRect(0, CANVAS_H - 60, CANVAS_W, 60);
    c.fillStyle = '#3a5a18';
    c.fillRect(0, CANVAS_H - 60, CANVAS_W, 4);

    const mx = CANVAS_W / 2;

    /* draw all 4 player characters standing on the ground, celebrating */
    const chars = [
      { key: 'LORD',    hue: '#2860f0', helm: '#ffd700', lbl: 'L', off: -90 },
      { key: 'FIGHTER', hue: '#e06020', helm: '#a04010', lbl: 'F', off: -30 },
      { key: 'MAGE',    hue: '#a020e0', helm: '#6010a0', lbl: 'M', off:  30 },
      { key: 'ARCHER',  hue: '#20a040', helm: '#106020', lbl: 'A', off:  90 },
    ];

    for (const ch of chars) {
      const cx = mx + ch.off;
      /* bobbing animation — each character bobs at different phase */
      const bob = Math.sin(t * 0.08 + ch.off * 0.05) * 4;
      const by = CANVAS_H - 100 + bob;

      /* body */
      c.fillStyle = ch.hue;
      c.fillRect(cx - 12, by + 14, 24, 16);

      /* head */
      c.fillStyle = '#f0c890';
      c.fillRect(cx - 8, by + 4, 16, 14);

      /* eyes — happy squint */
      c.fillStyle = '#202020';
      c.fillRect(cx - 6, by + 10, 3, 2);
      c.fillRect(cx + 3, by + 10, 3, 2);

      /* helmet */
      c.fillStyle = ch.helm;
      c.fillRect(cx - 10, by + 2, 20, 6);

      /* arms raised in celebration */
      const armWave = Math.sin(t * 0.12 + ch.off * 0.08) * 4;
      c.fillStyle = ch.hue;
      c.fillRect(cx - 18, by + 8 - armWave, 6, 14);
      c.fillRect(cx + 12, by + 8 + armWave, 6, 14);

      /* border */
      c.strokeStyle = '#80a0ff';
      c.lineWidth = 2;
      c.strokeRect(cx - 14, by + 2, 28, 30);
    }

    /* floating sparkle particles */
    for (let i = 0; i < 20; i++) {
      const px = (i * 53 + t * 0.5) % CANVAS_W;
      const py = CANVAS_H - 80 - ((i * 41 + t * 0.3) % 200);
      const a = 0.3 + Math.sin(t * 0.1 + i) * 0.3;
      c.fillStyle = `rgba(255,215,0,${Math.max(0, a)})`;
      c.fillRect(px, py, 2, 2);
    }

    /* title text */
    c.textAlign = 'center';

    /* main title with glow */
    const glow = 0.5 + Math.sin(t * 0.04) * 0.3;
    c.shadowColor = `rgba(255,215,0,${glow})`;
    c.shadowBlur = 20;
    c.fillStyle = C.GOLD;
    c.font = `22px ${FONT}`;
    c.fillText('JOURNEY COMPLETE!', mx, 80);
    c.shadowBlur = 0;

    c.fillStyle = C.TXT;
    c.font = `10px ${FONT}`;
    c.fillText('The Warlord is vanquished.', mx, 120);
    c.fillText('Peace returns to the realm.', mx, 145);

    /* stats */
    c.fillStyle = '#8080c0';
    c.font = `8px ${FONT}`;
    c.fillText(`Levels conquered: ${FINAL_FLOOR}`, mx, 190);

    /* END JOURNEY / CONTINUE QUEST buttons — pinned to the very bottom
       edge, below the celebrating characters (they bob as low as
       CANVAS_H-64, see the loop above) so the buttons sit on the ground
       strip instead of painting over the dancing sprites. */
    const btnW = 174, btnH = 38, btnGap = 20;
    const btnY = CANVAS_H - 40;
    const endBx = mx - btnW - btnGap / 2;
    const cntBx = mx + btnGap / 2;

    c.fillStyle = '#0a1020'; c.fillRect(endBx, btnY, btnW, btnH);
    c.strokeStyle = '#405080'; c.lineWidth = 2; c.strokeRect(endBx, btnY, btnW, btnH);
    c.fillStyle = '#8090b0'; c.font = `8px ${FONT}`; c.textAlign = 'center';
    c.fillText('END JOURNEY', endBx + btnW / 2, btnY + 14);
    c.fillStyle = '#505870'; c.font = `6px ${FONT}`;
    c.fillText('return to title', endBx + btnW / 2, btnY + 28);

    c.fillStyle = '#1a1000'; c.fillRect(cntBx, btnY, btnW, btnH);
    c.strokeStyle = C.GOLD; c.lineWidth = 2; c.strokeRect(cntBx, btnY, btnW, btnH);
    c.fillStyle = C.GOLD; c.font = `8px ${FONT}`;
    c.fillText('CONTINUE QUEST', cntBx + btnW / 2, btnY + 14);
    c.fillStyle = '#908030'; c.font = `6px ${FONT}`;
    c.fillText('same team, new run', cntBx + btnW / 2, btnY + 28);

    this._victoryBtns = {
      end:  { x: endBx, y: btnY, w: btnW, h: btnH },
      cont: { x: cntBx, y: btnY, w: btnW, h: btnH },
    };
  }

  /* ═══════════ HEAL PREVIEW ═══════════ */
  _healPreview(pv, sx, y, sw) {
    const c = this.cx, x = sx + 10, w = sw - 20;
    const panelH = 78;
    c.fillStyle = '#0d200d'; c.fillRect(x - 4, y, w + 8, panelH);
    c.strokeStyle = '#20c040'; c.lineWidth = 2; c.strokeRect(x - 4, y, w + 8, panelH);

    c.fillStyle = '#60ff80'; c.font = `${PANE_FONT}px ${FONT}`; c.textAlign = 'center';
    c.fillText('HEAL PREVIEW', sx + sw / 2, y + 16);

    c.textAlign = 'left'; c.font = `${PANE_FONT}px ${FONT}`;
    c.fillStyle = '#80ff80';
    c.fillText(pv.target.name, x, y + 36);
    c.fillStyle = C.TXT;
    c.fillText(`HP ${pv.target.hp}/${pv.target.maxHp}  →  ${Math.min(pv.target.maxHp, pv.target.hp + pv.amount)}`, x, y + 54);
    c.fillStyle = '#60ff80';
    c.fillText(`+${pv.amount} HP`, x, y + 70);
  }

  /* STEAL PREVIEW */
  _stealPreview(pv, sx, y, sw) {
    const c = this.cx, x = sx + 10, w = sw - 20;
    const panelH = 78;
    c.fillStyle = '#1a1a0d'; c.fillRect(x - 4, y, w + 8, panelH);
    c.strokeStyle = '#c0a020'; c.lineWidth = 2; c.strokeRect(x - 4, y, w + 8, panelH);

    c.fillStyle = '#ffd740'; c.font = `${PANE_FONT}px ${FONT}`; c.textAlign = 'center';
    c.fillText('STEAL PREVIEW', sx + sw / 2, y + 16);

    c.textAlign = 'left'; c.font = `${PANE_FONT}px ${FONT}`;
    c.fillStyle = '#ff8080';
    c.fillText(pv.target.name, x, y + 36);
    c.fillStyle = C.TXT;
    c.fillText(`Item: ${pv.item.name}`, x, y + 54);
    c.fillStyle = '#ffd740';
    c.fillText(`${pv.chance}% chance`, x, y + 70);
  }


  /* ═══════════ DRAFT SCREEN ═══════════ */
  _draftScreen(g) {
    const c = this.cx;
    const CW = this.cv.width, CH = this.cv.height;
    const portrait = this._draftPortrait;
    c.fillStyle = '#0a0a1a';
    c.fillRect(0, 0, CW, CH);

    const mx = CW / 2;

    /* title */
    c.textAlign = 'center';
    c.fillStyle = C.GOLD; c.font = `${portrait ? 24 : 18}px ${FONT}`;
    c.fillText('DRAFT YOUR TEAM', mx, portrait ? 46 : 40);

    c.fillStyle = '#8080c0'; c.font = `${portrait ? 12 : 8}px ${FONT}`;
    c.fillText('Lord always leads. Pick 3 more units.', mx, portrait ? 70 : 60);

    /* Lord card (always selected) */
    const lordInfo = CLASS_INFO['LORD'];
    const lordW = portrait ? Math.min(420, CW - 80) : 160;
    const lordH = portrait ? 52 : 36;
    const lordX = mx - lordW / 2, lordY = portrait ? 88 : 76;
    c.fillStyle = '#1a2a60'; c.fillRect(lordX, lordY, lordW, lordH);
    c.strokeStyle = C.GOLD; c.lineWidth = 2; c.strokeRect(lordX, lordY, lordW, lordH);
    c.fillStyle = C.GOLD; c.font = `${portrait ? 15 : 9}px ${FONT}`; c.textAlign = 'center';
    c.fillText(`\u2605 ${lordInfo.name} - ${lordInfo.w.name}`, mx, lordY + lordH / 2 + 5);

    /* class cards — a single column in portrait (so reading them only ever
       needs vertical scrolling), 4 columns wrapping in landscape */
    const pool = g._draftPool;
    const picks = g._draftPicks;
    const cardH = portrait ? 220 : 140, gap = 12;
    const cols = portrait ? 1 : 4;
    const cardW = portrait ? Math.min(660, CW - 80) : 230;
    const rows = Math.ceil(pool.length / cols);
    const gridW = cols * cardW + (cols - 1) * gap;
    const startX = (CW - gridW) / 2;
    const startY = lordY + lordH + 20;

    /* Landscape class name matches the info pane's "LEVEL 1" header size
       (PANE_FONT) so text reads consistently between screens there. But
       unlike the sidebar, this canvas doesn't get an ambient scale
       transform in portrait — it's fit to the screen by shrinking the
       whole (much taller, single-column) canvas down, which on its own
       would make a flat PANE_FONT render tinier than on the info pane
       (confirmed: ~4px on screen at a typical phone width, vs ~10-13px
       for the sidebar). So portrait doubles the fonts here to compensate,
       the same way the sidebar's ambient scale compensates for its own
       fit-to-screen shrink. */
    const wide = cardW >= 400;
    const statColW  = wide ? Math.floor((cardW - 28) / 4) : 52;
    const nameFont  = portrait ? PANE_FONT * 2 : PANE_FONT;
    const subFont   = portrait ? 14 : 7;
    const smallFont = portrait ? 12 : 6;
    /* row Y-offsets (from the card's top) scale up together with the fonts
       above so lines don't crowd each other as they get taller */
    const rowName  = portrait ? 30  : 18;
    const rowSub   = portrait ? 52  : 32;
    const rowStat1 = portrait ? 84  : 50;
    const rowStat2 = portrait ? 110 : 64;
    const rowGrow  = portrait ? 152 : 90;
    const rowDesc  = portrait ? 178 : 106;
    const statValOffset = portrait ? 38 : 24;

    const bounds = { cards: [], confirm: null };

    for (let i = 0; i < pool.length; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const cx = startX + col * (cardW + gap);
      const cy = startY + row * (cardH + gap);
      const cls = pool[i];
      const info = CLASS_INFO[cls];
      const selected = picks.includes(cls);

      /* card background */
      c.fillStyle = selected ? '#1a3050' : '#101020';
      c.fillRect(cx, cy, cardW, cardH);
      c.strokeStyle = selected ? '#40a0ff' : '#303050';
      c.lineWidth = selected ? 3 : 1;
      c.strokeRect(cx, cy, cardW, cardH);

      /* class color bar */
      c.fillStyle = info.hue;
      c.fillRect(cx, cy, 6, cardH);

      /* name + weapon */
      c.textAlign = 'left';
      c.fillStyle = selected ? '#60c0ff' : '#c0c0c0';
      c.font = `${nameFont}px ${FONT}`;
      c.fillText(info.name, cx + 14, cy + rowName);
      c.fillStyle = '#808090'; c.font = `${subFont}px ${FONT}`;
      c.fillText(info.w.name + (info.w.heal ? ' (Heal)' : '') + `  Rng:${info.w.rng[0]}-${info.w.rng[1]}`, cx + 14, cy + rowSub);

      /* stats */
      const b = info.base;
      const stats = [
        ['HP', b.hp], ['STR', b.str], ['MAG', b.mag], ['SKL', b.skl],
        ['SPD', b.spd], ['DEF', b.def], ['RES', b.res], ['MOV', b.mov],
      ];
      c.font = `${smallFont}px ${FONT}`;
      for (let s = 0; s < stats.length; s++) {
        const scol = s % 4, srow = Math.floor(s / 4);
        const sx = cx + 14 + scol * statColW;
        const sy = srow === 0 ? cy + rowStat1 : cy + rowStat2;
        c.fillStyle = '#6060a0'; c.fillText(stats[s][0], sx, sy);
        c.fillStyle = '#d0d0d0'; c.fillText(String(stats[s][1]).padStart(2), sx + statValOffset, sy);
      }

      /* growth hint */
      c.fillStyle = '#505060'; c.font = `${smallFont}px ${FONT}`;
      const topGrowths = Object.entries(info.gr)
        .filter(([k]) => k !== 'hp')
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k]) => k.toUpperCase());
      c.fillText('Best: ' + topGrowths.join(', '), cx + 14, cy + rowGrow);

      /* description */
      const descs = {
        FIGHTER: 'High HP & STR. Slow but hits hard.',
        MAGE: 'Ranged magic. Fragile but strong vs RES.',
        ARCHER: 'Range 2 only. High SKL, no melee.',
        HEALER: 'Heals allies. Low combat stats.',
        CAVALIER: 'High MOV. Balanced melee/ranged.',
        KNIGHT: 'Massive DEF, low SPD. A wall.',
        THIEF: 'Fast & lucky. Can steal enemy items.',
      };
      c.fillStyle = '#707080'; c.font = `${smallFont}px ${FONT}`;
      c.fillText(descs[cls] || '', cx + 14, cy + rowDesc);

      /* selection checkmark */
      if (selected) {
        c.fillStyle = '#40ff80'; c.font = `${portrait ? 22 : 14}px ${FONT}`; c.textAlign = 'right';
        c.fillText('\u2713', cx + cardW - 10, cy + rowName + 4);
      }

      bounds.cards.push({ x: cx, y: cy, w: cardW, h: cardH });
    }

    /* pick counter */
    c.textAlign = 'center';
    c.fillStyle = picks.length === 3 ? '#40ff80' : '#c0c0c0';
    c.font = `${portrait ? 14 : 9}px ${FONT}`;
    c.fillText(`${picks.length} / 3 selected`, mx, startY + rows * (cardH + gap) + (portrait ? 26 : 20));

    /* confirm button */
    const btnW = portrait ? 260 : 200, btnH = portrait ? 50 : 36;
    const btnX = mx - btnW / 2;
    const btnY = startY + rows * (cardH + gap) + (portrait ? 44 : 34);
    const canConfirm = picks.length === 3;
    c.fillStyle = canConfirm ? '#103820' : '#101010';
    c.fillRect(btnX, btnY, btnW, btnH);
    c.strokeStyle = canConfirm ? '#40c060' : '#303030';
    c.lineWidth = 2; c.strokeRect(btnX, btnY, btnW, btnH);
    c.fillStyle = canConfirm ? '#60ff80' : '#404040';
    c.font = `${portrait ? 15 : 10}px ${FONT}`;
    c.fillText('CONFIRM', mx, btnY + btnH / 2 + 5);

    if (canConfirm) bounds.confirm = { x: btnX, y: btnY, w: btnW, h: btnH };

    this._draftBounds = bounds;
  }

  /* ═══════════ BONUS SCREEN ═══════════ */
  _bonusScreen(g) {
    const c = this.cx;
    c.fillStyle = '#0a0a1a';
    c.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const mx = CANVAS_W / 2;

    /* title */
    c.textAlign = 'center';
    c.fillStyle = C.GOLD; c.font = `16px ${FONT}`;
    c.fillText('LEVEL CLEARED!', mx, 50);
    c.fillStyle = '#8080c0'; c.font = `8px ${FONT}`;
    c.fillText('Choose a reward before advancing.', mx, 74);

    /* reward cards */
    const opts = g._bonusOpts;
    const cardW = 260, cardH = 200, gap = 30;
    const totalW = opts.length * cardW + (opts.length - 1) * gap;
    const startX = (CANVAS_W - totalW) / 2;
    const startY = 110;

    const bounds = { cards: [] };
    const icons = { RECRUIT: '\u2694', STRENGTHEN: '\u2B06', FORTIFY: '\u2764' };
    const colors = { RECRUIT: '#4080ff', STRENGTHEN: '#ffd740', FORTIFY: '#40ff80' };

    for (let i = 0; i < opts.length; i++) {
      const opt = opts[i];
      const cx = startX + i * (cardW + gap);
      const cy = startY;

      /* card */
      c.fillStyle = '#101028';
      c.fillRect(cx, cy, cardW, cardH);
      c.strokeStyle = colors[opt.label] || '#606060';
      c.lineWidth = 2;
      c.strokeRect(cx, cy, cardW, cardH);

      /* icon */
      c.fillStyle = colors[opt.label] || '#ffffff';
      c.font = `28px ${FONT}`; c.textAlign = 'center';
      c.fillText(icons[opt.label] || '?', cx + cardW / 2, cy + 50);

      /* label */
      c.fillStyle = colors[opt.label] || '#ffffff';
      c.font = `12px ${FONT}`;
      c.fillText(opt.label, cx + cardW / 2, cy + 90);

      /* description */
      c.fillStyle = '#a0a0c0'; c.font = `7px ${FONT}`;
      /* wrap description text */
      const words = opt.desc.split(' ');
      let line = '', ly = cy + 120;
      for (const w of words) {
        const test = line + (line ? ' ' : '') + w;
        if (c.measureText(test).width > cardW - 30) {
          c.fillText(line, cx + cardW / 2, ly);
          line = w; ly += 14;
        } else {
          line = test;
        }
      }
      if (line) c.fillText(line, cx + cardW / 2, ly);

      /* hover prompt */
      c.fillStyle = '#505070'; c.font = `6px ${FONT}`;
      c.fillText('Click to select', cx + cardW / 2, cy + cardH - 16);

      bounds.cards.push({ x: cx, y: cy, w: cardW, h: cardH });
    }

    this._bonusBounds = bounds;
  }
}
