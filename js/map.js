import { COLS, ROWS, T_WALL, T_PLAIN, T_ROAD, T_FOREST, T_FORT } from './constants.js';

/* ── BSP node ── */
class Node {
  constructor(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; this.l = null; this.r = null; this.room = null; }
}

/* ── Map generator ── */
export class GameMap {
  constructor(floor) {
    this.floor = floor;
    this.tiles = [];
    this.rooms = [];
    this.playerSpawns = [];
    this.enemySpawns  = [];
    this._generate();
  }

  /* public */
  at(x, y)        { return (x >= 0 && x < COLS && y >= 0 && y < ROWS) ? this.tiles[y][x] : T_WALL; }
  passable(x, y)  { return this.at(x, y).cost < 99; }
  moveCost(x, y)  { return this.at(x, y).cost; }

  /* ── generation pipeline ── */
  _generate() {
    /* 1. fill with walls */
    this.tiles = Array.from({ length: ROWS }, () => Array(COLS).fill(T_WALL));

    /* 2. BSP split */
    const root = new Node(1, 1, COLS - 2, ROWS - 2);
    const leaves = [];
    this._split(root, leaves, 0);

    /* 3. carve rooms */
    for (const leaf of leaves) {
      const room = this._carveRoom(leaf);
      if (room) { this.rooms.push(room); leaf.room = room; }
    }

    /* 4. corridors */
    for (let i = 0; i < leaves.length - 1; i++) {
      const a = leaves[i].room  || this._center(leaves[i]);
      const b = leaves[i+1].room || this._center(leaves[i+1]);
      this._corridor(
        Math.floor(a.x + a.w / 2), Math.floor(a.y + a.h / 2),
        Math.floor(b.x + b.w / 2), Math.floor(b.y + b.h / 2));
    }

    /* 5. terrain dressing */
    this._dress();

    /* 6. spawns */
    this._placeSpawns();
  }

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

  _center(leaf) { return { x: leaf.x + Math.floor(leaf.w / 2), y: leaf.y + Math.floor(leaf.h / 2), w: 0, h: 0 }; }

  _corridor(x1, y1, x2, y2) {
    let x = x1, y = y1;
    const first = Math.random() < 0.5;
    if (first) {
      while (x !== x2) { this._set(x, y, T_ROAD); x += x < x2 ? 1 : -1; }
      while (y !== y2) { this._set(x, y, T_ROAD); y += y < y2 ? 1 : -1; }
    } else {
      while (y !== y2) { this._set(x, y, T_ROAD); y += y < y2 ? 1 : -1; }
      while (x !== x2) { this._set(x, y, T_ROAD); x += x < x2 ? 1 : -1; }
    }
    this._set(x2, y2, T_ROAD);
  }

  _set(x, y, t) { if (x > 0 && x < COLS - 1 && y > 0 && y < ROWS - 1) this.tiles[y][x] = t; }

  _dress() {
    for (const room of this.rooms) {
      /* forests */
      if (Math.random() < 0.5) {
        const n = 1 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          const tx = room.x + Math.floor(Math.random() * room.w);
          const ty = room.y + Math.floor(Math.random() * room.h);
          if (this.at(tx, ty) === T_PLAIN) this.tiles[ty][tx] = T_FOREST;
        }
      }
      /* fort */
      if (Math.random() < 0.15 && room.w >= 3 && room.h >= 3) {
        this.tiles[room.y + Math.floor(room.h / 2)][room.x + Math.floor(room.w / 2)] = T_FORT;
      }
    }
  }

  _placeSpawns() {
    if (this.rooms.length === 0) return;

    const start = this.rooms[0];
    /* up to 4 player spawns inside first room */
    for (let dy = 0; dy < Math.min(2, start.h); dy++)
      for (let dx = 0; dx < Math.min(2, start.w); dx++) {
        const sx = start.x + dx + 1 < start.x + start.w ? start.x + dx + 1 : start.x + dx;
        const sy = start.y + dy + 1 < start.y + start.h ? start.y + dy + 1 : start.y + dy;
        if (this.passable(sx, sy)) this.playerSpawns.push({ x: sx, y: sy });
      }
    /* fallback */
    if (this.playerSpawns.length === 0)
      this.playerSpawns.push({ x: start.x, y: start.y });

    /* enemy spawns – one or two per non-start room */
    for (let i = 1; i < this.rooms.length; i++) {
      const rm = this.rooms[i];
      const cx = rm.x + Math.floor(rm.w / 2);
      const cy = rm.y + Math.floor(rm.h / 2);
      if (this.passable(cx, cy)) this.enemySpawns.push({ x: cx, y: cy });
      if (rm.w >= 4 && this.passable(cx + 1, cy)) this.enemySpawns.push({ x: cx + 1, y: cy });
    }
  }
}

/* ── Movement range (Dijkstra) ── */
export function reachable(unit, map, units) {
  const blocked = new Set();
  for (const u of units) if (u.alive && u !== unit) blocked.add(`${u.x},${u.y},${u.isPlayer}`);

  const dist = new Map();
  const start = `${unit.x},${unit.y}`;
  dist.set(start, 0);
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
      /* can't move through enemies */
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
  /* filter: can't stop on any other unit */
  const occupied = new Set(units.filter(u => u.alive && u !== unit).map(u => `${u.x},${u.y}`));
  return result.filter(t => !occupied.has(`${t.x},${t.y}`) || (t.x === unit.x && t.y === unit.y));
}
