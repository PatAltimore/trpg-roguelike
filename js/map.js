import {
  COLS, ROWS,
  T_WALL, T_PLAIN, T_ROAD, T_FOREST, T_FORT,
  T_MOUNTAIN, T_WATER, T_HILL, T_SWAMP, T_FORD, T_BRIDGE,
} from './constants.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const rnd = n => Math.floor(Math.random() * n);
const between = (lo, hi) => lo + rnd(hi - lo + 1);

/* Player start zone: the leftmost columns. */
const START_W = 3;

/* Per-theme feature budgets. Blob counts are [min, max]. `river` is the
   chance the map is split by a river (bridge + ford); `ridge` splits it with
   a mountain range that only a couple of passes cut through. */
const THEMES = {
  forest:     { river: 0.35, mountain: [0, 1], lake: [0, 1], forest: [5, 7], hill: [2, 3], swamp: [1, 2], forts: 1 },
  fortress:   { river: 0.60, mountain: [3, 4], lake: [0, 0], forest: [1, 2], hill: [2, 3], swamp: [0, 0], forts: 2 },
  gauntlet:   { ridge: true, mountain: [0, 1], lake: [0, 0], forest: [2, 3], hill: [2, 3], swamp: [0, 1], forts: 1 },
  boss:       { river: 0.40, mountain: [2, 3], lake: [1, 2], forest: [1, 2], hill: [1, 3], swamp: [0, 1], forts: 1 },
  open_field: { river: 0.50, mountain: [0, 1], lake: [0, 1], forest: [2, 3], hill: [2, 3], swamp: [0, 1], forts: 1 },
  mixed:      { river: 0.75, mountain: [1, 2], lake: [1, 1], forest: [3, 4], hill: [2, 3], swamp: [1, 1], forts: 1 },
};

/* Terrain enemies may start on — never hazards or crossings. */
const SPAWNABLE = new Set([T_PLAIN, T_FOREST, T_HILL, T_FORT, T_ROAD]);

/* ═══════════════════════════════════════════════════════════════
   GameMap — procedural level generator
   ═══════════════════════════════════════════════════════════════
   Maps are open ground, not rooms joined by corridors, so fights happen
   across the field instead of at one chokepoint. Terrain does the shaping:
     • river   — a bridge (fast, one tile wide) plus a ford (slow, exposed):
                 a chokepoint you can hold or go around
     • ridge   — the gauntlet's mountain range with a few passes: the one
                 floor where a chokepoint is the point
     • mountains and lakes block movement and make lanes and flanks
     • forest, hill (best cover), swamp (slow, easy to hit) and forts (heal)
   Players start on the left; the map is randomly flipped top-to-bottom.
   Every attempt is checked for connectivity, with a bare field as fallback. */
export class GameMap {
  constructor(floor) {
    this.floor = floor;
    this.tiles = [];
    this.playerSpawns = [];
    this.enemySpawns  = [];
    if (floor === 0) {
      this._generateTutorial();
    } else {
      this._floorTheme = this._pickTheme();
      this._generate();
    }
  }

  at(x, y)       { return (x >= 0 && x < COLS && y >= 0 && y < ROWS) ? this.tiles[y][x] : T_WALL; }
  passable(x, y) { return this.at(x, y).cost < 99; }
  moveCost(x, y) { return this.at(x, y).cost; }

  /* ═══════════ TUTORIAL ═══════════
     Hand-crafted 3-room map with progressive teaching:
       Room A → movement basics (safe, open)
       Room B → terrain & weapon triangle (forests, varied enemies)
       Room C → forts & ranged threats (risk/reward positioning)     */
  _generateTutorial() {
    const MAP = [
      'WWWWWWWWWWWWWW',
      'W.....W...FF.W',
      'W.....R......W',
      'W.....W......W',
      'WWWWWWWWWWRWWW',
      'WWWWWWWWWWRWWW',
      'WWWWWWWWWWRWWW',
      'WWWWWWWW.....W',
      'WWWWWWWW...T.W',
      'WWWWWWWWWWWWWW',
    ];
    const CH = { W: T_WALL, '.': T_PLAIN, R: T_ROAD, F: T_FOREST, T: T_FORT };
    this.tiles = MAP.map(row => [...row].map(ch => CH[ch] || T_WALL));
    this.playerSpawns = [
      { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 },
      { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 },
    ];
    this.enemySpawns = [
      { x: 12, y: 1, cls: 'BRIGAND' },
      { x: 8,  y: 2, cls: 'SOLDIER' },
      { x: 9,  y: 7, cls: 'E_ARCHER' },
    ];
  }

  /* ═══════════ PROCEDURAL ═══════════ */
  _generate() {
    for (let attempt = 0; attempt < 40; attempt++) {
      this._build(true);
      if (this._isValid()) break;
      if (attempt === 39) this._build(false);
    }
    if (Math.random() < 0.5) this._flipVertical();
  }

