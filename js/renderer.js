import {
  TILE, COLS, ROWS, SIDEBAR_W, CANVAS_W, CANVAS_H, C,
  T_PLAIN, T_FOREST, T_MOUNTAIN, T_WATER, T_WALL, T_ROAD, T_FORT,
  S_TITLE, S_ACTION_MENU, S_WIN, S_LOSE, S_ATK_SELECT, S_COMBAT_ANIM,
  S_TRANS_OUT, S_TRANS_IN, S_VICTORY, FINAL_FLOOR,
} from './constants.js';
import { forecast, canCounter, inRange } from './combat.js';
import { isMuted } from './audio.js';

const FONT = '"Press Start 2P", monospace';

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.cx = canvas.getContext('2d');
    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;
    this.t = 0;
    this._btn = null;          /* end-turn button bounds */
    this._sndBtn = null;       /* sound toggle button bounds */
  }

  tick() { this.t++; }
  get endTurnBtn() { return this._btn; }
  get soundBtn()   { return this._sndBtn; }

  /* ═══════════ MAIN DRAW ═══════════ */
  draw(g) {
    const c = this.cx;
    c.clearRect(0, 0, CANVAS_W, CANVAS_H);

    if (g.state === S_TITLE)   { this._title(); this._soundToggle(CANVAS_W - SIDEBAR_W, CANVAS_H - 40, SIDEBAR_W); return; }
    if (g.state === S_VICTORY) { this._victoryScreen(g); return; }

    this._map(g.map);

    /* transition overlays — skip normal highlights/units */
    if (g.state === S_TRANS_OUT || g.state === S_TRANS_IN) {
      this._transOverlay(g);
      this._sidebar(g);
      return;
    }

    this._highlights(g);
    this._units(g);

    this._cursor(g);
    this._sidebar(g);
    if (g.state === S_ACTION_MENU) this._menu(g);
    if (g.state === S_ATK_SELECT) this._atkPrompt();
    this._tutBanner(g);
    if (g.state === S_WIN || g.state === S_LOSE) this._overlay(g);
  }

  /* ═══════════ TITLE ═══════════ */
  _title() {
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
    c.fillText('ROGUELIKE TACTICS RPG', mx, my - 72);

    /* menu buttons */
    const bw = 200, bh = 32, gap = 10;
    const bx = mx - bw / 2;
    const by0 = my + 72;
    const by1 = by0 + bh + gap;
    const by2 = by1 + bh + gap;
    const by3 = by2 + bh + gap;

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
                     : `FLOOR ${g.floor}`;
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

    /* terrain */
    if (g.cur) y = this._terrainPanel(g, px, y, sw - 20);

    /* combat preview */
    if (g.preview) this._combatPreview(g.preview, sx, y, sw);

    /* end-turn button */
    if (g.phase === 'player') this._endBtn(sx, sh - 50, sw);

    /* sound toggle */
    this._soundToggle(sx, sh - 90, sw);
  }

  _unitAt(g, cur) {
    if (!cur) return null;
    return [...g.players, ...g.enemies].find(u => u.alive && u.x === cur.x && u.y === cur.y) || null;
  }

  _unitPanel(u, x, y, w) {
    const c = this.cx;
    c.fillStyle = u.isPlayer ? '#1a1a50' : '#501a1a';
    c.fillRect(x-4, y, w+8, 178);
    c.strokeStyle = u.isPlayer ? '#3030a0' : '#a03030';
    c.lineWidth = 1; c.strokeRect(x-4, y, w+8, 178);

    y += 12;
    c.fillStyle = C.GOLD; c.font = `9px ${FONT}`; c.textAlign = 'left';
    c.fillText(u.name, x, y); y += 14;
    c.fillStyle = C.TXT; c.font = `7px ${FONT}`;
    c.fillText(`Lv.${u.level}  ${u.weapon.name}`, x, y); y += 14;

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
    return y + 72;
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
    /* place below terrain panel area, roughly mid-sidebar */
    const my = 340;

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

  _endBtn(sx, y, sw) {
    const c = this.cx, bx = sx + 10, bw = sw - 20, bh = 36;
    c.fillStyle = '#103040'; c.fillRect(bx, y, bw, bh);
    c.strokeStyle = '#20a0c0'; c.lineWidth = 2; c.strokeRect(bx, y, bw, bh);
    c.fillStyle = '#40d0f0'; c.font = `9px ${FONT}`; c.textAlign = 'center';
    c.fillText('END TURN', sx + sw / 2, y + 22);
    this._btn = { x: bx, y, w: bw, h: bh };
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
      c.fillText(g.floor === 0 ? 'TUTORIAL' : `FLOOR ${g.floor}`, mx, CANVAS_H / 2 + 5);
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
                : `Floor ${g.floor} cleared!`;
      c.fillText(sub, mx, my + 10);
      c.fillText('Click to continue...', mx, my + 40);
    } else {
      c.fillStyle = '#ff2020'; c.font = `22px ${FONT}`; c.fillText('GAME OVER', mx, my - 30);
      c.fillStyle = C.TXT;    c.font = `10px ${FONT}`; c.fillText('Your Lord has fallen!', mx, my + 10);
      c.fillText('Click to restart...', mx, my + 40);
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
    c.fillText(`Floors conquered: ${FINAL_FLOOR}`, mx, 190);

    /* prompt */
    if (Math.floor(t / 40) % 2 === 0) {
      c.fillStyle = '#a0a0a0';
      c.font = `8px ${FONT}`;
      c.fillText('Click to return to title...', mx, CANVAS_H - 16);
    }
  }
}
