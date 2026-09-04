import {
  TILE, COLS, ROWS, SIDEBAR_W, CANVAS_W, CANVAS_H, C,
  T_PLAIN, T_FOREST, T_MOUNTAIN, T_WATER, T_WALL, T_ROAD, T_FORT,
  S_TITLE, S_ACTION_MENU, S_WIN, S_LOSE, S_ATK_SELECT, S_COMBAT_ANIM,
  S_TRANS_OUT, S_TRANS_IN, S_VICTORY, S_DRAFT, S_BONUS, FINAL_FLOOR,
} from './constants.js';
import { forecast, canCounter, inRange } from './combat.js';
import { isMuted } from './audio.js';
import { CLASS_INFO, DRAFT_POOL } from './units.js';

const FONT = '"Press Start 2P", monospace';

/* Portrait info-pane font/spacing scale — always at least MIN (readability
   is the priority: a phone-shaped viewport pays for this with a little
   letterboxing on the map, which is an acceptable trade), but grows past
   that for free on taller aspect ratios up to CAP, where it stops growing
   even on unusually tall/narrow viewports. */
const SIDEBAR_MIN_SCALE = 2.0;
const SIDEBAR_SCALE_CAP = 2.6;

/* The info panel's display content — unit stats, terrain, combat/heal/
   steal forecasts, play log — gets a further boost on top of the ambient
   scale above, in portrait only. The action buttons stay at the ambient
   scale alone (confirmed a good size already), so this only multiplies
   the font/spacing constants those specific draw calls use; it does not
   touch their width, so it can't overflow the pane.
   Because it needs more vertical room, the portrait sidebar's local
   height budget grows from CANVAS_H to PORTRAIT_INFO_BUDGET (see
   _applyLayout) — and since the map's own fit-to-screen zoom is bound by
   *whichever* of width or height is tighter, growing that budget past
   ~mapW/mapH-and-viewport-aspect-implied headroom makes the fit go
   height-bound and shrinks the map. PORTRAIT_INFO_BUDGET is kept close to
   the actual worst-case content height (see the comment above
   _sidebar()'s budget math) specifically to avoid that: pushing it much
   higher doesn't make the text any bigger on screen (the shrinking zoom
   cancels the boost back out) and can shrink the map severely (confirmed
   experimentally at INFO_BOOST=4 / budget=2200 — the map nearly
   disappeared off the top of the viewport). 2 / 1050 was the largest
   pairing that stayed clear of that cliff in testing. */
