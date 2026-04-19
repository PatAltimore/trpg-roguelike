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
  }

  tick() { this.t++; }
  get endTurnBtn() { return this._btn; }
  get soundBtn()   { return this._sndBtn; }

  /* ═══════════ MAIN DRAW ═══════════ */
  draw(g) {
    const c = this.cx;
    c.clearRect(0, 0, CANVAS_W, CANVAS_H);

    if (g.state === S_TITLE)   { this._title(g); this._soundToggle(CANVAS_W - SIDEBAR_W, CANVAS_H - 40, SIDEBAR_W); return; }
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
    c.fillStyle = '#0a0a1a';
    c.fillRect(0, 0, CANVAS_W, CANVAS_H);

    /* stars */
    c.fillStyle = '#fff';
    for (let i = 0; i < 120; i++) {
      const sx = (i * 137 + 50) % CANVAS_W;
      const sy = (i * 97  + 30) % CANVAS_H;
      c.fillRect(sx, sy, 1 + (i % 2), 1 + (i % 2));
    }

    const mx = CANVAS_W / 2, my = CANVAS_H / 2;

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
    const mapW = COLS * TILE;
    /* dim the entire map area */
    c.fillStyle = 'rgba(0,0,30,0.38)';
    c.fillRect(0, 0, mapW, CANVAS_H);
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

    /* ◄ OLDER */
    c.fillStyle = '#0e1a30'; c.fillRect(olderX, btnY, btnW, btnH);
    c.strokeStyle = '#3050a0'; c.lineWidth = 1; c.strokeRect(olderX, btnY, btnW, btnH);
    c.fillStyle = '#6080d0'; c.font = `7px ${FONT}`; c.textAlign = 'center';
    c.fillText('\u25C4 OLDER', olderX + btnW / 2, btnY + 17);
    this._histNavOlder = { x: olderX, y: btnY, w: btnW, h: btnH };

    /* NEWER ► */
    c.fillStyle = '#0e1a30'; c.fillRect(newerX, btnY, btnW, btnH);
    c.strokeStyle = '#3050a0'; c.lineWidth = 1; c.strokeRect(newerX, btnY, btnW, btnH);
    c.fillStyle = '#6080d0'; c.font = `7px ${FONT}`; c.textAlign = 'center';
    c.fillText('NEWER \u25BA', newerX + btnW / 2, btnY + 17);
    this._histNavNewer = { x: newerX, y: btnY, w: btnW, h: btnH };

    /* ── centre label ── */
    c.textAlign = 'center';
    c.fillStyle = '#8090ff';
    c.font = `9px ${FONT}`;
    c.fillText(`\u25C4 HISTORY  \u00B7  Turn ${snap.turn}`, mapW / 2, 17);
    c.fillStyle = '#505880';
    c.font = `6px ${FONT}`;
    c.fillText('Tap OLDER / NEWER  \u00B7  Sidebar: REWIND or CANCEL', mapW / 2, 33);
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

    /* label */
    c.fillStyle = '#fff'; c.font = 'bold 9px monospace'; c.textAlign = 'center';
    c.fillText(u.lbl, x + T/2, y + T - 10);
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
    const c = this.cx, sx = COLS * TILE, sw = SIDEBAR_W, sh = CANVAS_H;
    c.fillStyle = C.SIDE_BG; c.fillRect(sx, 0, sw, sh);
    c.strokeStyle = C.SIDE_BD; c.lineWidth = 2; c.strokeRect(sx, 0, sw, sh);

    let y = 14;
    const px = sx + 10;
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

    /* divider */
    c.fillStyle = C.SIDE_BD; c.fillRect(sx+5, y, sw-10, 1); y += 8;

    /* unit info */
    const u = g.sel || this._unitAt(g, g.cur);
    if (u) y = this._unitPanel(u, px, y, sw - 20);

    /* ── fixed layout constants (computed early so the preview can reference LOG_TOP) ── */
    const SOUND_Y    = CANVAS_H - 34;
    const ENDTURN_Y  = SOUND_Y - 46;
    /* regen button (36px tall + 6px gap) sits between the log and END TURN when available */
    const LOG_BTM    = ENDTURN_Y - 8 - (g._canRegen ? 42 : 0);
    const LOG_TOP    = LOG_BTM - 123;  // 123px panel: 14px header + 7 lines×14px + 11px pad

    /* terrain — suppressed while a combat/heal/steal forecast is active so the
       forecast always fits between the unit panel and the log without clipping */
    if (g.cur && !g.preview) y = this._terrainPanel(g, px, y, sw - 20);

    /* store sidebar content bottom for action menu positioning */
    this._sidebarContentY = y;

    /* combat / heal / steal preview — pinned to sit just above the log panel */
    if (g.preview) {
      const previewH = g.preview.heal ? 70 : g.preview.steal ? 70 : 120;
      const previewY = Math.min(y, LOG_TOP - previewH - 4);
      if (previewY > 50) {
        if (g.preview.heal) { this._healPreview(g.preview, sx, previewY, sw); }
        else if (g.preview.steal) { this._stealPreview(g.preview, sx, previewY, sw); }
        else { this._combatPreview(g.preview, sx, previewY, sw); }
      }
    }

    /* play log */
    this._playLog(g, sx, LOG_TOP, sw);

    /* regen map button — visible only before the first action on each level */
    if (g._canRegen) {
      this._regenLevelBtn(sx, LOG_BTM + 4, sw);
    } else {
      this._regenBtn = null;
    }

    /* end-turn button OR history controls */
    if (g._historyView) {
      this._historyControls(g, sx, ENDTURN_Y, sw);
    } else {
      const showEndBtn = g.phase === 'player' && g.state !== S_ACTION_MENU && g.state !== S_ATK_SELECT;
      if (showEndBtn) this._endBtn(sx, ENDTURN_Y, sw);
    }
    this._soundToggle(sx, SOUND_Y, sw);
  }

  _unitAt(g, cur) {
    if (!cur) return null;
    return [...g.players, ...g.enemies].find(u => u.alive && u.x === cur.x && u.y === cur.y) || null;
  }

  _unitPanel(u, x, y, w) {
    const c = this.cx;
    const invCount = u.inventory ? u.inventory.length : 0;
    const panelH = 180 + (invCount > 0 ? 14 + invCount * 12 : 0);
    c.fillStyle = u.isPlayer ? '#1a1a50' : '#501a1a';
    c.fillRect(x-4, y, w+8, panelH);
    c.strokeStyle = u.isPlayer ? '#3030a0' : '#a03030';
    c.lineWidth = 1; c.strokeRect(x-4, y, w+8, panelH);

    y += 12;
    c.fillStyle = C.GOLD; c.font = `8px ${FONT}`; c.textAlign = 'left';
    c.fillText(u.name, x, y); y += 13;
    c.fillStyle = '#8080b0'; c.font = `6px ${FONT}`;
    c.fillText(`${u.className}  Lv.${u.level}  ${u.weapon.name}`, x, y); y += 13;

    /* HP bar */
    const pct = u.hp / u.maxHp;
    c.fillStyle = C.HP_BG; c.fillRect(x, y, w, 8);
    c.fillStyle = pct > 0.5 ? C.HP_OK : pct > 0.25 ? C.HP_MID : C.HP_LOW;
    c.fillRect(x, y, Math.floor(w * pct), 8);
    c.fillStyle = '#fff'; c.font = '6px monospace';
    c.fillText(`${u.hp}/${u.maxHp}`, x+2, y+7); y += 16;

    /* stats grid */
    const stats = [['STR',u.str],['MAG',u.mag],['SKL',u.skl],['SPD',u.spd],['LCK',u.lck],['DEF',u.def],['RES',u.res],['MOV',u.mov]];
    c.font = `7px ${FONT}`;
    for (let i = 0; i < stats.length; i++) {
      const col = i % 2, row = (i / 2) | 0;
      const sx = x + col * 96, sy = y + row * 16;
      c.fillStyle = '#6060a0'; c.fillText(stats[i][0], sx, sy);
      c.fillStyle = C.TXT;     c.fillText(String(stats[i][1]).padStart(2), sx + 38, sy);
    }
    y += 72;

    /* inventory */
    if (invCount > 0) {
      c.fillStyle = '#6060a0'; c.font = `6px ${FONT}`;
      c.fillText('ITEMS', x, y); y += 10;
      c.font = `6px ${FONT}`;
      for (const item of u.inventory) {
        c.fillStyle = item.type === 'weapon' ? '#80b0ff' : '#80ff80';
        c.fillText('\u2022 ' + item.name, x + 4, y);
        y += 12;
      }
    }

    return y + 4;
  }

  _terrainPanel(g, x, y, w) {
    const c = this.cx, t = g.map.at(g.cur.x, g.cur.y);
    y += 6;
    c.fillStyle = '#101020'; c.fillRect(x-4, y, w+8, 54);
    c.strokeStyle = '#303050'; c.lineWidth = 1; c.strokeRect(x-4, y, w+8, 54);
    y += 12;
    c.fillStyle = C.GOLD; c.font = `8px ${FONT}`; c.textAlign = 'left';
    c.fillText(t.name, x, y); y += 14;
    c.fillStyle = C.TXT; c.font = `7px ${FONT}`;
    c.fillText(`DEF +${t.def}  AVO +${t.avo}`, x, y); y += 12;
    c.fillText(`Move: ${t.cost >= 99 ? '--' : t.cost}`, x, y); y += 22;
    return y;
  }

  _combatPreview(pv, sx, y, sw) {
    const c = this.cx, x = sx + 10, w = sw - 20;
    c.fillStyle = '#0d0d20'; c.fillRect(x-4, y, w+8, 120);
    c.strokeStyle = '#8020c0'; c.lineWidth = 2; c.strokeRect(x-4, y, w+8, 120);

    c.fillStyle = '#c080ff'; c.font = `8px ${FONT}`; c.textAlign = 'center';
    c.fillText('COMBAT FORECAST', sx + sw/2, y + 12);

    c.textAlign = 'left'; c.font = `7px ${FONT}`;
    /* attacker */
    c.fillStyle = '#8080ff'; c.fillText(pv.atk.name, x, y + 28);
    c.fillStyle = C.TXT;
    c.fillText(`DMG ${pv.af.dmg}  HIT ${pv.af.hit}%`, x, y + 42);
    c.fillText(`CRT ${pv.af.crit}%${pv.af.doubles ? '  x2' : ''}`, x, y + 54);

    c.fillStyle = '#404060'; c.fillRect(x, y + 60, w, 1);
    /* defender */
    c.fillStyle = '#ff8080'; c.fillText(pv.def.name, x, y + 74);
    if (pv.df) {
      c.fillStyle = C.TXT;
      c.fillText(`DMG ${pv.df.dmg}  HIT ${pv.df.hit}%`, x, y + 88);
      c.fillText(`CRT ${pv.df.crit}%${pv.df.doubles ? '  x2' : ''}`, x, y + 100);
    } else {
      c.fillStyle = '#666'; c.fillText('Cannot counter', x, y + 88);
    }
  }

  _menu(g) {
    const c = this.cx;
    const itemH = 40, pad = 12;
    const sx = COLS * TILE;
    const sw = SIDEBAR_W;
    const mw = sw - 20, mh = g.menuOpts.length * itemH + pad * 2;
    const mx = sx + 10;
    /* place below the stats/terrain panels (tracked by _sidebar) */
    const my = (this._sidebarContentY || 340) + 6;

    /* background */
    c.fillStyle = '#0a0a20'; c.fillRect(mx - 2, my, mw + 4, mh);
    c.strokeStyle = '#6060d0'; c.lineWidth = 2; c.strokeRect(mx - 2, my, mw + 4, mh);

    /* header */
    c.fillStyle = '#8080cc'; c.font = `8px ${FONT}`; c.textAlign = 'center';
    c.fillText('ACTION', sx + sw / 2, my + 12);

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
      c.font = `10px ${FONT}`; c.textAlign = 'center';
      c.fillText(opt.label, sx + sw / 2, oy + 14);
    });

    /* store bounds for click detection */
    g._menuBounds = { x: mx - 2, y: my, w: mw + 4, h: mh };
  }

  /* ═══════════ PLAY LOG ═══════════ */

  _playLog(g, sx, y, sw) {
    const c = this.cx, x = sx + 10, w = sw - 20;
    const LOG_LINES = 7, LINE_H = 14;
    const panelH = 14 + LOG_LINES * LINE_H + 11;
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

    /* ── header row ── */
    c.fillStyle = '#4040a0'; c.font = `6px ${FONT}`; c.textAlign = 'left';
    c.fillText('PLAY LOG', x, y + 10);

    /* ↺ N charge counter — far right of header */
    const rbw = 44, rbh = 13, rbx = sx + sw - rbw - 6, rby = y + 1;
    c.fillStyle = hasRewind ? '#0e1e2e' : '#0a0a0a';
    c.fillRect(rbx, rby, rbw, rbh);
    c.strokeStyle = hasRewind ? '#30b0e0' : '#252530';
    c.lineWidth = 1; c.strokeRect(rbx, rby, rbw, rbh);
    c.fillStyle = hasRewind ? '#40d0f0' : '#303040';
    c.font = `6px ${FONT}`; c.textAlign = 'center';
    c.fillText(`\u21BA ${g.rewindsLeft}`, rbx + rbw / 2, rby + 9);
    c.textAlign = 'left';
    this._rewindBtnBounds = { x: rbx, y: rby, w: rbw, h: rbh };

    /* ▲ / ▼ scroll arrow buttons — just left of the ↺ counter */
    const arH = 13, arW = 13, arGap = 2;
    const arDnX = rbx - arW - 4;
    const arUpX = arDnX - arW - arGap;
    const arY   = rby;

    /* ▲ up button */
    c.fillStyle = canScrollUp ? '#0e2030' : '#0a0a0a';
    c.fillRect(arUpX, arY, arW, arH);
    c.strokeStyle = canScrollUp ? '#2080a0' : '#202030';
    c.lineWidth = 1; c.strokeRect(arUpX, arY, arW, arH);
    c.fillStyle = canScrollUp ? '#60c0e0' : '#303040';
    c.font = `8px ${FONT}`; c.textAlign = 'center';
    c.fillText('\u25B2', arUpX + arW / 2, arY + 10);
    this._logScrollUp = { x: arUpX, y: arY, w: arW, h: arH };

    /* ▼ down button */
    c.fillStyle = canScrollDown ? '#0e2030' : '#0a0a0a';
    c.fillRect(arDnX, arY, arW, arH);
    c.strokeStyle = canScrollDown ? '#2080a0' : '#202030';
    c.lineWidth = 1; c.strokeRect(arDnX, arY, arW, arH);
    c.fillStyle = canScrollDown ? '#60c0e0' : '#303040';
    c.font = `8px ${FONT}`; c.textAlign = 'center';
    c.fillText('\u25BC', arDnX + arW / 2, arY + 10);
    this._logScrollDown = { x: arDnX, y: arY, w: arW, h: arH };

    /* ── entries ── */
    this._logEntryBounds = [];
    const entries = allEntries.slice(startIdx, endIdx);
    /* clip rendering to log panel content area */
    c.save();
    c.beginPath(); c.rect(x - 4, y + 14, w + 8, panelH - 14); c.clip();

    /* "older above" gradient hint */
    if (canScrollUp) {
      const grd = c.createLinearGradient(0, y + 14, 0, y + 26);
      grd.addColorStop(0, 'rgba(40,50,100,0.5)');
      grd.addColorStop(1, 'rgba(40,50,100,0)');
      c.fillStyle = grd;
      c.fillRect(x - 4, y + 14, w + 8, 12);
    }

    let ey = y + 25;
    for (const entry of entries) {
      const ebx = x - 4, ebw = w + 8, ebh = LINE_H;
      const isSelected = entry === selectedEntry;
      const hasSnap    = !!entry.snap;

      /* highlight selected entry; every entry is navigable so all get a subtle row tint */
      if (isSelected) {
        c.fillStyle = 'rgba(60,80,200,0.38)';
        c.fillRect(ebx, ey - 10, ebw, ebh);
        c.strokeStyle = 'rgba(100,140,255,0.65)';
        c.lineWidth = 1; c.strokeRect(ebx, ey - 10, ebw, ebh);
      } else {
        c.fillStyle = 'rgba(30,30,80,0.14)';
        c.fillRect(ebx, ey - 10, ebw, ebh);
      }

      /* entry text — proportional sans-serif for clarity */
      let txt = entry.text;
      const maxChars = Math.floor((w - 16) / 5.2); // ~5.2px per char at 9px Arial
      if (txt.length > maxChars) txt = txt.slice(0, maxChars - 1) + '\u2026';
      c.fillStyle = isSelected ? '#c0d0ff' : entry.color;
      c.font = '9px Arial, sans-serif';
      c.textAlign = 'left';
      c.fillText(txt, x + 1, ey);

      /* selected entry gets a small ↺ marker to remind the player this is the restore point */
      if (isSelected) {
        c.fillStyle = '#6080c0';
        c.font = `6px ${FONT}`;
        c.textAlign = 'right';
        c.fillText('\u21BA', sx + sw - 10, ey);
      }

      this._logEntryBounds.push({ x: ebx, y: ey - 10, w: ebw, h: ebh, entry });
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
    c.save();
    c.beginPath();
    c.rect(0, 0, COLS * TILE, CANVAS_H);
    c.clip();
    for (const w of tr.walkers) {
      if (w.unit.alive) this._unit(w.unit, g);
    }
    c.restore();

    /* banner text */
    const mx = (COLS * TILE) / 2;
    const pulse = 0.7 + Math.sin(this.t * 0.08) * 0.3;
    c.fillStyle = `rgba(0,0,0,${0.5 * pulse})`;
    c.fillRect(0, CANVAS_H / 2 - 20, COLS * TILE, 40);
    c.textAlign = 'center';
    c.fillStyle = C.GOLD;
    c.font = `12px ${FONT}`;
    if (tr.dir === 'out') {
      c.fillText('MARCHING ONWARD...', mx, CANVAS_H / 2 + 5);
    } else {
      c.fillText(g.floor === 0 ? 'TUTORIAL' : `LEVEL ${g.floor}`, mx, CANVAS_H / 2 + 5);
    }
  }

  _overlay(g) {
    const c = this.cx;
    c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(0, 0, CANVAS_W, CANVAS_H);
    const mx = CANVAS_W / 2, my = CANVAS_H / 2;
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
  _healPreview(pv, sx, y, sw) {
    const c = this.cx, x = sx + 10, w = sw - 20;
    c.fillStyle = '#0d200d'; c.fillRect(x - 4, y, w + 8, 70);
    c.strokeStyle = '#20c040'; c.lineWidth = 2; c.strokeRect(x - 4, y, w + 8, 70);

    c.fillStyle = '#60ff80'; c.font = `8px ${FONT}`; c.textAlign = 'center';
    c.fillText('HEAL PREVIEW', sx + sw / 2, y + 14);

    c.textAlign = 'left'; c.font = `7px ${FONT}`;
    c.fillStyle = '#80ff80';
    c.fillText(pv.target.name, x, y + 32);
    c.fillStyle = C.TXT;
    c.fillText(`HP ${pv.target.hp}/${pv.target.maxHp}  \u2192  ${Math.min(pv.target.maxHp, pv.target.hp + pv.amount)}`, x, y + 48);
    c.fillStyle = '#60ff80';
    c.fillText(`+${pv.amount} HP`, x, y + 62);
  }

  /* ═══════════ STEAL PREVIEW ═══════════ */
  _stealPreview(pv, sx, y, sw) {
    const c = this.cx, x = sx + 10, w = sw - 20;
    c.fillStyle = '#1a1a0d'; c.fillRect(x - 4, y, w + 8, 70);
    c.strokeStyle = '#c0a020'; c.lineWidth = 2; c.strokeRect(x - 4, y, w + 8, 70);

    c.fillStyle = '#ffd740'; c.font = `8px ${FONT}`; c.textAlign = 'center';
    c.fillText('STEAL PREVIEW', sx + sw / 2, y + 14);

    c.textAlign = 'left'; c.font = `7px ${FONT}`;
    c.fillStyle = '#ff8080';
    c.fillText(pv.target.name, x, y + 32);
    c.fillStyle = C.TXT;
    c.fillText(`Item: ${pv.item.name}`, x, y + 48);
    c.fillStyle = '#ffd740';
    c.fillText(`${pv.chance}% chance`, x, y + 62);
  }

  /* ═══════════ DRAFT SCREEN ═══════════ */
  _draftScreen(g) {
    const c = this.cx;
    c.fillStyle = '#0a0a1a';
    c.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const mx = CANVAS_W / 2;

    /* title */
    c.textAlign = 'center';
    c.fillStyle = C.GOLD; c.font = `18px ${FONT}`;
    c.fillText('DRAFT YOUR TEAM', mx, 40);

    c.fillStyle = '#8080c0'; c.font = `8px ${FONT}`;
    c.fillText('Lord always leads. Pick 3 more units.', mx, 60);

    /* Lord card (always selected) */
    const lordInfo = CLASS_INFO['LORD'];
    const lordX = mx - 80, lordY = 76;
    c.fillStyle = '#1a2a60'; c.fillRect(lordX, lordY, 160, 36);
    c.strokeStyle = C.GOLD; c.lineWidth = 2; c.strokeRect(lordX, lordY, 160, 36);
    c.fillStyle = C.GOLD; c.font = `9px ${FONT}`; c.textAlign = 'center';
    c.fillText(`\u2605 ${lordInfo.name} - ${lordInfo.w.name}`, mx, lordY + 22);

    /* class cards — 4 columns, wrapping */
    const pool = g._draftPool;
    const picks = g._draftPicks;
    const cardW = 230, cardH = 140, gap = 12;
    const cols = 4, rows = Math.ceil(pool.length / cols);
    const gridW = cols * cardW + (cols - 1) * gap;
    const startX = (CANVAS_W - gridW) / 2;
    const startY = 126;

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
      c.font = `10px ${FONT}`;
      c.fillText(info.name, cx + 14, cy + 18);
      c.fillStyle = '#808090'; c.font = `7px ${FONT}`;
      c.fillText(info.w.name + (info.w.heal ? ' (Heal)' : '') + `  Rng:${info.w.rng[0]}-${info.w.rng[1]}`, cx + 14, cy + 32);

      /* stats */
      const b = info.base;
      const stats = [
        ['HP', b.hp], ['STR', b.str], ['MAG', b.mag], ['SKL', b.skl],
        ['SPD', b.spd], ['DEF', b.def], ['RES', b.res], ['MOV', b.mov],
      ];
      c.font = `6px ${FONT}`;
      for (let s = 0; s < stats.length; s++) {
        const scol = s % 4, srow = Math.floor(s / 4);
        const sx = cx + 14 + scol * 52;
        const sy = cy + 50 + srow * 14;
        c.fillStyle = '#6060a0'; c.fillText(stats[s][0], sx, sy);
        c.fillStyle = '#d0d0d0'; c.fillText(String(stats[s][1]).padStart(2), sx + 24, sy);
      }

      /* growth hint */
      c.fillStyle = '#505060'; c.font = `6px ${FONT}`;
      const topGrowths = Object.entries(info.gr)
        .filter(([k]) => k !== 'hp')
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k]) => k.toUpperCase());
      c.fillText('Best: ' + topGrowths.join(', '), cx + 14, cy + 90);

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
      c.fillStyle = '#707080'; c.font = `6px ${FONT}`;
      c.fillText(descs[cls] || '', cx + 14, cy + 106);

      /* selection checkmark */
      if (selected) {
        c.fillStyle = '#40ff80'; c.font = `14px ${FONT}`; c.textAlign = 'right';
        c.fillText('\u2713', cx + cardW - 10, cy + 22);
      }

      bounds.cards.push({ x: cx, y: cy, w: cardW, h: cardH });
    }

    /* pick counter */
    c.textAlign = 'center';
    c.fillStyle = picks.length === 3 ? '#40ff80' : '#c0c0c0';
    c.font = `9px ${FONT}`;
    c.fillText(`${picks.length} / 3 selected`, mx, startY + rows * (cardH + gap) + 20);

    /* confirm button */
    const btnW = 200, btnH = 36;
    const btnX = mx - btnW / 2;
    const btnY = startY + rows * (cardH + gap) + 34;
    const canConfirm = picks.length === 3;
    c.fillStyle = canConfirm ? '#103820' : '#101010';
    c.fillRect(btnX, btnY, btnW, btnH);
    c.strokeStyle = canConfirm ? '#40c060' : '#303030';
    c.lineWidth = 2; c.strokeRect(btnX, btnY, btnW, btnH);
    c.fillStyle = canConfirm ? '#60ff80' : '#404040';
    c.font = `10px ${FONT}`;
    c.fillText('CONFIRM', mx, btnY + 23);

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
