import { reachable } from './map.js';
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

  for (const e of enemies) {
    if (!e.alive) continue;
    if (!alive.length) break;

    /* nearest player */
    let best = null, bestD = Infinity;
    for (const p of alive) {
      const d = Math.abs(e.x - p.x) + Math.abs(e.y - p.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) { actions.push({ unit: e, type: 'wait' }); continue; }

    /* determine AI mode: guard or aggressive */
    const threatRange = e.mov + e.weapon.rng[1];
    const isAggressive = e._ai === 'aggressive'   // explicitly set (bosses)
                      || bestD <= threatRange + 2; // player is nearby (within threat range + small buffer)

    /* can attack without moving? always take the shot */
    if (inRange(e, best.x, best.y)) {
      actions.push({ unit: e, type: 'attack', target: best, mx: e.x, my: e.y });
      continue;
    }

    /* guard mode: stay put if no player is in threat range */
    if (!isAggressive) {
      actions.push({ unit: e, type: 'wait', mx: e.x, my: e.y });
      continue;
    }

    /* remove this enemy's current tile from claimed (it's about to move) */
    claimed.delete(`${e.x},${e.y}`);

    /* find best tile to move to */
    const tiles = reachable(e, map, all);
    let pick = null, pickD = Infinity, pickAtk = false;

    for (const t of tiles) {
      /* skip tiles already claimed by another enemy */
      if (claimed.has(`${t.x},${t.y}`)) continue;
      const d = Math.abs(t.x - best.x) + Math.abs(t.y - best.y);
      const [lo, hi] = e.weapon.rng;
      const canAtk = d >= lo && d <= hi;
      if (canAtk && (!pickAtk || d < pickD)) { pick = t; pickD = d; pickAtk = true; }
      else if (!pickAtk && d < pickD)         { pick = t; pickD = d; }
    }

    if (pick) {
      const d2 = Math.abs(pick.x - best.x) + Math.abs(pick.y - best.y);
      const [lo, hi] = e.weapon.rng;
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
