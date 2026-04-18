import { COLS, ROWS, T_WALL, T_PLAIN, T_ROAD, T_FOREST, T_FORT } from './constants.js';

/* ── BSP node ── */
class Node {
  constructor(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; this.l = null; this.r = null; this.room = null; }
}

/* ═══════════════════════════════════════════════════════════════
   GameMap — procedural level generator
   ═══════════════════════════════════════════════════════════════
   Level design principles applied:
   1. Fun to navigate + chaos — varied room sizes, winding corridors
   2. Mechanics-driven — terrain placement creates tactical choices
   3. Emotional through mechanics — tension (corridors), relief (forts)
   4. Environmental storytelling — room themes convey purpose visually
   5. Clear objective, player chooses how — multiple paths to enemies
   6. Teach new things — floor themes emphasise different mechanics
   7. Surprise & pacing — dramatic room-size shifts, aesthetic changes
   8. Risk/reward — forts placed near harder encounters
   9. Non-linearity — rooms connected as a web, not a chain
   10. Empower player — defensive positions, chokepoints, ambush spots
   ═══════════════════════════════════════════════════════════════ */
export class GameMap {
  constructor(floor) {
    this.floor = floor;
    this.tiles = [];
    this.rooms = [];
    this.playerSpawns = [];
    this.enemySpawns  = [];
    if (floor === 0) this._generateTutorial();
    else             this._generate();
  }

  at(x, y)       { return (x >= 0 && x < COLS && y >= 0 && y < ROWS) ? this.tiles[y][x] : T_WALL; }
  passable(x, y) { return this.at(x, y).cost < 99; }
  moveCost(x, y) { return this.at(x, y).cost; }
  _set(x, y, t)  { if (x > 0 && x < COLS - 1 && y > 0 && y < ROWS - 1) this.tiles[y][x] = t; }

  /* ═══════════ TUTORIAL (floor 1) ═══════════
     Hand-crafted 3-room map with progressive teaching:
       Room A → movement basics (safe, open)
       Room B → terrain & weapon triangle (forests, varied enemies)
       Room C → forts & ranged threats (risk/reward positioning)     */
  _generateTutorial() {
    const MAP = [
      'WWWWWWWWWWWWWWWWWWWW',
      'W......WW...FF.....W',
      'W......RR....F.....W',
      'W......RR..........W',
      'W......WW...F......W',
      'WWWWWWWWWW.........W',
      'WWWWWWWWWWWWWWRRWWWW',
      'WWWWWWWWWWWWWWRRWWWW',
      'WWWWWWWWWWW.......WW',
      'WWWWWWWWWWW..T....WW',
      'WWWWWWWWWWW.......WW',
      'WWWWWWWWWWW.......WW',
      'WWWWWWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWWWWWW',
    ];
    const CH = { W: T_WALL, '.': T_PLAIN, R: T_ROAD, F: T_FOREST, T: T_FORT };
    this.tiles = MAP.map(row => [...row].map(ch => CH[ch] || T_WALL));
    this.rooms = [
      { x: 1, y: 1, w: 6, h: 4 },
      { x: 10, y: 1, w: 8, h: 5 },
      { x: 11, y: 8, w: 7, h: 4 },
    ];
    this.playerSpawns = [
      { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 },
      { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 },
    ];
    this.enemySpawns = [
      { x: 16, y: 3, cls: 'BRIGAND' },
      { x: 13, y: 2, cls: 'SOLDIER' },
      { x: 15, y: 10, cls: 'E_ARCHER' },
    ];
  }

  /* ═══════════ PROCEDURAL (floors 2+) ═══════════ */
  _generate() {
    this.tiles = Array.from({ length: ROWS }, () => Array(COLS).fill(T_WALL));

    /* 1. BSP → rooms */
    const root = new Node(1, 1, COLS - 2, ROWS - 2);
    const leaves = [];
    this._split(root, leaves, 0);
    for (const leaf of leaves) {
      const room = this._carveRoom(leaf);
      if (room) { this.rooms.push(room); leaf.room = room; }
    }

    /* 2. Non-linear connectivity — connect as a web, not a chain
       First: connect sequential neighbours (guarantees reachability).
       Then: add 1-2 extra cross-connections (creates alternate paths,
       bidirectionality, and player choice). */
    for (let i = 0; i < leaves.length - 1; i++) {
      const a = leaves[i].room  || this._center(leaves[i]);
      const b = leaves[i+1].room || this._center(leaves[i+1]);
      this._corridor(a, b);
    }
    /* extra cross-connections for non-linearity */
    const extras = 1 + Math.floor(Math.random() * 2);
    for (let e = 0; e < extras && this.rooms.length > 3; e++) {
      const i = Math.floor(Math.random() * this.rooms.length);
      let j = Math.floor(Math.random() * this.rooms.length);
      if (j === i) j = (j + 2) % this.rooms.length;
      this._corridor(this.rooms[i], this.rooms[j]);
    }

    /* 3. Floor theme — each floor emphasises different mechanics */
    this._applyTheme();

    /* 4. Room dressing — give each room tactical character */
    this._dressRooms();

    /* 5. Corridor dressing — cover near chokepoints */
    this._dressCorridors();

    /* 6. Spawn placement — risk/reward scaling */
    this._placeSpawns();
  }

