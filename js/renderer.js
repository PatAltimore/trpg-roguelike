import {
  TILE, COLS, ROWS, SIDEBAR_W, CANVAS_W, CANVAS_H, C,
  T_PLAIN, T_FOREST, T_MOUNTAIN, T_WATER, T_WALL, T_ROAD, T_FORT,
  S_TITLE, S_ACTION_MENU, S_WIN, S_LOSE, S_ATK_SELECT,
} from './constants.js';
import { forecast, canCounter } from './combat.js';

const FONT = '"Press Start 2P", monospace';

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.cx = canvas.getContext('2d');
    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;
    this.t = 0;
    this._btn = null;          /* end-turn button bounds */
  }

  tick() { this.t++; }
  get endTurnBtn() { return this._btn; }

  /* ═══════════ MAIN DRAW ═══════════ */
  draw(g) {
    const c = this.cx;
    c.clearRect(0, 0, CANVAS_W, CANVAS_H);

    if (g.state === S_TITLE) { this._title(); return; }

    this._map(g.map);
    this._highlights(g);
    this._units(g);
    this._cursor(g);
    this._sidebar(g);
    if (g.state === S_ACTION_MENU) this._menu(g);
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
    c.textAlign = 'center';

    c.fillStyle = C.GOLD;
    c.font = `24px ${FONT}`;
    c.fillText('EMBLEM TACTICS', mx, my - 70);

    c.fillStyle = '#5050cc';
    c.font = `10px ${FONT}`;
    c.fillText('ROGUELIKE TACTICS RPG', mx, my - 40);

    if (Math.floor(this.t / 30) % 2 === 0) {
      c.fillStyle = C.TXT;
      c.font = `10px ${FONT}`;
      c.fillText('CLICK TO START', mx, my + 20);
    }

    c.fillStyle = '#606060';
    c.font = `7px ${FONT}`;
    c.fillText('Select unit \u2192 click destination \u2192 Attack / Wait', mx, my + 70);
    c.fillText('Defeat all enemies to advance.  Lord dies = Game Over.', mx, my + 90);
    c.fillText('Weapon triangle: Sword > Axe > Lance > Sword', mx, my + 110);
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
             SOLDIER:'#804040', BRIGAND:'#604020', DARK_MAGE:'#300060', E_ARCHER:'#604040' }[k] || '#888';
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
    const floorLabel = g.floor === 1 ? 'TUTORIAL' : `FLOOR ${g.floor}`;
    c.fillText(floorLabel, px, y); y += 20;
    /* floor theme subtitle */
    if (g.map && g.map._floorTheme) {
      c.fillStyle = '#707090'; c.font = `6px ${FONT}`;
      const names = { forest:'Forest Skirmish', fortress:'Fortress Siege', gauntlet:'The Gauntlet', open_field:'Open Field', mixed:'War Zone' };
      c.fillText(names[g.map._floorTheme] || '', px, y); y += 12;
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
    const itemH = 36, pad = 14;
    const mw = 150, mh = g.menuOpts.length * itemH + pad * 2;

    /* position menu offset from unit so it doesn't cover the tile */
    let mx = (g.menuPos.x + 1) * TILE + 4;
    let my = g.menuPos.y * TILE - 10;
    if (mx + mw > COLS * TILE) mx = (g.menuPos.x - 1) * TILE - mw + TILE - 4;
    if (my + mh > ROWS * TILE) my = ROWS * TILE - mh;
    if (my < 0) my = 0;

    /* semi-transparent background */
    c.fillStyle = 'rgba(8,8,24,0.92)'; c.fillRect(mx, my, mw, mh);
    c.strokeStyle = '#5050d0'; c.lineWidth = 2; c.strokeRect(mx, my, mw, mh);

    g.menuOpts.forEach((opt, i) => {
      const oy = my + pad + i * itemH;
      /* hover highlight for the item under cursor */
      if (i === g.menuIdx) {
        c.fillStyle = '#303090'; c.fillRect(mx + 3, oy - 4, mw - 6, itemH - 4);
      }
      c.fillStyle = opt.on ? '#ffffff' : '#404050';
      c.font = `10px ${FONT}`; c.textAlign = 'left';
      c.fillText(opt.label, mx + 14, oy + 16);
    });

    /* store bounds for click detection */
    g._menuBounds = { x: mx, y: my, w: mw, h: mh };
  }

  _endBtn(sx, y, sw) {
    const c = this.cx, bx = sx + 10, bw = sw - 20, bh = 36;
    c.fillStyle = '#103040'; c.fillRect(bx, y, bw, bh);
    c.strokeStyle = '#20a0c0'; c.lineWidth = 2; c.strokeRect(bx, y, bw, bh);
    c.fillStyle = '#40d0f0'; c.font = `9px ${FONT}`; c.textAlign = 'center';
    c.fillText('END TURN', sx + sw / 2, y + 22);
    this._btn = { x: bx, y, w: bw, h: bh };
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

  _overlay(g) {
    const c = this.cx;
    c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(0, 0, CANVAS_W, CANVAS_H);
    const mx = CANVAS_W / 2, my = CANVAS_H / 2;
    c.textAlign = 'center';

    if (g.state === S_WIN) {
      c.fillStyle = C.GOLD; c.font = `22px ${FONT}`;
      c.fillText(g.floor === 1 ? 'TUTORIAL CLEAR!' : 'VICTORY!', mx, my - 30);
      c.fillStyle = C.TXT;  c.font = `10px ${FONT}`;
      c.fillText(g.floor === 1 ? 'You learned the basics!' : `Floor ${g.floor} cleared!`, mx, my + 10);
      c.fillText('Click to continue...', mx, my + 40);
    } else {
      c.fillStyle = '#ff2020'; c.font = `22px ${FONT}`; c.fillText('GAME OVER', mx, my - 30);
      c.fillStyle = C.TXT;    c.font = `10px ${FONT}`; c.fillText('Your Lord has fallen!', mx, my + 10);
      c.fillText('Click to restart...', mx, my + 40);
    }
  }
}
