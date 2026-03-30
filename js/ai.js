import { reachable } from './map.js';
import { inRange } from './combat.js';

export function planEnemyTurn(enemies, players, map) {
  const all = [...enemies, ...players];
  const actions = [];

  for (const e of enemies) {
    if (!e.alive) continue;
    const alive = players.filter(p => p.alive);
    if (!alive.length) break;

    /* nearest player */
    let best = null, bestD = Infinity;
    for (const p of alive) {
      const d = Math.abs(e.x - p.x) + Math.abs(e.y - p.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) { actions.push({ unit: e, type: 'wait' }); continue; }

    /* can attack without moving? */
    if (inRange(e, best.x, best.y)) {
      actions.push({ unit: e, type: 'attack', target: best, mx: e.x, my: e.y });
      continue;
    }

    /* find tile to move to */
    const tiles = reachable(e, map, all);
    let pick = null, pickD = Infinity, pickAtk = false;

    for (const t of tiles) {
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
    } else {
      actions.push({ unit: e, type: 'wait', mx: e.x, my: e.y });
    }
  }
  return actions;
}
