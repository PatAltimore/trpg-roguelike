import {
  TILE, COLS, ROWS, CANVAS_W, CANVAS_H,
  S_TITLE, S_IDLE, S_UNIT_SEL, S_ACTION_MENU, S_ATK_SELECT,
  S_COMBAT_ANIM, S_ENEMY_TURN, S_WIN, S_LOSE,
} from './constants.js';
import { GameMap, reachable }    from './map.js';
import { spawnParty, spawnEnemies } from './units.js';
import { resolve, forecast, canCounter, inRange } from './combat.js';
import { planEnemyTurn }         from './ai.js';
import { Renderer }              from './renderer.js';

class Game {
  constructor() {
    this.cv   = document.getElementById('gameCanvas');
    this.ren  = new Renderer(this.cv);
    this.state = S_TITLE;
    this.phase = 'player';
    this.floor = 1;
    this.turn  = 1;

    this.map     = null;
    this.players = [];
    this.enemies = [];

    /* selection state */
    this.sel       = null;      /* selected unit */
    this.moveRange = null;
    this.atkRange  = null;
    this.preview   = null;      /* combat forecast */
    this.cur       = { x: 0, y: 0 };

    /* action menu */
    this.menuPos  = null;
    this.menuOpts = [];
    this.menuIdx  = 0;
    this._menuBounds = null;
    this._prevPos = null;       /* position before move (for undo) */

    /* enemy turn queue */
    this._eActions = null;
    this._eIdx     = 0;
    this._eTimer   = 0;

    /* combat animation */
    this._combatLog = [];
    this._combatIdx = 0;
    this._combatTimer = 0;

    this.cv.addEventListener('click',     e => this._click(e));
    this.cv.addEventListener('mousemove', e => this._hover(e));
    this._loop();
  }

  /* ═══════════ LOOP ═══════════ */
  _loop() {
    this.ren.tick();
    this._update();
    this.ren.draw(this);
    requestAnimationFrame(() => this._loop());
  }

  _update() {
    if (this.state === S_ENEMY_TURN) this._stepEnemy();
    if (this.state === S_COMBAT_ANIM) this._stepCombatAnim();
  }

  /* ═══════════ LEVEL SETUP ═══════════ */
  _startLevel() {
    this.map = new GameMap(this.floor);

    /* party persists across floors if alive */
    const alive = this.players.filter(p => p.alive);
    this.players = spawnParty(this.map.playerSpawns, this.floor, alive.length ? alive : null);
    this.enemies = spawnEnemies(this.map.enemySpawns, this.floor);

    this.state = S_IDLE;
    this.phase = 'player';
    this.turn  = 1;
    this._deselect();
    if (this.map.playerSpawns[0]) this.cur = { ...this.map.playerSpawns[0] };
  }

  /* ═══════════ INPUT ═══════════ */
  _px(e) {
    const r = this.cv.getBoundingClientRect();
    return { px: (e.clientX - r.left) * (CANVAS_W / r.width),
             py: (e.clientY - r.top)  * (CANVAS_H / r.height) };
  }