  /* ── BSP ── */
  _split(node, leaves, depth) {
    const MIN = 5, MAX_D = 4;
    if (depth >= MAX_D || node.w < MIN * 2 || node.h < MIN * 2) { leaves.push(node); return; }
    const horiz = node.w >= node.h;
    if (horiz) {
      const s = MIN + Math.floor(Math.random() * (node.w - MIN * 2));
      node.l = new Node(node.x, node.y, s, node.h);
      node.r = new Node(node.x + s, node.y, node.w - s, node.h);
    } else {
      const s = MIN + Math.floor(Math.random() * (node.h - MIN * 2));
      node.l = new Node(node.x, node.y, node.w, s);
      node.r = new Node(node.x, node.y + s, node.w, node.h - s);
    }
    this._split(node.l, leaves, depth + 1);
    this._split(node.r, leaves, depth + 1);
  }

  _carveRoom(leaf) {
    const minW = 3, minH = 3;
    /* Surprise: pacing through room-size variation.
       Occasionally generate tiny (3x3) or large (8x6) rooms
       for dramatic shifts in tactical feel. */
    const maxW = Math.min(8, leaf.w - 2);
    const maxH = Math.min(6, leaf.h - 2);
    if (maxW < minW || maxH < minH) return null;
    const w = minW + Math.floor(Math.random() * (maxW - minW + 1));
    const h = minH + Math.floor(Math.random() * (maxH - minH + 1));
    const x = leaf.x + 1 + Math.floor(Math.random() * Math.max(1, leaf.w - w - 1));
    const y = leaf.y + 1 + Math.floor(Math.random() * Math.max(1, leaf.h - h - 1));
    for (let r = y; r < y + h && r < ROWS; r++)
      for (let c = x; c < x + w && c < COLS; c++)
        this.tiles[r][c] = T_PLAIN;
    return { x, y, w, h };
  }

  _center(n) { return { x: n.x + Math.floor(n.w / 2), y: n.y + Math.floor(n.h / 2), w: 0, h: 0 }; }

  _corridor(a, b) {
    let x1 = Math.floor(a.x + (a.w || 0) / 2), y1 = Math.floor(a.y + (a.h || 0) / 2);
    let x2 = Math.floor(b.x + (b.w || 0) / 2), y2 = Math.floor(b.y + (b.h || 0) / 2);
    let x = x1, y = y1;
    /* L-shaped corridor — random whether horizontal or vertical first
       creates winding, interesting paths */
    if (Math.random() < 0.5) {
      while (x !== x2) { this._set(x, y, T_ROAD); x += x < x2 ? 1 : -1; }
      while (y !== y2) { this._set(x, y, T_ROAD); y += y < y2 ? 1 : -1; }
    } else {
      while (y !== y2) { this._set(x, y, T_ROAD); y += y < y2 ? 1 : -1; }
      while (x !== x2) { this._set(x, y, T_ROAD); x += x < x2 ? 1 : -1; }
    }
    this._set(x2, y2, T_ROAD);
  }

  /* ── Floor themes ──
     Principle 6: constantly teach new things.
     Principle 7: surprise with aesthetic/pacing changes.
     Each floor range has a dominant theme that emphasises
     a mechanic the player should be mastering. */
  _applyTheme() {
    this._floorTheme = this._pickTheme();
  }

  _pickTheme() {
    const f = this.floor;
    if (f === 1) return 'forest';        // the wilds
    if (f === 2) return 'fortress';      // enemy stronghold
    if (f === 3) return 'gauntlet';      // perilous pass
    if (f === 4) return 'boss';          // the warlord's throne
    /* fallback */
    const themes = ['forest', 'fortress', 'gauntlet', 'open_field', 'mixed'];
    return themes[(f - 5) % themes.length];
  }

