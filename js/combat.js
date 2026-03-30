import { TRI, TRI_HIT, TRI_DMG } from './constants.js';

function triBonus(atk, def) {
  const a = atk.weapon.tri, d = def.weapon.tri;
  if (!a || !d || !TRI[a]) return { hit: 0, dmg: 0 };
  if (TRI[a].strong === d) return { hit:  TRI_HIT, dmg:  TRI_DMG };
  if (TRI[a].weak   === d) return { hit: -TRI_HIT, dmg: -TRI_DMG };
  return { hit: 0, dmg: 0 };
}

export function forecast(atk, def, defTerrain) {
  const t = triBonus(atk, def);
  const hitRaw  = atk.weapon.hit + atk.skl * 2 + Math.floor(atk.lck / 2) + t.hit;
  const avoRaw  = def.spd * 2 + Math.floor(def.lck / 2) + (defTerrain?.avo || 0);
  const hit     = Math.min(100, Math.max(0, hitRaw - avoRaw));

  const pow     = atk.atk() + atk.weapon.mt + t.dmg;
  const prot    = def.defVs(atk.weapon.magic) + (defTerrain?.def || 0);
  const dmg     = Math.max(0, pow - prot);

  const crit    = Math.max(0, Math.floor(atk.skl / 2) - def.lck);
  const doubles = atk.spd >= def.spd + 4;

  return { hit, dmg, crit, doubles };
}

export function canCounter(atk, def) {
  const d = Math.abs(atk.x - def.x) + Math.abs(atk.y - def.y);
  return d >= def.weapon.rng[0] && d <= def.weapon.rng[1];
}

export function inRange(unit, tx, ty) {
  const d = Math.abs(unit.x - tx) + Math.abs(unit.y - ty);
  return d >= unit.weapon.rng[0] && d <= unit.weapon.rng[1];
}

/* run one side's attack (possibly x2) */
function strike(atk, def, terrain, log) {
  const f = forecast(atk, def, terrain);
  const doOne = () => {
    const hit  = Math.random() * 100 < f.hit;
    const crit = hit && Math.random() * 100 < f.crit;
    const d    = hit ? (crit ? f.dmg * 3 : f.dmg) : 0;
    if (d) def.takeDmg(d);
    log.push({ src: atk, tgt: def, dmg: d, hit, crit });
  };
  doOne();
  if (f.doubles && def.alive) doOne();
}

export function resolve(atk, def, atkTerrain, defTerrain) {
  const log = [];
  strike(atk, def, defTerrain, log);
  if (def.alive && canCounter(atk, def)) strike(def, atk, atkTerrain, log);
  return log;
}