  _hover(e) {
    const { px, py } = this._px(e);
    const cx = Math.floor(px / TILE), cy = Math.floor(py / TILE);
    if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) {
      this.cur = { x: cx, y: cy };
      if (this.state === S_ATK_SELECT && this.sel) this._updatePreview(cx, cy);
    }
  }

  _click(e) {
    const { px, py } = this._px(e);
    const cx = Math.floor(px / TILE), cy = Math.floor(py / TILE);
    const mapW = COLS * TILE;

    /* title */
    if (this.state === S_TITLE)  { this._startLevel(); return; }
    /* win / lose */
    if (this.state === S_WIN)    { this.floor++; this._startLevel(); return; }
    if (this.state === S_LOSE)   { this.floor = 1; this.players = []; this._startLevel(); return; }
    /* enemy turn – ignore */
    if (this.state === S_ENEMY_TURN || this.state === S_COMBAT_ANIM) return;

    /* end-turn button */
    if (px >= mapW && this.phase === 'player') {
      const b = this.ren.endTurnBtn;
      if (b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) { this._endPlayerTurn(); return; }
    }

    /* out of map */
    if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return;

    switch (this.state) {
      case S_IDLE:        this._clickIdle(cx, cy);      break;
      case S_UNIT_SEL:    this._clickSelected(cx, cy);   break;
      case S_ACTION_MENU: this._clickMenu(px, py);       break;
      case S_ATK_SELECT:  this._clickAtkSelect(cx, cy);  break;
    }
  }

  /* ── idle: pick a player unit ── */
  _clickIdle(cx, cy) {
    const u = this._playerAt(cx, cy);
    if (u && !u.done) this._select(u);
  }

  /* ── unit selected: pick move destination ── */
  _clickSelected(cx, cy) {
    /* re-select different unit */
    const other = this._playerAt(cx, cy);
    if (other && other !== this.sel && !other.done) { this._select(other); return; }

    /* click in move range? */
    if (!this.moveRange || !this.moveRange.some(t => t.x === cx && t.y === cy)) {
      this._deselect(); return;
    }
    /* can't land on enemy */
    if (this._enemyAt(cx, cy)) return;

    /* move */
    this._prevPos = { x: this.sel.x, y: this.sel.y };
    this.sel.x = cx; this.sel.y = cy; this.sel.moved = true;
    this._showActionMenu();
  }

  /* ── action menu click ── */
  _clickMenu(px, py) {
    const b = this._menuBounds;
    if (!b || px < b.x || px > b.x + b.w || py < b.y || py > b.y + b.h) return;

    const idx = Math.floor((py - b.y - 10) / 28);
    if (idx < 0 || idx >= this.menuOpts.length) return;
    const opt = this.menuOpts[idx];
    if (!opt.on) return;

    if (opt.action === 'attack') {
      this.state = S_ATK_SELECT;
      this.atkRange = this._atkTiles(this.sel);
      this.moveRange = null;
      this.preview = null;
    } else if (opt.action === 'wait') {
      this.sel.acted = true;
      this._deselect();
      this._checkEnd();
    } else if (opt.action === 'back') {
      this.sel.x = this._prevPos.x;
      this.sel.y = this._prevPos.y;
      this.sel.moved = false;
      this._select(this.sel);
    }
  }

  /* ── attack target select ── */
  _clickAtkSelect(cx, cy) {
    const tgt = this._enemyAt(cx, cy);
    if (!tgt || !inRange(this.sel, cx, cy)) {
      /* cancel back to action menu */
      this._showActionMenu();
      return;
    }
    this._doCombat(this.sel, tgt);
  }

  /* ═══════════ COMBAT ═══════════ */
  _doCombat(atk, def) {
    const at = this.map.at(atk.x, atk.y);
    const dt = this.map.at(def.x, def.y);
    this._combatLog = resolve(atk, def, at, dt);
    this._combatIdx = 0;
    this._combatTimer = 0;
    this.state = S_COMBAT_ANIM;
    this.preview = null;
  }

  _stepCombatAnim() {
    this._combatTimer++;
    if (this._combatTimer < 30) return; /* brief pause per hit */
    this._combatTimer = 0;
    this._combatIdx++;
    if (this._combatIdx >= this._combatLog.length) {
      /* done */
      if (this.sel) this.sel.acted = true;
      this.enemies = this.enemies.filter(e => e.alive);
      this.players = this.players.filter(p => p.alive);
      this._deselect();
      this._checkEnd();
    }
  }

  /* ═══════════ ENEMY TURN ═══════════ */
  _endPlayerTurn() {
    this.players.forEach(p => p.reset());
    this._deselect();
    this.phase = 'enemy';
    this.state = S_ENEMY_TURN;
    this._eActions = null;
    this._eIdx = 0;
    this._eTimer = 0;
  }

  _stepEnemy() {
    if (!this._eActions) {
      this._eActions = planEnemyTurn(this.enemies, this.players, this.map);
      this._eIdx = 0; this._eTimer = 0;
    }
    this._eTimer++;
    if (this._eTimer < 40) return;
    this._eTimer = 0;

    if (this._eIdx >= this._eActions.length) { this._startPlayerTurn(); return; }

    const a = this._eActions[this._eIdx++];
    if (!a.unit.alive) return;

    /* move */
    if (a.mx !== undefined) { a.unit.x = a.mx; a.unit.y = a.my; }

    /* attack */
    if ((a.type === 'attack' || a.type === 'move_attack') && a.target && a.target.alive) {
      if (inRange(a.unit, a.target.x, a.target.y)) {
        const at = this.map.at(a.unit.x, a.unit.y);
        const dt = this.map.at(a.target.x, a.target.y);
        resolve(a.unit, a.target, at, dt);
        this.enemies = this.enemies.filter(e => e.alive);
        this.players = this.players.filter(p => p.alive);
        this._checkEnd();
      }
    }
  }

  _startPlayerTurn() {
    this.turn++;
    this.phase = 'player';
    this.state = S_IDLE;
    this._eActions = null;

    /* fort healing */
    for (const u of [...this.players, ...this.enemies]) {
      if (!u.alive) continue;
      const t = this.map.at(u.x, u.y);
      if (t.heal) u.hp = Math.min(u.maxHp, u.hp + Math.max(1, Math.floor(u.maxHp * t.heal / 100)));
    }
    this.enemies.forEach(e => e.reset());
  }

  /* ═══════════ HELPERS ═══════════ */
  _select(u) {
    this.sel = u;
    this.moveRange = reachable(u, this.map, [...this.players, ...this.enemies]);
    this.atkRange = null;
    this.preview = null;
    this.state = S_UNIT_SEL;
  }

  _deselect() {
    this.sel = null; this.moveRange = null; this.atkRange = null; this.preview = null;
    if (this.state !== S_WIN && this.state !== S_LOSE && this.state !== S_ENEMY_TURN && this.state !== S_COMBAT_ANIM)
      this.state = S_IDLE;
  }

  _showActionMenu() {
    const u = this.sel;
    const targets = this.enemies.filter(e => e.alive && inRange(u, e.x, e.y));
    this.menuPos = { x: u.x, y: u.y };
    this.menuOpts = [
      { label: 'ATTACK', action: 'attack', on: targets.length > 0 },
      { label: 'WAIT',   action: 'wait',   on: true },
      { label: 'BACK',   action: 'back',   on: true },
    ];
    this.menuIdx = 0;
    this.state = S_ACTION_MENU;
    this.atkRange = this._atkTiles(u);
  }

  _atkTiles(u) {
    const out = [];
    const [lo, hi] = u.weapon.rng;
    for (let r = 0; r < ROWS; r++)
      for (let cl = 0; cl < COLS; cl++) {
        const d = Math.abs(u.x - cl) + Math.abs(u.y - r);
        if (d >= lo && d <= hi) out.push({ x: cl, y: r });
      }
    return out;
  }

  _updatePreview(cx, cy) {
    const tgt = this._enemyAt(cx, cy);
    if (tgt && inRange(this.sel, cx, cy)) {
      const dt = this.map.at(tgt.x, tgt.y);
      const at = this.map.at(this.sel.x, this.sel.y);
      const af = forecast(this.sel, tgt, dt);
      const df = canCounter(this.sel, tgt) ? forecast(tgt, this.sel, at) : null;
      this.preview = { atk: this.sel, def: tgt, af, df };
    } else {
      this.preview = null;
    }
  }

  _checkEnd() {
    const lord = this.players.find(p => p.key === 'LORD');
    if (!lord || !lord.alive) { this.state = S_LOSE; return; }
    if (!this.enemies.some(e => e.alive)) { this.state = S_WIN; return; }
  }

  _playerAt(x, y) { return this.players.find(u => u.alive && u.x === x && u.y === y); }
  _enemyAt(x, y)  { return this.enemies.find(u => u.alive && u.x === x && u.y === y); }
}

/* boot */
new Game();