  /* Each floor emphasises a different mechanic. */
  _pickTheme() {
    const f = this.floor;
    if (f === 1) return 'forest';        // the wilds
    if (f === 2) return 'fortress';      // enemy stronghold
    if (f === 3) return 'gauntlet';      // perilous pass
    if (f === 4) return 'boss';          // the warlord's throne
    const themes = ['forest', 'fortress', 'gauntlet', 'open_field', 'mixed'];
    return themes[(f - 5) % themes.length];
  }

  _build(withFeatures) {
    this.tiles = Array.from({ length: ROWS }, () => Array(COLS).fill(T_PLAIN));
    this.playerSpawns = [];
    this.enemySpawns = [];
    const P = THEMES[this._floorTheme] || THEMES.mixed;

    let barrier = null;
    if (withFeatures) {
      if (P.ridge)                          barrier = this._placeRidge();
      else if (Math.random() < P.river)     barrier = this._placeRiver();
      for (let i = between(...P.mountain); i > 0; i--) this._blob(T_MOUNTAIN, between(2, 4), START_W);
      for (let i = between(...P.lake); i > 0; i--)     this._blob(T_WATER,    between(2, 4), START_W);
      for (let i = between(...P.swamp); i > 0; i--)    this._blob(T_SWAMP,    between(3, 4), START_W);
      for (let i = between(...P.hill); i > 0; i--)     this._blob(T_HILL,     between(2, 3), 0);
      for (let i = between(...P.forest); i > 0; i--)   this._blob(T_FOREST,   between(2, 4), 0);
    }
    this._placeForts(P.forts, barrier);
    this._placeSpawns(barrier);
  }

  /* Meandering top-to-bottom band in columns 4–8, set to `type`. Returns the
     x's it covers in each row (two at a bend, so it stays orthogonally
     connected and nothing can slip through diagonally). */
  _meander(type) {
    const rows = [];
    let x = between(5, 7);
    for (let y = 0; y < ROWS; y++) {
      const xs = [x];
      const r = Math.random();
      if (r < 0.25 && x > 4) x--; else if (r < 0.5 && x < 8) x++;
      if (x !== xs[0]) xs.push(x);
      rows.push(xs);
      for (const bx of xs) this.tiles[y][bx] = type;
    }
    return rows;
  }

  _barrier(rows, crossY) {
    const all = rows.flat();
    return { crossY, minX: Math.min(...all), maxX: Math.max(...all) };
  }

  /* River with a bridge, a two-wide ford, and now and then a second bridge. */
  _placeRiver() {
    const rows = this._meander(T_WATER);
    const cross = (y, type) => { for (const bx of rows[y]) this.tiles[y][bx] = type; };
    const bridgeY = between(1, ROWS - 2);
    cross(bridgeY, T_BRIDGE);
    const spaced = [...Array(ROWS).keys()].filter(y => Math.abs(y - bridgeY) >= 3);
    const fordY = spaced.length ? spaced[rnd(spaced.length)] : (bridgeY + 3) % ROWS;
    cross(fordY, T_FORD);
    if (fordY + 1 < ROWS) cross(fordY + 1, T_FORD);
    const far = spaced.filter(y => Math.abs(y - fordY) >= 3);
    if (far.length && Math.random() < 0.3) cross(far[rnd(far.length)], T_BRIDGE);
    return this._barrier(rows, bridgeY);
  }

  /* Mountain range with a two-wide pass, and often a narrow one-wide pass. */
  _placeRidge() {
    const rows = this._meander(T_MOUNTAIN);
    const open = y => { for (const bx of rows[y]) this.tiles[y][bx] = T_PLAIN; };
    const passY = between(1, ROWS - 3);
    open(passY); open(passY + 1);
    const far = [...Array(ROWS).keys()].filter(y => Math.abs(y - passY) >= 4);
    if (far.length && Math.random() < 0.5) open(far[rnd(far.length)]);
    return this._barrier(rows, passY);
  }

  /* Grow a clump of `type` on plain ground, no further left than `minX`. */
  _blob(type, size, minX) {
    for (let tries = 0; tries < 20; tries++) {
      const sx = between(minX, COLS - 1), sy = rnd(ROWS);
      if (this.tiles[sy][sx] !== T_PLAIN) continue;
      const cells = [[sx, sy]];
      this.tiles[sy][sx] = type;
      for (let guard = 0; cells.length < size && guard < 40; guard++) {
        const [cx, cy] = cells[rnd(cells.length)];
        const [dx, dy] = DIRS[rnd(4)];
        const nx = cx + dx, ny = cy + dy;
        if (nx < minX || nx >= COLS || ny < 0 || ny >= ROWS || this.tiles[ny][nx] !== T_PLAIN) continue;
        this.tiles[ny][nx] = type;
        cells.push([nx, ny]);
      }
      return;
    }
  }