const INFO_BOOST = 2;
const PORTRAIT_INFO_BUDGET = 1050;

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
    this._sidebar(g);
    if (g.state === S_ACTION_MENU) this._menu(g);
    if (g.state === S_ATK_SELECT) this._atkPrompt();
    if (g._atkConfirm) this._atkConfirmOverlay(g);
    if (g.state === S_COMBAT_ANIM && g._enemyCombatPending) this._enemyAtkBanner();
    this._tutBanner(g);
    if (g.state === S_WIN || g.state === S_LOSE) this._overlay(g);
  }

  /* ═══════════ TITLE ═══════════ */
  _title(g) {
    const c = this.cx;
    const W = this.cv.width, H = this.cv.height;
    c.fillStyle = '#0a0a1a';
    c.fillRect(0, 0, W, H);

    /* stars — fill whatever shape the canvas actually is (portrait or
       landscape) so the starfield is never a landscape-only backdrop */
    c.fillStyle = '#fff';
    for (let i = 0; i < 160; i++) {
      const sx = (i * 137 + 50) % W;
      const sy = (i * 97  + 30) % H;
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

  /* ── Pixel art battle scene for title screen ── */
  _titleBattle(c, mx, my) {
    const t = this.t;
    const P = 4; /* pixel scale */
    const px = (x, y, w, h) => c.fillRect(x, y, w * P, h * P);

    /* ground / terrain */
    c.fillStyle = '#2d5a27';
    c.fillRect(mx - 160, my + 40, 320, 60);
    c.fillStyle = '#5a8a20';
    c.fillRect(mx - 160, my + 30, 320, 14);

    /* grass tufts */
    c.fillStyle = '#3a6a18';
    for (const gx of [-140, -80, -20, 50, 100]) {
      px(mx + gx, my + 32, 3, 1);
      px(mx + gx + 4, my + 30, 2, 1);
    }

    /* clash spark animation */
    const spark = Math.sin(t * 0.2) > 0;
    if (spark) {
      c.fillStyle = '#ffff80';
      const sx = mx, sy = my - 14;
      px(sx - 2, sy - 8, 1, 1); px(sx + 6, sy - 10, 1, 1);
      px(sx - 6, sy - 4, 1, 1); px(sx + 10, sy - 2, 1, 1);
      px(sx, sy - 14, 1, 1);    px(sx + 4, sy + 2, 1, 1);
      c.fillStyle = '#ffffff';
      px(sx, sy - 6, 2, 2);
      px(sx + 2, sy - 4, 1, 3);
      px(sx - 2, sy - 2, 1, 2);
    }

    /* ── Blue Lord (left, facing right, sword swinging) ── */
    const lx = mx - 70, ly = my - 30;
    const lBob = Math.sin(t * 0.12) * 2;

    /* boots */
    c.fillStyle = '#4a3020';
    px(lx + 4, ly + 44 + lBob, 4, 3);
    px(lx + 14, ly + 42 + lBob, 4, 5);

    /* legs */
    c.fillStyle = '#1a3080';
    px(lx + 6, ly + 36 + lBob, 3, 8);
    px(lx + 14, ly + 34 + lBob, 3, 8);

    /* body */
    c.fillStyle = '#2860f0';
    px(lx + 4, ly + 18 + lBob, 8, 16);
    /* armor highlight */
    c.fillStyle = '#5090ff';
    px(lx + 6, ly + 20 + lBob, 2, 4);

    /* cape */
    c.fillStyle = '#1040a0';
    px(lx, ly + 20 + lBob, 2, 14);
    px(lx - 2, ly + 24 + lBob, 2, 12);

    /* head */
    c.fillStyle = '#f0c890';
    px(lx + 6, ly + 6 + lBob, 6, 6);
    px(lx + 4, ly + 8 + lBob, 2, 4);

    /* helmet (gold) */
    c.fillStyle = '#c0a000';
    px(lx + 4, ly + 2 + lBob, 8, 5);
    px(lx + 6, ly + lBob, 4, 2);
    /* helmet plume */
    c.fillStyle = '#e02020';
    px(lx + 2, ly - 2 + lBob, 2, 4);
    px(lx, ly - 4 + lBob, 2, 4);

    /* eyes */
    c.fillStyle = '#202020';
    px(lx + 10, ly + 8 + lBob, 1, 1);

    /* sword arm (extended, swinging) */
    const sSwing = Math.sin(t * 0.15) * 3;
    c.fillStyle = '#f0c890';
    px(lx + 16, ly + 20 + lBob, 3, 3);
    /* sword */
    c.fillStyle = '#d0d0e0';
    px(lx + 20, ly + 10 + lBob + sSwing, 2, 14);
    px(lx + 18, ly + 8 + lBob + sSwing, 6, 2);
    /* hilt */
    c.fillStyle = '#c0a000';
    px(lx + 18, ly + 22 + lBob, 6, 2);
    /* blade gleam */
    c.fillStyle = '#ffffff';
    px(lx + 22, ly + 12 + lBob + sSwing, 1, 4);

    /* shield arm */
    c.fillStyle = '#3070d0';
    px(lx, ly + 22 + lBob, 3, 6);
    c.fillStyle = '#c0a000';
    px(lx - 2, ly + 22 + lBob, 2, 5);

    /* ── Red Brigand (right, facing left, axe raised) ── */
    const rx = mx + 30, ry = my - 36;
    const rBob = Math.sin(t * 0.12 + 1.5) * 2;

    /* boots */
    c.fillStyle = '#3a2a1a';
    px(rx + 6, ry + 52 + rBob, 5, 4);
    px(rx + 16, ry + 50 + rBob, 5, 6);

    /* legs */
    c.fillStyle = '#604020';
    px(rx + 8, ry + 42 + rBob, 4, 10);
    px(rx + 16, ry + 40 + rBob, 4, 10);

    /* body (bigger — brigand is bulkier) */
    c.fillStyle = '#904020';
    px(rx + 4, ry + 22 + rBob, 12, 18);
    /* belt */
    c.fillStyle = '#604020';
    px(rx + 4, ry + 36 + rBob, 12, 2);
    c.fillStyle = '#c0a000';
    px(rx + 8, ry + 36 + rBob, 4, 2);

    /* head */
    c.fillStyle = '#d0a870';
    px(rx + 6, ry + 10 + rBob, 8, 7);
    px(rx + 8, ry + 12 + rBob, 8, 5);

    /* bandana */
    c.fillStyle = '#c02020';
    px(rx + 4, ry + 8 + rBob, 10, 4);
    px(rx + 14, ry + 10 + rBob, 4, 2);

    /* eyes (angry) */
    c.fillStyle = '#202020';
    px(rx + 6, ry + 14 + rBob, 2, 1);

    /* mouth (snarl) */
    c.fillStyle = '#202020';
    px(rx + 6, ry + 16 + rBob, 3, 1);

    /* axe arm (raised to strike) */
    const aSwing = Math.sin(t * 0.15 + 1) * 4;
    c.fillStyle = '#d0a870';
    px(rx, ry + 22 + rBob, 4, 4);
    /* axe handle */
    c.fillStyle = '#6a4a2a';
    px(rx - 6, ry + 4 + rBob + aSwing, 2, 20);
    /* axe head */
    c.fillStyle = '#808090';
    px(rx - 12, ry + 2 + rBob + aSwing, 6, 4);
    px(rx - 14, ry + 4 + rBob + aSwing, 8, 6);
    px(rx - 12, ry + 10 + rBob + aSwing, 6, 2);
    /* axe gleam */
    c.fillStyle = '#c0c0d0';
    px(rx - 14, ry + 6 + rBob + aSwing, 2, 2);

    /* other arm */
    c.fillStyle = '#d0a870';
    px(rx + 18, ry + 26 + rBob, 3, 3);
    /* fist */
    c.fillStyle = '#d0a870';
    px(rx + 20, ry + 24 + rBob, 3, 4);
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
    /* top banner */
    c.fillStyle = 'rgba(5,10,40,0.90)';
    c.fillRect(0, 0, mapW, 42);
    c.strokeStyle = 'rgba(80,120,255,0.75)';
    c.lineWidth = 1;
    c.strokeRect(0, 0, mapW, 42);
    const snap = g._historyView.snap;

    /* ── OLDER / NEWER navigation buttons ── */
    const btnW = 84, btnH = 28, btnY = 7;
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
    c.font = `9px ${FONT}`;
    c.fillText(`PLAY HISTORY  \u00B7  Turn ${snap.turn}`, mapW / 2, 17);
    const entryText = g._historyView.entry ? g._historyView.entry.text : '';
    c.fillStyle = g._historyView.entry ? g._historyView.entry.color || '#a0a0c0' : '#505880';
    c.font = `6px ${FONT}`;
    c.fillText(entryText, mapW / 2, 33);
  }

  /* ═══════════ UNITS ═══════════ */
  _units(g) {
    for (const u of [...g.players, ...g.enemies]) if (u.alive) this._unit(u, g);
  }

  _unit(u, g) {
    const c = this.cx, x = u.x*TILE, y = u.y*TILE, T = TILE;
    const dim = u.isPlayer && u.done;

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
      /* red crosshair on target */
      c.strokeStyle = `rgba(255,100,100,${0.6 + Math.sin(this.t * 0.2) * 0.4})`;
      c.lineWidth = 2;
      const cx2 = x + T/2, cy2 = y + T/2, s = 14 + Math.sin(this.t * 0.15) * 2;
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
      /* crosshair corners */
      const cx = x + T/2, cy = y + T/2, s = 16 + Math.sin(this.t * 0.15) * 2;
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

    /* HP bar */
    const pct = u.hp / u.maxHp, bw = T - 6, by = y + T - 8;
    c.fillStyle = C.HP_BG; c.fillRect(x+3, by, bw, 5);
    c.fillStyle = pct > 0.5 ? C.HP_OK : pct > 0.25 ? C.HP_MID : C.HP_LOW;
    c.fillRect(x+3, by, Math.floor(bw * pct), 5);

    /* label — outlined so the letter reads clearly against whatever body/
       terrain color happens to be behind it, not just relying on size */
    c.font = 'bold 12px monospace'; c.textAlign = 'center';
    c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.strokeText(u.lbl, x + T/2, y + T - 9);
    c.fillStyle = '#fff';
    c.fillText(u.lbl, x + T/2, y + T - 9);
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
    /* the info content (unit stats, terrain, forecasts, play log) gets a
       further boost on top of `scale` above — reported unreadable even
       after that, unlike the buttons, which stay at `scale` alone */
    const infoBoost = scale > 1 ? INFO_BOOST : 1;

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
    if (u) y = this._unitPanel(u, px, y, lw - 20, infoBoost);

    /* terrain — suppressed while a combat/heal/steal forecast is active so the
       forecast always fits between the unit panel and the log without clipping */
    if (g.cur && !g.preview) y = this._terrainPanel(g, px, y, lw - 20, infoBoost);

    /* combat / heal / steal preview */
    if (g.preview) {
      if (g.preview.heal)       { this._healPreview(g.preview, 0, y, lw, infoBoost);  y += 70 * infoBoost; }
      else if (g.preview.steal) { this._stealPreview(g.preview, 0, y, lw, infoBoost); y += 70 * infoBoost; }
      else                      { this._combatPreview(g.preview, 0, y, lw, infoBoost); y += 120 * infoBoost; }
      y += 8 * infoBoost;
    }

    /* play log — fills whatever room is left down to the bottom of the
       pane, so the space freed up above goes toward more visible history
       rather than sitting blank */
    this._playLog(g, 0, y, lw, localBudget - 10 - y, infoBoost);

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

  _unitPanel(u, x, y, w, boost = 1) {
    const c = this.cx;
    const invCount = u.inventory ? u.inventory.length : 0;
    /* stats grid — as many columns as the width comfortably fits (down to
       1 for very narrow/heavily-boosted layouts), column width and the
       label-value gap both derived from the actual width so it can never
       overflow regardless of how narrow or wide `w` ends up */
    const cols = w >= 340 ? 4 : w >= 170 ? 2 : 1;
    const colW = Math.floor(w / cols);
    const valOffset = Math.floor(colW * 0.55);
    const stats = [['STR',u.str],['MAG',u.mag],['SKL',u.skl],['SPD',u.spd],['LCK',u.lck],['DEF',u.def],['RES',u.res],['MOV',u.mov]];
    const gridRows = Math.ceil(stats.length / cols);
    const rowH = 16 * boost;
    const gridH = gridRows * rowH + 8 * boost;
    const panelH = 54*boost + gridH + 54*boost + (invCount > 0 ? (14 + invCount * 12) * boost : 0);

    c.fillStyle = u.isPlayer ? '#1a1a50' : '#501a1a';
    c.fillRect(x-4, y, w+8, panelH);
    c.strokeStyle = u.isPlayer ? '#3030a0' : '#a03030';
    c.lineWidth = 1; c.strokeRect(x-4, y, w+8, panelH);

    y += 12*boost;
    c.fillStyle = C.GOLD; c.font = `${8*boost}px ${FONT}`; c.textAlign = 'left';
    c.fillText(u.name, x, y); y += 13*boost;
    c.fillStyle = '#8080b0'; c.font = `${6*boost}px ${FONT}`;
    c.fillText(`${u.className}  Lv.${u.level}  ${u.weapon.name}`, x, y); y += 13*boost;

    /* HP bar */
    const pct = u.hp / u.maxHp;
    const barH = 8 * boost;
    c.fillStyle = C.HP_BG; c.fillRect(x, y, w, barH);
    c.fillStyle = pct > 0.5 ? C.HP_OK : pct > 0.25 ? C.HP_MID : C.HP_LOW;
    c.fillRect(x, y, Math.floor(w * pct), barH);
    c.fillStyle = '#fff'; c.font = `${6*boost}px monospace`;
    c.fillText(`${u.hp}/${u.maxHp}`, x+2, y+barH-1); y += 16*boost;

    /* stats grid */
    c.font = `${7*boost}px ${FONT}`;
    for (let i = 0; i < stats.length; i++) {
      const col = i % cols, row = (i / cols) | 0;
      const sx = x + col * colW, sy = y + row * rowH;
      c.fillStyle = '#6060a0'; c.fillText(stats[i][0], sx, sy);
      c.fillStyle = C.TXT;     c.fillText(String(stats[i][1]).padStart(2), sx + valOffset, sy);
    }
    y += gridH;

    /* inventory */
    if (invCount > 0) {
      c.fillStyle = '#6060a0'; c.font = `${6*boost}px ${FONT}`;
      c.fillText('ITEMS', x, y); y += 10*boost;
      c.font = `${6*boost}px ${FONT}`;
      for (const item of u.inventory) {
        c.fillStyle = item.type === 'weapon' ? '#80b0ff' : '#80ff80';
        c.fillText('• ' + item.name, x + 4, y);
        y += 12*boost;
      }
    }

    return y + 4*boost;
  }

  _terrainPanel(g, x, y, w, boost = 1) {
    const c = this.cx, t = g.map.at(g.cur.x, g.cur.y);
    y += 6*boost;
    const panelH = 54 * boost;
    c.fillStyle = '#101020'; c.fillRect(x-4, y, w+8, panelH);
    c.strokeStyle = '#303050'; c.lineWidth = 1; c.strokeRect(x-4, y, w+8, panelH);
    y += 12*boost;
    c.fillStyle = C.GOLD; c.font = `${8*boost}px ${FONT}`; c.textAlign = 'left';
    c.fillText(t.name, x, y); y += 14*boost;
    c.fillStyle = C.TXT; c.font = `${7*boost}px ${FONT}`;
    c.fillText(`DEF +${t.def}  AVO +${t.avo}`, x, y); y += 12*boost;
    c.fillText(`Move: ${t.cost >= 99 ? '--' : t.cost}`, x, y); y += 22*boost;
    return y;
  }

  _combatPreview(pv, sx, y, sw, boost = 1) {
    const c = this.cx, x = sx + 10, w = sw - 20;
    const panelH = 120 * boost;
    c.fillStyle = '#0d0d20'; c.fillRect(x-4, y, w+8, panelH);
    c.strokeStyle = '#8020c0'; c.lineWidth = 2; c.strokeRect(x-4, y, w+8, panelH);

    c.fillStyle = '#c080ff'; c.font = `${8*boost}px ${FONT}`; c.textAlign = 'center';
    c.fillText('COMBAT FORECAST', sx + sw/2, y + 12*boost);

    c.textAlign = 'left'; c.font = `${7*boost}px ${FONT}`;
    /* attacker */
    c.fillStyle = '#8080ff'; c.fillText(pv.atk.name, x, y + 28*boost);
    c.fillStyle = C.TXT;
    c.fillText(`DMG ${pv.af.dmg}  HIT ${pv.af.hit}%`, x, y + 42*boost);
    c.fillText(`CRT ${pv.af.crit}%${pv.af.doubles ? '  x2' : ''}`, x, y + 54*boost);

    c.fillStyle = '#404060'; c.fillRect(x, y + 60*boost, w, 1);
    /* defender */
    c.fillStyle = '#ff8080'; c.fillText(pv.def.name, x, y + 74*boost);
    if (pv.df) {
      c.fillStyle = C.TXT;
      c.fillText(`DMG ${pv.df.dmg}  HIT ${pv.df.hit}%`, x, y + 88*boost);
      c.fillText(`CRT ${pv.df.crit}%${pv.df.doubles ? '  x2' : ''}`, x, y + 100*boost);
    } else {
      c.fillStyle = '#666'; c.fillText('Cannot counter', x, y + 88*boost);
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

  _playLog(g, sx, y, sw, maxH, boost = 1) {
    const c = this.cx, x = sx + 10, w = sw - 20;
    const LINE_H = 14 * boost;
    const headH = 14 * boost, padH = 11 * boost;
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
    c.fillStyle = '#4040a0'; c.font = `${6*boost}px ${FONT}`; c.textAlign = 'left';
    c.fillText('PLAY LOG', x, y + 10*boost);

    /* rewind charge counter — far right of header */
    const rbw = 44*boost, rbh = 13*boost, rbx = sx + sw - rbw - 6*boost, rby = y + 1*boost;
    c.fillStyle = hasRewind ? '#0e1e2e' : '#0a0a0a';
    c.fillRect(rbx, rby, rbw, rbh);
    c.strokeStyle = hasRewind ? '#30b0e0' : '#252530';
    c.lineWidth = 1; c.strokeRect(rbx, rby, rbw, rbh);
    c.fillStyle = hasRewind ? '#40d0f0' : '#303040';
    c.font = `${6*boost}px ${FONT}`; c.textAlign = 'center';
    c.fillText(`↺ ${g.rewindsLeft}`, rbx + rbw / 2, rby + 9*boost);
    c.textAlign = 'left';
    this._rewindBtnBounds = { x: rbx, y: rby, w: rbw, h: rbh };

    /* scroll arrow buttons — just left of the rewind counter */
    const arH = 13*boost, arW = 13*boost, arGap = 2*boost;
    const arDnX = rbx - arW - 4*boost;
    const arUpX = arDnX - arW - arGap;
    const arY   = rby;

    /* up button */
    c.fillStyle = canScrollUp ? '#0e2030' : '#0a0a0a';
    c.fillRect(arUpX, arY, arW, arH);
    c.strokeStyle = canScrollUp ? '#2080a0' : '#202030';
    c.lineWidth = 1; c.strokeRect(arUpX, arY, arW, arH);
    c.fillStyle = canScrollUp ? '#60c0e0' : '#303040';
    c.font = `${8*boost}px ${FONT}`; c.textAlign = 'center';
    c.fillText('▲', arUpX + arW / 2, arY + 10*boost);
    this._logScrollUp = { x: arUpX, y: arY, w: arW, h: arH };

    /* down button */
    c.fillStyle = canScrollDown ? '#0e2030' : '#0a0a0a';
    c.fillRect(arDnX, arY, arW, arH);
    c.strokeStyle = canScrollDown ? '#2080a0' : '#202030';
    c.lineWidth = 1; c.strokeRect(arDnX, arY, arW, arH);
    c.fillStyle = canScrollDown ? '#60c0e0' : '#303040';
    c.font = `${8*boost}px ${FONT}`; c.textAlign = 'center';
    c.fillText('▼', arDnX + arW / 2, arY + 10*boost);
    this._logScrollDown = { x: arDnX, y: arY, w: arW, h: arH };

    /* entries */
    this._logEntryBounds = [];
    const entries = allEntries.slice(startIdx, endIdx);
    /* clip rendering to log panel content area */
    c.save();
    c.beginPath(); c.rect(x - 4, y + headH, w + 8, panelH - headH); c.clip();

    /* "older above" gradient hint */
    if (canScrollUp) {
      const grd = c.createLinearGradient(0, y + headH, 0, y + headH + 12*boost);
      grd.addColorStop(0, 'rgba(40,50,100,0.5)');
      grd.addColorStop(1, 'rgba(40,50,100,0)');
      c.fillStyle = grd;
      c.fillRect(x - 4, y + headH, w + 8, 12*boost);
    }

    const entryFont = 9 * boost;
    let ey = y + headH + 11*boost;
    for (const entry of entries) {
      const ebx = x - 4, ebw = w + 8, ebh = LINE_H;
      const isSelected = entry === selectedEntry;
      const hasSnap    = !!entry.snap;

      /* highlight selected entry; every entry is navigable so all get a subtle row tint */
      if (isSelected) {
        c.fillStyle = 'rgba(60,80,200,0.38)';
        c.fillRect(ebx, ey - 10*boost, ebw, ebh);
        c.strokeStyle = 'rgba(100,140,255,0.65)';
        c.lineWidth = 1; c.strokeRect(ebx, ey - 10*boost, ebw, ebh);
      } else {
        c.fillStyle = 'rgba(30,30,80,0.14)';
        c.fillRect(ebx, ey - 10*boost, ebw, ebh);
      }

      /* entry text — proportional sans-serif for clarity */
      let txt = entry.text;
      const maxChars = Math.floor((w - 16*boost) / (5.2 * boost)); // ~5.2px per char at 9px Arial
      if (txt.length > maxChars) txt = txt.slice(0, maxChars - 1) + '…';
      c.fillStyle = isSelected ? '#c0d0ff' : entry.color;
      c.font = `${entryFont}px Arial, sans-serif`;
      c.textAlign = 'left';
      c.fillText(txt, x + 1, ey);

      /* selected entry gets a small marker to remind the player this is the restore point */
      if (isSelected) {
        c.fillStyle = '#6080c0';
        c.font = `${6*boost}px ${FONT}`;
        c.textAlign = 'right';
        c.fillText('↺', sx + sw - 10*boost, ey);
      }

      this._logEntryBounds.push({ x: ebx, y: ey - 10*boost, w: ebw, h: ebh, entry });
      ey += LINE_H;
    }

    /* "newer below" gradient hint */
    if (canScrollDown) {
      const grd = c.createLinearGradient(0, y + panelH - 14*boost, 0, y + panelH - 2*boost);
      grd.addColorStop(0, 'rgba(40,50,100,0)');
      grd.addColorStop(1, 'rgba(40,50,100,0.5)');
      c.fillStyle = grd;
      c.fillRect(x - 4, y + panelH - 14*boost, w + 8, 12*boost);
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

    /* dim the map */
    c.fillStyle = 'rgba(0,0,0,0.65)';
    c.fillRect(0, 0, mapW, mapH);

    /* box */
    const ow = 380, oh = 188;
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

    this._atkConfirmAttackBtn = { x: aBx, y: btnY, w: btnW, h: btnH };
    this._atkConfirmCancelBtn = { x: cBx, y: btnY, w: btnW, h: btnH };
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

    /* draw road tiles along each walker's path */
    const drawn = new Set();
    for (const w of tr.walkers) {
      for (const pt of w.path) {
        if (pt.x >= 0 && pt.x < COLS && pt.y >= 0 && pt.y < ROWS) {
          const key = pt.x + ',' + pt.y;
          if (drawn.has(key)) continue;
          drawn.add(key);
          c.fillStyle = '#c8a870';
          c.fillRect(pt.x * TILE, pt.y * TILE, TILE, TILE);
          c.fillStyle = '#b89860';
          c.fillRect(pt.x * TILE + 16, pt.y * TILE + 2, 8, TILE - 4);
        }
      }
    }

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

    /* END JOURNEY / CONTINUE QUEST buttons */
    const btnW = 174, btnH = 38, btnGap = 20;
    const btnY = CANVAS_H - 76;
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
  _healPreview(pv, sx, y, sw, boost = 1) {
    const c = this.cx, x = sx + 10, w = sw - 20;
    const panelH = 70 * boost;
    c.fillStyle = '#0d200d'; c.fillRect(x - 4, y, w + 8, panelH);
    c.strokeStyle = '#20c040'; c.lineWidth = 2; c.strokeRect(x - 4, y, w + 8, panelH);

    c.fillStyle = '#60ff80'; c.font = `${8*boost}px ${FONT}`; c.textAlign = 'center';
    c.fillText('HEAL PREVIEW', sx + sw / 2, y + 14*boost);

    c.textAlign = 'left'; c.font = `${7*boost}px ${FONT}`;
    c.fillStyle = '#80ff80';
    c.fillText(pv.target.name, x, y + 32*boost);
    c.fillStyle = C.TXT;
    c.fillText(`HP ${pv.target.hp}/${pv.target.maxHp}  →  ${Math.min(pv.target.maxHp, pv.target.hp + pv.amount)}`, x, y + 48*boost);
    c.fillStyle = '#60ff80';
    c.fillText(`+${pv.amount} HP`, x, y + 62*boost);
  }

  /* STEAL PREVIEW */
  _stealPreview(pv, sx, y, sw, boost = 1) {
    const c = this.cx, x = sx + 10, w = sw - 20;
    const panelH = 70 * boost;
    c.fillStyle = '#1a1a0d'; c.fillRect(x - 4, y, w + 8, panelH);
    c.strokeStyle = '#c0a020'; c.lineWidth = 2; c.strokeRect(x - 4, y, w + 8, panelH);

    c.fillStyle = '#ffd740'; c.font = `${8*boost}px ${FONT}`; c.textAlign = 'center';
    c.fillText('STEAL PREVIEW', sx + sw / 2, y + 14*boost);

    c.textAlign = 'left'; c.font = `${7*boost}px ${FONT}`;
    c.fillStyle = '#ff8080';
    c.fillText(pv.target.name, x, y + 32*boost);
    c.fillStyle = C.TXT;
    c.fillText(`Item: ${pv.item.name}`, x, y + 48*boost);
    c.fillStyle = '#ffd740';
    c.fillText(`${pv.chance}% chance`, x, y + 62*boost);
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

    /* portrait cards get noticeably bigger text throughout — both because
       they're wider (so the extra width doesn't sit blank) and because
       phone-screen readability is the priority here over density */
    const wide = cardW >= 400;
    const statColW  = wide ? Math.floor((cardW - 28) / 4) : 52;
    const nameFont  = portrait ? 19 : 10;
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
