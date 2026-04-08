import {
  TILE, COLS, ROWS, CANVAS_W, CANVAS_H,
  S_TITLE, S_IDLE, S_UNIT_SEL, S_ACTION_MENU, S_ATK_SELECT,
  S_COMBAT_ANIM, S_ENEMY_TURN, S_WIN, S_LOSE,
  S_TRANS_OUT, S_TRANS_IN, S_VICTORY, S_DRAFT, S_BONUS, FINAL_FLOOR,
} from './constants.js';
import { GameMap, reachable }    from './map.js';
import { spawnParty, spawnEnemies, DRAFT_POOL, CLASS_INFO, Unit } from './units.js';
import { resolve, forecast, canCounter, inRange } from './combat.js';
import { planEnemyTurn }         from './ai.js';
import { Renderer }              from './renderer.js';
import { SFX, isMuted, toggleMute } from './audio.js';
import { TouchController } from './touch.js';

/* ═══════════ Tutorial messages ═══════════
   Each fires once, triggered by game events.
   Teaches through play — prompts appear at the moment
   the player needs the information, not before. */
const TUT = {
  start:     'Click a blue unit to select it.',
  selected:  'Blue tiles = move range. Click one to move!',
  moved:     'Choose ATTACK if an enemy is nearby, or WAIT.',
  atk_mode:  'Hover enemies to see the Combat Forecast!',
  first_kill:'Sword beats Axe! Axe beats Lance! Lance beats Sword!',
  terrain:   'Forests: DEF+1 AVO+15. Stand on them for cover!',
  fort:      'Forts: DEF+2 AVO+20 and heal 10% HP each turn!',
  end_turn:  'All units done? Click END TURN on the right.',
  enemy_go:  'Enemy phase! They follow the same combat rules.',
  ranged:    'Archers: range 2. Mages: range 1-2. Use them wisely!',
};

class Game {
  constructor() {
    this.cv   = document.getElementById('gameCanvas');
    this.ren  = new Renderer(this.cv);
    this.state = S_TITLE;
    this.phase = 'player';
    this.floor = 0;
    this.turn  = 1;
    this.difficulty = 'easy';  // 'easy', 'medium', 'hard'

    this.map     = null;
    this.players = [];
    this.enemies = [];

    /* selection state */
    this.sel       = null;
    this.moveRange = null;
    this.atkRange  = null;
    this.preview   = null;
    this.cur       = { x: 0, y: 0 };
    this._inspecting = false;

    /* action menu */
    this.menuPos  = null;
    this.menuOpts = [];
    this.menuIdx  = 0;
    this._menuBounds = null;
    this._prevPos = null;

    /* team draft */
    this.roster    = null;   // ['LORD','FIGHTER',...] chosen classes
    this._draftPool = [];    // available picks
    this._draftSel  = 0;    // cursor index
    this._draftPicks = [];   // currently picked classes

    /* post-floor bonus */
    this._bonusOpts = [];    // [{label, desc, action}]
    this._bonusSel  = 0;

    /* enemy turn queue */
    this._eActions = null;
    this._eIdx     = 0;
    this._eTimer   = 0;

    /* combat animation */
    this._combatLog = [];
    this._combatIdx = 0;
    this._enemyCombatPending = false;
    this._combatTimer = 0;
    this._healMode = false;

    /* tutorial */
    this.tut = null;

    /* level transition animation */
    this.trans = null;   // { walkers, path, step, total, dir }

    this.cv.addEventListener('click',       e => this._click(e));
    this.cv.addEventListener('contextmenu', e => { e.preventDefault(); this._cancel(); });
    this.cv.addEventListener('mousemove',   e => this._hover(e));
    document.addEventListener('keydown',    e => { if (e.key === 'Escape') this._cancel(); });

    /* mobile touch support — pinch-zoom, pan, tap-to-play */
    this.touch = new TouchController(this.cv, this);
    this._loop();
  }