  /* A fort on plain ground in columns xMin–xMax, as near row yHint as it can
     get, with a little forest around it. */
  _placeFort(xMin, xMax, yHint) {
    const spots = [];
    for (let y = 0; y < ROWS; y++)
      for (let x = xMin; x <= xMax; x++)
        if (this.tiles[y][x] === T_PLAIN) spots.push({ x, y, d: Math.abs(y - yHint) + Math.random() });
    if (!spots.length) return;
    spots.sort((a, b) => a.d - b.d);
    const { x, y } = spots[0];
    this.tiles[y][x] = T_FORT;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && this.tiles[ny][nx] === T_PLAIN && Math.random() < 0.4)
        this.tiles[ny][nx] = T_FOREST;
    }
  }

  /* Forts reward pushing through (enemy side, by the crossing) and give
     defenders a rally point (player side). Without a barrier they sit
     mid-map / on the far side; on the boss floor, behind the warlord. */
  _placeForts(count, barrier) {
    if (this._floorTheme === 'boss')  this._placeFort(COLS - 5, COLS - 3, rnd(ROWS));
    else if (barrier)                 this._placeFort(barrier.maxX + 2, barrier.maxX + 3, barrier.crossY);
    else                              this._placeFort(Math.floor(COLS / 2), COLS - 3, rnd(ROWS));

    if (count > 1 || (barrier && Math.random() < 0.5)) {
      if (barrier) this._placeFort(Math.max(START_W, barrier.minX - 3), barrier.minX - 1, barrier.crossY);
      else         this._placeFort(START_W, Math.floor(COLS / 2) - 1, rnd(ROWS));
    }
  }

  _placeSpawns(barrier) {
    /* players: the 8 plain tiles nearest a random spot on the left edge */
    const cy = between(3, ROWS - 4);
    const start = [];
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < START_W; x++)
        if (this.tiles[y][x] === T_PLAIN) start.push({ x, y, d: Math.abs(y - cy) + x * 0.5 });
    start.sort((a, b) => a.d - b.d);
    this.playerSpawns = start.slice(0, 8).map(({ x, y }) => ({ x, y }));

    /* enemies: beyond the barrier, or the right half of the map */
    const minX = barrier ? Math.max(barrier.maxX + 2, 7) : 7;
    const cands = [];
    for (let y = 0; y < ROWS; y++)
      for (let x = minX; x < COLS; x++) {
        const t = this.tiles[y][x];
        if (SPAWNABLE.has(t)) cands.push({ x, y, def: t.def });
      }

    const picked = [];
    const take = (c, cls) => {
      const spawn = { x: c.x, y: c.y };
      if (cls) spawn.cls = cls;
      this.enemySpawns.push(spawn);
      picked.push(c);
      cands.splice(cands.indexOf(c), 1);
    };
    /* the boss goes first so a small enemy count can never cut it off */
    if (this._floorTheme === 'boss' && cands.length) {
      const mid = ROWS / 2;
      const score = c => c.x - Math.abs(c.y - mid) * 0.3;
      take(cands.reduce((a, b) => (score(b) > score(a) ? b : a)), 'WARLORD');
    }
    /* then farthest-point order, favouring good cover, so any prefix of the
       list (spawnEnemies takes as many as the difficulty asks for) is spread
       across the field rather than bunched */
    while (picked.length < 12 && cands.length) {
      let best = null, bestScore = -Infinity;
      for (const c of cands) {
        const gap = picked.length
          ? Math.min(...picked.map(p => Math.abs(p.x - c.x) + Math.abs(p.y - c.y)))
          : 5;
        const score = Math.min(gap, 5) + c.def * 0.75 + Math.random() * 1.5;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      take(best);
    }
  }

  _isValid() {
    if (this.playerSpawns.length < 8 || this.enemySpawns.length < 8) return false;
    const p0 = this.playerSpawns[0];
    const dist = pathDistances(this, p0.x, p0.y);
    if (this.enemySpawns.some(s => !Number.isFinite(dist[s.y][s.x]))) return false;
    /* no walled-off pockets: every walkable tile can be reached from the start */
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (this.passable(x, y) && !Number.isFinite(dist[y][x])) return false;
    return true;
  }

  _flipVertical() {
    this.tiles.reverse();
    const flip = s => { s.y = ROWS - 1 - s.y; };
    this.playerSpawns.forEach(flip);
    this.enemySpawns.forEach(flip);
  }
}

/* ═══════════ Walking distance ═══════════
   Cost to walk from (sx, sy) to every tile, ignoring units — Infinity where
   walls/water/mountains cut a tile off. Used to validate generated maps and
   by the enemy AI, which has to route around rivers and ridges instead of
   pressing against them. */
export function pathDistances(map, sx, sy) {
  const dist = Array.from({ length: ROWS }, () => Array(COLS).fill(Infinity));
  dist[sy][sx] = 0;
  const open = [[sx, sy]];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++)
      if (dist[open[i][1]][open[i][0]] < dist[open[bi][1]][open[bi][0]]) bi = i;
    const [x, y] = open.splice(bi, 1)[0];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS || !map.passable(nx, ny)) continue;
      const nd = dist[y][x] + map.moveCost(nx, ny);
      if (nd < dist[ny][nx]) { dist[ny][nx] = nd; open.push([nx, ny]); }
    }
  }
  return dist;
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

    for (const [dx, dy] of DIRS) {
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