  /* ── Room dressing ──
     Principle 2: mechanics-driven (terrain creates tactical choices)
     Principle 3: emotional through mechanics (relief at forts, tension in tight spaces)
     Principle 8: risk/reward (forts near harder encounters)
     Principle 10: empower player (defensive positions near corridors) */
  _dressRooms() {
    if (this.rooms.length < 2) return;
    const s = this.rooms[0];
    const cx0 = s.x + s.w / 2, cy0 = s.y + s.h / 2;

    /* sort by distance from start for difficulty scaling */
    const others = this.rooms.slice(1).map(r => ({
      room: r,
      dist: Math.abs(r.x + r.w / 2 - cx0) + Math.abs(r.y + r.h / 2 - cy0),
    })).sort((a, b) => a.dist - b.dist);

    /* Start room: empower player — a few trees for cover, feels safe */
    if (Math.random() < 0.5) this._placeTrees(s, 1);

    let fortPlaced = false;
    const theme = this._floorTheme;

    for (let i = 0; i < others.length; i++) {
      const { room } = others[i];
      const ratio = i / Math.max(1, others.length - 1); // 0=near, 1=far
      const area = room.w * room.h;
      const isLarge = area >= 16;
      const isFar = ratio > 0.5;

      /* Risk/reward: forts placed in harder (farther) rooms.
         Going deeper is risky but rewarded with healing. */
      if (!fortPlaced && isFar && (theme === 'fortress' || Math.random() < 0.3)) {
        this._themeFort(room);
        fortPlaced = true;
        continue;
      }

      /* Theme-driven room dressing */
      switch (theme) {
        case 'forest':
          this._themeForest(room, 3 + Math.floor(Math.random() * 3));
          break;
        case 'fortress':
          if (!fortPlaced && i === others.length - 1) {
            this._themeFort(room); fortPlaced = true;
          } else {
            this._themeForest(room, 2);
          }
          break;
        case 'gauntlet':
          /* tight rooms: minimal decoration, chokepoints matter most */
          if (Math.random() < 0.3) this._placeTrees(room, 1);
          break;
        case 'open_field':
          /* large open areas with sparse cover — positioning is key */
          if (isLarge) this._placeTrees(room, 1 + Math.floor(Math.random() * 2));
          break;
        case 'boss':
          /* dark fortress: sparse trees, fort in boss room for tension */
          if (isFar && !fortPlaced) { this._themeFort(room); fortPlaced = true; }
          else if (Math.random() < 0.4) this._placeTrees(room, 1 + Math.floor(Math.random() * 2));
          break;
        case 'mixed':
        default: {
          /* chaos: random theme per room for surprise */
          const roll = Math.random();
          if (roll < 0.3) this._themeForest(room, 2 + Math.floor(Math.random() * 3));
          else if (roll < 0.45 && !fortPlaced) { this._themeFort(room); fortPlaced = true; }
          else if (roll < 0.6) this._placeTrees(room, 1);
          break;
        }
      }
    }

    /* guarantee at least one fort per floor (risk/reward anchor) */
    if (!fortPlaced && others.length > 0) {
      this._themeFort(others[others.length - 1].room);
    }
  }

  _themeForest(room, count) { this._placeTrees(room, count); }

  _themeFort(room) {
    const fx = room.x + Math.floor(room.w / 2);
    const fy = room.y + Math.floor(room.h / 2);
    if (this.at(fx, fy) === T_PLAIN) this.tiles[fy][fx] = T_FORT;
    for (const [dx, dy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
      const nx = fx + dx, ny = fy + dy;
      if (this.at(nx, ny) === T_PLAIN && Math.random() < 0.4)
        this.tiles[ny][nx] = T_FOREST;
    }
  }

  _placeTrees(room, count) {
    for (let i = 0; i < count; i++) {
      const tx = room.x + Math.floor(Math.random() * room.w);
      const ty = room.y + Math.floor(Math.random() * room.h);
      if (this.at(tx, ty) === T_PLAIN) this.tiles[ty][tx] = T_FOREST;
    }
  }

  /* ── Corridor dressing ──
     Principle 10: empower player — cover near chokepoints
     lets the player set up ambushes or defensive lines. */
  _dressCorridors() {
    const chance = this._floorTheme === 'gauntlet' ? 0.15 : 0.07;
    for (let y = 1; y < ROWS - 1; y++)
      for (let x = 1; x < COLS - 1; x++) {
        if (this.at(x, y) !== T_ROAD) continue;
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nx = x + dx, ny = y + dy;
          if (this.at(nx, ny) === T_PLAIN && Math.random() < chance)
            this.tiles[ny][nx] = T_FOREST;
        }
      }
  }