  /* ═══════════ TUTORIAL ═══════════ */
  _tutInit() {
    this.tut = { shown: new Set(), msg: '', timer: 0 };
  }
  _tutShow(key) {
    if (!this.tut || this.tut.shown.has(key)) return;
    this.tut.shown.add(key);
    this.tut.msg = TUT[key] || '';
    this.tut.timer = 300; // ~5 sec at 60fps
  }
  _tutTick() {
    if (this.tut && this.tut.timer > 0) this.tut.timer--;
  }

  /* ═══════════ LOOP ═══════════ */
  _loop() {
    this.ren.tick();
    this._update();
    this.ren.draw(this);
    requestAnimationFrame(() => this._loop());
  }

  _update() {
    this._tutTick();
    if (this.state === S_TRANS_OUT || this.state === S_TRANS_IN) { this._stepTransition(); return; }
    if (this.state === S_ENEMY_TURN) this._stepEnemy();
    if (this.state === S_COMBAT_ANIM) this._stepCombatAnim();

    /* tutorial: detect when all player units are done */
    if (this.tut && this.state === S_IDLE && this.phase === 'player') {
      if (this.players.every(p => p.done)) this._tutShow('end_turn');
    }
  }

  /* ═══════════ LEVEL SETUP ═══════════ */
  _startLevel() {
    this.map = new GameMap(this.floor);

    const existing = this.players.length > 0 ? this.players.filter(p => p.alive) : null;
    this.players = spawnParty(this.map.playerSpawns, this.floor, existing, this.difficulty, this.roster);
    this.enemies = spawnEnemies(this.map.enemySpawns, this.floor, this.difficulty);

    this.state = S_IDLE;
    this.phase = 'player';
    this.turn  = 1;
    this._deselect();
    if (this.map.playerSpawns[0]) this.cur = { ...this.map.playerSpawns[0] };

    /* start tutorial on floor 1 */
    if (this.floor === 0) {
      this._tutInit();
      this._tutShow('start');
    } else {
      this.tut = null;
    }
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

      /* tutorial: terrain tips when hovering relevant tiles */
      if (this.tut) {
        const t = this.map.at(cx, cy);
        if (t.def > 0 && t.heal)  this._tutShow('fort');
        else if (t.def > 0)       this._tutShow('terrain');
      }
    }
  }

  _click(e) {
    const { px, py } = this._px(e);
    const cx = Math.floor(px / TILE), cy = Math.floor(py / TILE);
    const mapW = COLS * TILE;

    /* sound toggle — always available */
    const sb = this.ren.soundBtn;
    if (sb && px >= sb.x && px <= sb.x + sb.w && py >= sb.y && py <= sb.y + sb.h) { toggleMute(); return; }

    if (this.state === S_TITLE) {
      const btns = this.ren._titleBtns;
      if (btns) {
        const hit = (b) => b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
        if (hit(btns.tutorial)) {
          SFX.titleMelody(); this.difficulty = 'easy'; this.floor = 0;
          this.roster = ['LORD','FIGHTER','MAGE','ARCHER']; this._startLevel(); return;
        }
        if (hit(btns.easy)) {
          SFX.titleMelody(); this.difficulty = 'easy'; this.floor = 1; this._beginDraft(); return;
        }
        if (hit(btns.medium)) {
          SFX.titleMelody(); this.difficulty = 'medium'; this.floor = 1; this._beginDraft(); return;
        }
        if (hit(btns.hard)) {
          SFX.titleMelody(); this.difficulty = 'hard'; this.floor = 1; this._beginDraft(); return;
        }
      }
      return;
    }
    if (this.state === S_WIN) {
      if (this.floor >= FINAL_FLOOR) { this.state = S_VICTORY; SFX.victoryMelody(); return; }
      this._beginBonus(); return;
    }
    if (this.state === S_BONUS) { this._clickBonus(px, py); return; }
    if (this.state === S_DRAFT) { this._clickDraft(px, py); return; }
    if (this.state === S_VICTORY) { this.floor = 0; this.state = S_TITLE; this.roster = null; return; }
    if (this.state === S_LOSE)    { this.floor = 0; this.players = []; this.roster = null; this._startLevel(); return; }
    if (this.state === S_ENEMY_TURN || this.state === S_COMBAT_ANIM ||
        this.state === S_TRANS_OUT || this.state === S_TRANS_IN) return;

    /* action menu — clicking outside the menu cancels (undo move) */
    if (this.state === S_ACTION_MENU) {
      const b = this._menuBounds;
      if (b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
        this._clickMenu(px, py);
      } else {
        this._cancel();
      }
      return;
    }

    /* attack select — clicking outside the map cancels back to menu */
    if (this.state === S_ATK_SELECT) {
      if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) { this._cancel(); return; }
      this._clickAtkSelect(cx, cy);
      return;
    }

    /* end-turn button (only in idle / unit-select, not during action menu or atk select) */
    if (px >= mapW && this.phase === 'player') {
      const b = this.ren.endTurnBtn;
      if (b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) { this._endPlayerTurn(); return; }
    }

    if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return;

    switch (this.state) {
      case S_IDLE:        this._clickIdle(cx, cy);      break;
      case S_UNIT_SEL:    this._clickSelected(cx, cy);   break;
    }
  }

  /* ── idle ── */
  _clickIdle(cx, cy) {
    /* clicking a friendly unit selects it */
    const u = this._playerAt(cx, cy);
    if (u && !u.done) { SFX.select(); this._select(u); return; }
    /* clicking an enemy shows its threat range */
    const e = this._enemyAt(cx, cy);
    if (e) { SFX.select(); this._inspectEnemy(e); return; }
    /* clicking empty clears any inspection */
    if (this._inspecting) this._deselect();
  }

  /* ── unit selected ── */
  _clickSelected(cx, cy) {
    const other = this._playerAt(cx, cy);
    if (other && other !== this.sel && !other.done) { SFX.select(); this._select(other); return; }

    if (!this.moveRange || !this.moveRange.some(t => t.x === cx && t.y === cy)) {
      this._deselect(); return;
    }
    if (this._enemyAt(cx, cy)) return;

    this._prevPos = { x: this.sel.x, y: this.sel.y };
    this.sel.x = cx; this.sel.y = cy; this.sel.moved = true;
    SFX.move();
    this._showActionMenu();
    this._tutShow('moved');
  }

  /* ── action menu ── */
  _clickMenu(px, py) {
    const b = this._menuBounds;
    if (!b || px < b.x || px > b.x + b.w || py < b.y || py > b.y + b.h) return;

    const idx = Math.floor((py - b.y - 20) / 40);
    if (idx < 0 || idx >= this.menuOpts.length) return;
    const opt = this.menuOpts[idx];
    if (!opt.on) return;

    if (opt.action === 'attack') {
      SFX.menuSelect();
      this.state = S_ATK_SELECT;
      this._healMode = false;
      this.atkRange = this._atkTiles(this.sel);
      this.moveRange = null;
      this.preview = null;
      this._tutShow('atk_mode');
    } else if (opt.action === 'heal') {
      SFX.menuSelect();
      this.state = S_ATK_SELECT;
      this._healMode = true;
      this.atkRange = this._atkTiles(this.sel);
      this.moveRange = null;
      this.preview = null;
    } else if (opt.action === 'wait') {
      SFX.menuSelect();
      this.sel.acted = true;
      this._deselect();
      this._checkEnd();
    } else if (opt.action === 'back') {
      SFX.menuBack();
      this.sel.x = this._prevPos.x;
      this.sel.y = this._prevPos.y;
      this.sel.moved = false;
      this._select(this.sel);
    }
  }

  /* ── attack / heal target ── */
  _clickAtkSelect(cx, cy) {
    if (this._healMode) {
      const tgt = this._playerAt(cx, cy);
      if (!tgt || tgt === this.sel || tgt.hp >= tgt.maxHp || !inRange(this.sel, cx, cy)) {
        this._showActionMenu(); return;
      }
      /* perform heal */
      const healAmt = this.sel.mag + this.sel.weapon.mt + 10;
      tgt.hp = Math.min(tgt.maxHp, tgt.hp + healAmt);
      SFX.hit(); // heal sound
      this.sel.acted = true;
      this._healMode = false;
      this._deselect();
      this._checkEnd();
      return;
    }
    const tgt = this._enemyAt(cx, cy);
    if (!tgt || !inRange(this.sel, cx, cy)) {
      this._showActionMenu();
      return;
    }
    this._doCombat(this.sel, tgt);
  }

  /* ── cancel (right-click / Escape) ── */
  _cancel() {
    if (this.state === S_ENEMY_TURN || this.state === S_COMBAT_ANIM ||
        this.state === S_WIN || this.state === S_LOSE || this.state === S_TITLE ||
        this.state === S_TRANS_OUT || this.state === S_TRANS_IN ||
        this.state === S_VICTORY) return;

    SFX.menuBack();
    if (this.state === S_ATK_SELECT) {
      /* back to action menu */
      this._showActionMenu();
    } else if (this.state === S_ACTION_MENU) {
      /* undo move, back to unit selected */
      if (this.sel && this._prevPos) {
        this.sel.x = this._prevPos.x;
        this.sel.y = this._prevPos.y;
        this.sel.moved = false;
        this._select(this.sel);
      } else {
        this._deselect();
      }
    } else if (this.state === S_UNIT_SEL) {
      /* deselect unit */
      this._deselect();
    }
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
    /* play sound at the start of each strike */
    if (this._combatTimer === 1 && this._combatIdx < this._combatLog.length) {
      const entry = this._combatLog[this._combatIdx];
      if (!entry.hit) SFX.miss();
      else if (entry.crit) SFX.crit();
      else SFX.hit();
    }
    if (this._combatTimer < 30) return;
    this._combatTimer = 0;
    this._combatIdx++;
    if (this._combatIdx >= this._combatLog.length) {
      if (this.sel) this.sel.acted = true;
      const hadEnemies = this.enemies.length;
      const hadPlayers = this.players.length;
      this.enemies = this.enemies.filter(e => e.alive);
      this.players = this.players.filter(p => p.alive);
      /* sound for kills */
      if (this.enemies.length < hadEnemies || this.players.length < hadPlayers) SFX.kill();
      /* tutorial: first kill tip */
      if (this.tut && this.enemies.length < hadEnemies) this._tutShow('first_kill');

      if (this._enemyCombatPending) {
        /* resume enemy turn after enemy-initiated combat */
        this._enemyCombatPending = false;
        this.state = S_ENEMY_TURN;
        this._eTimer = 0;
        this._deselect();
        this._checkEnd();
      } else {
        /* player-initiated combat — return to idle */
        this.state = S_IDLE;
        this._deselect();
        this._checkEnd();
      }
    }
  }

  /* ═══════════ ENEMY TURN ═══════════ */
  _endPlayerTurn() {
    SFX.turnEnd();
    this.players.forEach(p => p.reset());
    this._deselect();
    this.phase = 'enemy';
    this.state = S_ENEMY_TURN;
    this._eActions = null;
    this._eIdx = 0;
    this._eTimer = 0;
    this._tutShow('enemy_go');
    setTimeout(() => SFX.enemyPhase(), 300);
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

    if (a.mx !== undefined) {
      /* prevent two enemies from occupying the same tile */
      const blocker = this.enemies.find(e => e !== a.unit && e.alive && e.x === a.mx && e.y === a.my)
                   || this.players.find(p => p.alive && p.x === a.mx && p.y === a.my);
      if (!blocker) {
        a.unit.x = a.mx; a.unit.y = a.my;
      }
      /* if blocked, skip the move but still try to attack from current position */
    }

    if ((a.type === 'attack' || a.type === 'move_attack') && a.target && a.target.alive) {
      if (inRange(a.unit, a.target.x, a.target.y)) {
        /* use the same combat animation as player attacks */
        this._enemyCombatPending = true;
        this._doCombat(a.unit, a.target);
      }
    }
  }

  _startPlayerTurn() {
    this.turn++;
    this.phase = 'player';
    this.state = S_IDLE;
    this._eActions = null;
    SFX.playerPhase();

    for (const u of [...this.players, ...this.enemies]) {
      if (!u.alive) continue;
      const t = this.map.at(u.x, u.y);
      if (t.heal) u.hp = Math.min(u.maxHp, u.hp + Math.max(1, Math.floor(u.maxHp * t.heal / 100)));
    }
    this.enemies.forEach(e => e.reset());
  }

  /* ═══════════ LEVEL TRANSITION ═══════════ */

  _beginTransitionOut() {
    const alive = this.players.filter(p => p.alive);
    if (!alive.length) { this.floor++; this._startLevel(); return; }

    /* Sort so rightmost units lead the march */
    alive.sort((a, b) => b.x - a.x);

    /* Pick a rally row — use the average y of alive units */
    const rallyY = Math.round(alive.reduce((s, u) => s + u.y, 0) / alive.length);

    /* Each walker has its own path: walk to rally row, then march right off-screen */
    const walkers = alive.map((u, i) => {
      const path = [];
      /* Phase 1: walk vertically to the rally row */
      let y = u.y;
      while (y !== rallyY) { path.push({ x: u.x, y }); y += y < rallyY ? 1 : -1; }
      /* Phase 2: march right off the screen */
      for (let x = u.x; x <= COLS + 2; x++) path.push({ x, y: rallyY });
      return { unit: u, path, pathIdx: 0, delay: i * 12 };
    });

    this.trans = { walkers, step: 0, speed: 8, dir: 'out' };
    this.state = S_TRANS_OUT;
    this._deselect();
    SFX.transitionMelody();
  }

  _beginTransitionIn() {
    const alive = this.players.filter(p => p.alive);
    const spawns = this.map.playerSpawns;
    if (!alive.length) { this.state = S_IDLE; return; }

    /* Each walker has its own path: enter from the left, walk to their spawn */
    const walkers = alive.map((u, i) => {
      const sp = spawns[i % spawns.length];
      const path = [];
      const startX = -3 - i;  /* stagger off-screen start */
      const entryY = sp.y;
      /* Phase 1: march right to the spawn column */
      for (let x = startX; x <= sp.x; x++) path.push({ x, y: entryY });
      /* Phase 2: walk vertically to exact spawn if needed */
      if (entryY !== sp.y) {
        let y = entryY;
        while (y !== sp.y) { y += y < sp.y ? 1 : -1; path.push({ x: sp.x, y }); }
      }
      /* Place unit at off-screen start */
      u.x = startX; u.y = entryY;
      return { unit: u, path, pathIdx: 0, delay: i * 12 };
    });

    this.trans = { walkers, step: 0, speed: 8, dir: 'in' };
    this.state = S_TRANS_IN;
  }

  _stepTransition() {
    const tr = this.trans;
    if (!tr) return;
    tr.step++;

    let allDone = true;
    for (const w of tr.walkers) {
      const eff = tr.step - w.delay;
      if (eff <= 0) { allDone = false; continue; }

      /* advance one tile every `speed` frames */
      if (eff % tr.speed === 0 && w.pathIdx < w.path.length - 1) {
        w.pathIdx++;
      }

      const pt = w.path[w.pathIdx];
      w.unit.x = pt.x;
      w.unit.y = pt.y;

      if (w.pathIdx < w.path.length - 1) allDone = false;
    }

    if (allDone) {
      if (tr.dir === 'out') {
        /* load next level, then animate in */
        this.floor++;
        this._startLevel();
        this._beginTransitionIn();
      } else {
        /* snap units to their spawn positions */
        const spawns = this.map.playerSpawns;
        this.players.filter(p => p.alive).forEach((u, i) => {
          const sp = spawns[i % spawns.length];
          u.x = sp.x; u.y = sp.y;
        });
        this.trans = null;
        this.state = S_IDLE;
      }
    }
  }

  /* ═══════════ HELPERS ═══════════ */
  _select(u) {
    this._inspecting = false;
    this.sel = u;
    this.moveRange = reachable(u, this.map, [...this.players, ...this.enemies]);
    this.atkRange = null;
    this.preview = null;
    this.state = S_UNIT_SEL;
    this._tutShow('selected');
    /* tutorial: ranged unit tip */
    if (this.tut && (u.key === 'ARCHER' || u.key === 'MAGE')) this._tutShow('ranged');
  }

  _inspectEnemy(e) {
    this._inspecting = true;
    this.sel = e;
    /* show where the enemy can move */
    this.moveRange = reachable(e, this.map, [...this.players, ...this.enemies]);
    /* show all tiles this enemy could attack from any reachable tile */
    const atkSet = new Set();
    const [lo, hi] = e.weapon.rng;
    for (const t of this.moveRange) {
      for (let r = 0; r < ROWS; r++)
        for (let cl = 0; cl < COLS; cl++) {
          const d = Math.abs(t.x - cl) + Math.abs(t.y - r);
          if (d >= lo && d <= hi) atkSet.add(`${cl},${r}`);
        }
    }
    /* remove tiles already in moveRange so they don't double-highlight */
    for (const t of this.moveRange) atkSet.delete(`${t.x},${t.y}`);
    this.atkRange = [...atkSet].map(k => { const [x, y] = k.split(','); return { x: +x, y: +y }; });
    this.preview = null;
    /* stay in idle state — this is just an inspection, not a selection */
    this.state = S_IDLE;
  }

  _deselect() {
    this._inspecting = false;
    this.sel = null; this.moveRange = null; this.atkRange = null; this.preview = null;
    if (this.state !== S_WIN && this.state !== S_LOSE && this.state !== S_ENEMY_TURN && this.state !== S_COMBAT_ANIM &&
        this.state !== S_TRANS_OUT && this.state !== S_TRANS_IN)
      this.state = S_IDLE;
  }

  _showActionMenu() {
    const u = this.sel;
    this.menuPos = { x: u.x, y: u.y };

    if (u.weapon.heal) {
      /* Staff user — show HEAL instead of ATTACK */
      const healTargets = this.players.filter(p => p.alive && p !== u && p.hp < p.maxHp && inRange(u, p.x, p.y));
      this.menuOpts = [
        { label: 'HEAL', action: 'heal', on: healTargets.length > 0 },
        { label: 'WAIT', action: 'wait', on: true },
        { label: 'BACK', action: 'back', on: true },
      ];
    } else {
      const targets = this.enemies.filter(e => e.alive && inRange(u, e.x, e.y));
      this.menuOpts = [
        { label: 'ATTACK', action: 'attack', on: targets.length > 0 },
        { label: 'WAIT',   action: 'wait',   on: true },
        { label: 'BACK',   action: 'back',   on: true },
      ];
    }

    this.menuIdx = 0;
    this.state = S_ACTION_MENU;
    this.atkRange = this._atkTiles(u);
    SFX.menuOpen();
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
    if (this._healMode) {
      const tgt = this._playerAt(cx, cy);
      if (tgt && tgt !== this.sel && tgt.hp < tgt.maxHp && inRange(this.sel, cx, cy)) {
        const healAmt = Math.min(tgt.maxHp - tgt.hp, this.sel.mag + this.sel.weapon.mt + 10);
        this.preview = { heal: true, healer: this.sel, target: tgt, amount: healAmt };
      } else {
        this.preview = null;
      }
      return;
    }
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
    if (!lord || !lord.alive) { this.state = S_LOSE; SFX.gameOverMelody(); return; }
    if (!this.enemies.some(e => e.alive)) { this.state = S_WIN; SFX.win(); return; }
  }

  _playerAt(x, y) { return this.players.find(u => u.alive && u.x === x && u.y === y); }
  _enemyAt(x, y)  { return this.enemies.find(u => u.alive && u.x === x && u.y === y); }

  /* ═══════════ TEAM DRAFT ═══════════ */
  _beginDraft() {
    this._draftPool = [...DRAFT_POOL]; // ['FIGHTER','MAGE','ARCHER','HEALER','CAVALIER','KNIGHT']
    this._draftPicks = [];
    this._draftSel = 0;
    this.state = S_DRAFT;
  }

  _clickDraft(px, py) {
    const ren = this.ren;
    const bounds = ren._draftBounds;
    if (!bounds) return;

    /* check class card clicks */
    if (bounds.cards) {
      for (let i = 0; i < bounds.cards.length; i++) {
        const b = bounds.cards[i];
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
          const cls = this._draftPool[i];
          const idx = this._draftPicks.indexOf(cls);
          if (idx >= 0) {
            this._draftPicks.splice(idx, 1);
            SFX.menuBack();
          } else if (this._draftPicks.length < 3) {
            this._draftPicks.push(cls);
            SFX.select();
          }
          return;
        }
      }
    }

    /* check confirm button */
    if (bounds.confirm && this._draftPicks.length === 3) {
      const b = bounds.confirm;
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
        SFX.menuSelect();
        this.roster = ['LORD', ...this._draftPicks];
        this._startLevel();
      }
    }
  }

  /* ═══════════ POST-FLOOR BONUS ═══════════ */
  _beginBonus() {
    const opts = [];

    /* Option 1: Recruit a new unit (if team < 6) */
    const aliveCount = this.players.filter(p => p.alive).length;
    if (aliveCount < 6) {
      /* pick a random class not already on the team */
      const onTeam = new Set(this.players.map(p => p.key));
      const available = DRAFT_POOL.filter(k => !onTeam.has(k));
      if (available.length > 0) {
        const cls = available[Math.floor(Math.random() * available.length)];
        const info = CLASS_INFO[cls];
        opts.push({ label: 'RECRUIT', desc: `Add a ${info.name} to your team`, action: 'recruit', cls });
      }
    }

    /* Option 2: Strengthen — all units gain +1 level of stats */
    opts.push({ label: 'STRENGTHEN', desc: 'All units gain +1 level of stats', action: 'strengthen' });

    /* Option 3: Heal & Fortify — full heal + DEF boost */
    opts.push({ label: 'FORTIFY', desc: 'Full heal all units & +2 DEF', action: 'fortify' });

    this._bonusOpts = opts;
    this._bonusSel = 0;
    this.state = S_BONUS;
  }

  _clickBonus(px, py) {
    const bounds = this.ren._bonusBounds;
    if (!bounds || !bounds.cards) return;

    for (let i = 0; i < bounds.cards.length; i++) {
      const b = bounds.cards[i];
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
        const opt = this._bonusOpts[i];
        if (!opt) return;
        SFX.menuSelect();

        if (opt.action === 'recruit') {
          const spawns = this.map.playerSpawns;
          const spIdx = this.players.length % spawns.length;
          const lv = Math.max(1, this.floor);
          const u = new Unit(opt.cls, spawns[spIdx].x, spawns[spIdx].y, true, lv);
          this.players.push(u);
          /* add to roster so they persist across floors */
          if (this.roster) this.roster.push(opt.cls);
        } else if (opt.action === 'strengthen') {
          for (const u of this.players) {
            if (!u.alive) continue;
            const ci = CLASS_INFO[u.key];
            if (!ci) continue;
            const gr = ci.gr;
            u.level++;
            u.maxHp += Math.max(1, Math.floor(gr.hp / 20));
            u.str   += Math.floor(gr.str / 20);
            u.mag   += Math.floor(gr.mag / 20);
            u.skl   += Math.floor(gr.skl / 20);
            u.spd   += Math.floor(gr.spd / 20);
            u.lck   += Math.floor(gr.lck / 20);
            u.def   += Math.floor(gr.def / 20);
            u.res   += Math.floor(gr.res / 20);
            u.hp = u.maxHp;
          }
        } else if (opt.action === 'fortify') {
          for (const u of this.players) {
            if (!u.alive) continue;
            u.hp = u.maxHp;
            u.def += 2;
          }
        }

        /* proceed to next floor transition */
        this._beginTransitionOut();
        return;
      }
    }
  }
}

/* boot — expose for debug */
window._game = new Game();
