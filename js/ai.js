import { reachable, pathDistances } from './map.js';
import { inRange } from './combat.js';

/**
 * Plan enemy turn actions.
 *
 * AI modes (assigned per-unit based on position/type):
 *   'guard'      – stays in place until a player enters threat range
 *                  (move range + weapon range), then pursues
 *   'aggressive' – always chases the nearest player
 *
 * Boss units and units that start near players are aggressive.
 * Most other units are guards — like classic Fire Emblem.
 *
 * "Nearest" and "closer" mean walking distance, not straight-line, so
 * enemies path around rivers and mountain ridges instead of pressing against
 * them. Ties go to the tile with better cover.
 */
export function planEnemyTurn(enemies, players, map) {
  const all = [...enemies, ...players];
  const actions = [];
  /* track tiles claimed by earlier enemies so they don't overlap */
  const claimed = new Set();
  for (const e of enemies) {
    if (!e.alive) continue;
    claimed.add(`${e.x},${e.y}`);
  }

  const alive = players.filter(p => p.alive);
  const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  /* walking cost from each player to every tile (players don't move mid-plan) */
  const walk = new Map(alive.map(p => [p, pathDistances(map, p.x, p.y)]));
  /* walking distance from `p` to (x, y); a walled-off tile counts as far away */
  const distTo = (p, x, y) => {
    const d = walk.get(p)[y][x];
    return Number.isFinite(d) ? d : 99 + Math.abs(x - p.x) + Math.abs(y - p.y);
  };

  for (const e of enemies) {
    if (!e.alive) continue;
    if (!alive.length) break;

    /* can attack without moving? always take the shot (nearest target in range) */
    const shootable = alive.filter(p => inRange(e, p.x, p.y));
    if (shootable.length) {
      const target = shootable.reduce((a, b) => (manhattan(e, b) < manhattan(e, a) ? b : a));
      actions.push({ unit: e, type: 'attack', target, mx: e.x, my: e.y });
      continue;
    }

    /* nearest player by walking distance */
    let best = null, bestD = Infinity;
    for (const p of alive) {
      const d = distTo(p, e.x, e.y);
      if (d < bestD) { bestD = d; best = p; }
    }

    /* determine AI mode: guard or aggressive */
    const threatRange = e.mov + e.weapon.rng[1];
    const isAggressive = e._ai === 'aggressive'   // explicitly set (bosses)
                      || bestD <= threatRange + 2; // player is nearby (within threat range + small buffer)

    /* guard mode: stay put if no player is in threat range */
    if (!isAggressive) {
      actions.push({ unit: e, type: 'wait', mx: e.x, my: e.y });
      continue;
    }

    /* remove this enemy's current tile from claimed (it's about to move) */
    claimed.delete(`${e.x},${e.y}`);

    /* find best tile to move to: one that lets it attack (closest shot, best
       cover) beats any that doesn't; otherwise the tile with the shortest walk
       to the target */
    const tiles = reachable(e, map, all);
    const [lo, hi] = e.weapon.rng;
    let pick = null, pickScore = Infinity, pickAtk = false;

    for (const t of tiles) {
      /* skip tiles already claimed by another enemy */
      if (claimed.has(`${t.x},${t.y}`)) continue;
      const d = manhattan(t, best);
      const canAtk = d >= lo && d <= hi;
      const cover = map.at(t.x, t.y).def * 0.1;
      const score = (canAtk ? d : distTo(best, t.x, t.y)) - cover;
      if (canAtk && (!pickAtk || score < pickScore))      { pick = t; pickScore = score; pickAtk = true; }
      else if (!canAtk && !pickAtk && score < pickScore)  { pick = t; pickScore = score; }
    }

    if (pick) {
      const d2 = manhattan(pick, best);
      const canAtk = d2 >= lo && d2 <= hi;
      actions.push({ unit: e, type: canAtk ? 'move_attack' : 'move', target: canAtk ? best : null, mx: pick.x, my: pick.y });
      /* claim the destination tile */
      claimed.add(`${pick.x},${pick.y}`);
    } else {
      actions.push({ unit: e, type: 'wait', mx: e.x, my: e.y });
      /* re-claim current position since we didn't move */
      claimed.add(`${e.x},${e.y}`);
    }
  }
  return actions;
}