  /* ── Spawns ──
     Principle 5: clear objective (defeat all enemies), player chooses path
     Principle 8: risk/reward — harder enemies in rooms with better terrain
     Principle 9: non-linearity — enemies in multiple rooms, tackle any order */
  _placeSpawns() {
    if (this.rooms.length === 0) return;

    /* Player spawns in safe start room — scan row-by-row until we have 8 positions */
    const start = this.rooms[0];
    outer:
    for (let dy = 0; dy < start.h; dy++) {
      for (let dx = 0; dx < start.w; dx++) {
        if (this.playerSpawns.length >= 8) break outer;
        const sx = start.x + dx, sy = start.y + dy;
        if (this.passable(sx, sy)) this.playerSpawns.push({ x: sx, y: sy });
      }
    }
    if (!this.playerSpawns.length)
      this.playerSpawns.push({ x: start.x, y: start.y });

    /* Sort rooms by distance — difficulty gradient */
    const cx0 = start.x + start.w / 2, cy0 = start.y + start.h / 2;
    const others = this.rooms.slice(1).map(r => ({
      room: r,
      dist: Math.abs(r.x + r.w / 2 - cx0) + Math.abs(r.y + r.h / 2 - cy0),
    })).sort((a, b) => a.dist - b.dist);

    const occupied = new Set();
    const isBoss = this._floorTheme === 'boss';
    const addSpawn = (sx, sy, cls) => {
      const k = `${sx},${sy}`;
      if (this.passable(sx, sy) && !occupied.has(k)) {
        occupied.add(k);
        const spawn = { x: sx, y: sy };
        if (cls) spawn.cls = cls;
        this.enemySpawns.push(spawn);
        return true;
      }
      return false;
    };

    for (let i = 0; i < others.length; i++) {
      const rm = others[i].room;
      const cx = rm.x + Math.floor(rm.w / 2);
      const cy = rm.y + Math.floor(rm.h / 2);
      const ratio = i / Math.max(1, others.length - 1);
      const isLast = i === others.length - 1;

      /* every room gets at least one enemy */
      if (!addSpawn(cx, cy)) {
        addSpawn(cx + 1, cy) || addSpawn(cx - 1, cy) || addSpawn(cx, cy + 1);
      }

      /* farther rooms get more enemies (risk escalation) */
      if (ratio > 0.4 && rm.w >= 4) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        addSpawn(cx + dir, cy) || addSpawn(cx, cy + 1);
      }

      /* last room: boss encounter */
      if (isLast && rm.h >= 3) {
        addSpawn(cx, cy + 1) || addSpawn(cx, cy - 1);
      }
      /* boss floor: place WARLORD in the farthest room */
      if (isBoss && isLast) {
        addSpawn(cx + 1, cy + 1, 'WARLORD') || addSpawn(cx - 1, cy, 'WARLORD') || addSpawn(cx, cy - 1, 'WARLORD');
      }
    }
  }
}

/* ═══════════ Movement range (Dijkstra) ═══════════ */
export function reachable(unit, map, units) {
  const blocked = new Set();
  for (const u of units) if (u.alive && u !== unit) blocked.add(`${u.x},${u.y},${u.isPlayer}`);

  const dist = new Map();
  dist.set(`${unit.x},${unit.y}`, 0);
  const open = [{ x: unit.x, y: unit.y, g: 0 }];
  const result = [];

  while (open.length) {
    open.sort((a, b) => a.g - b.g);
    const cur = open.shift();
    const ck = `${cur.x},${cur.y}`;
    if (dist.has(ck) && dist.get(ck) < cur.g) continue;
    result.push({ x: cur.x, y: cur.y });

    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      if (!map.passable(nx, ny)) continue;
      const ek = `${nx},${ny},${!unit.isPlayer}`;
      if (blocked.has(ek)) continue;
      const ng = cur.g + map.moveCost(nx, ny);
      const nk = `${nx},${ny}`;
      if (ng <= unit.mov && (!dist.has(nk) || ng < dist.get(nk))) {
        dist.set(nk, ng);
        open.push({ x: nx, y: ny, g: ng });
      }
    }
  }
  const occupied = new Set(units.filter(u => u.alive && u !== unit).map(u => `${u.x},${u.y}`));
  return result.filter(t => !occupied.has(`${t.x},${t.y}`) || (t.x === unit.x && t.y === unit.y));
}
