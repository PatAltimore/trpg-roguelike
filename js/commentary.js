/* ═══════════ Battle commentary ═══════════
   Turns a resolved strike into a line of play-by-play for the play log and
   the floating battle text. Templates use {a} attacker, {d} defender and
   {sev} for a description of how hard the blow landed. */

/* how hard a blow landed, as a share of the defender's max HP */
const SEVERITY = [
  [0.15, ['a glancing blow', 'a light nick', 'a quick jab', 'a scratch']],
  [0.30, ['a solid hit', 'a clean blow', 'a firm strike', 'a direct blow']],
  [0.50, ['a heavy blow', 'a punishing strike', 'a hard hit', 'a brutal swing']],
  [Infinity, ['a crushing strike', 'a devastating blow', 'a bone-rattling hit', 'a thunderous smash']],
];

const LINES = {
  /* the attacker's first strike */
  strike: [
    '{a} strikes {d} with {sev}!',
    '{a} lunges at {d} and lands {sev}!',
    '{a} charges {d} with {sev}!',
    '{a} takes a swing at {d}, {sev}!',
    '{a} sizes up {d} and delivers {sev}!',
    '{a} leaps into the fray, hitting {d} with {sev}!',
    '{a} finds an opening and gives {d} {sev}!',
  ],
  /* the defender hitting back */
  counter: [
    '{a} counters with {sev}!',
    '{a} hits back at {d} with {sev}!',
    '{a} answers in kind with {sev}!',
    '{a} refuses to yield and returns {sev}!',
    '{a} shrugs it off and counters with {sev}!',
    '{a} snaps back at {d} with {sev}!',
  ],
  /* a second strike from the same fighter */
  follow: [
    '{a} strikes again with {sev}!',
    '{a} is too quick for {d} and lands {sev}!',
    '{a} presses the attack with {sev}!',
    '{a} gives {d} no time to recover, {sev}!',
    '{a} follows up with {sev}!',
  ],
  /* a hit that does no damage */
  bounce: [
    '{a} strikes {d}, but the blow glances harmlessly off!',
    '{a} lands a hit, yet {d} barely notices!',
    "{d} shrugs off {a}'s attack without a scratch!",
    "{a}'s strike clangs off {d}'s defences!",
  ],
  missStrike: [
    '{a} swings at {d} and hits only air!',
    '{a} lunges, but {d} slips away!',
    '{d} nimbly dodges {a}!',
    '{a} misses {d} by a whisker!',
    '{a} overreaches and stumbles past {d}!',
    "{d} sidesteps {a}'s attack!",
  ],
  missCounter: [
    '{a} counters, but {d} ducks under it!',
    "{a}'s counter goes wide!",
    '{a} hits back, but {d} is already gone!',
    '{a} snaps back and misses {d} entirely!',
  ],
  missFollow: [
    '{a} tries again, but {d} sidesteps!',
    "{a}'s second swing whistles past {d}!",
    '{a} presses on, but {d} keeps out of reach!',
  ],
  crit: [
    'CRITICAL! {a} lands a devastating blow on {d}!',
    "{a} finds a gap in {d}'s guard, critical hit!",
    '{a} unleashes a brutal strike on {d}!',
    'A perfect strike! {a} crits {d}!',
    '{a} hits {d} right where it hurts, critical!',
  ],
  falls: [
    '{u} falls!',
    '{u} crumples to the ground!',
    '{u} has been defeated!',
    '{u} is down and out!',
    '{u} collapses and does not rise!',
  ],
};

/* avoid saying the same thing twice running */
const lastIdx = {};
function pick(key, list) {
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === lastIdx[key]) i = (i + 1) % list.length;
  lastIdx[key] = i;
  return list[i];
}

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
}

function severity(dmg, maxHp) {
  const share = dmg / Math.max(1, maxHp);
  const [, words] = SEVERITY.find(([limit]) => share < limit);
  return pick('sev' + words[0], words);
}

/**
 * Commentary for one strike.
 *   entry    - a combat log entry {src, tgt, dmg, hit, crit}
 *   earlier  - the entries that came before it in the same fight
 *   attacker - whoever started the fight
 */
export function strikeLine(entry, earlier, attacker) {
  const again = earlier.some(e => e.src === entry.src);
  const role = again ? 'Follow' : entry.src === attacker ? 'Strike' : 'Counter';
  const vars = { a: entry.src.name, d: entry.tgt.name };

  if (!entry.hit) return fill(pick('miss' + role, LINES['miss' + role]), vars);
  if (entry.dmg <= 0) return fill(pick('bounce', LINES.bounce), vars);

  const body = entry.crit
    ? fill(pick('crit', LINES.crit), vars)
    : fill(pick(role, LINES[role.toLowerCase()]), { ...vars, sev: severity(entry.dmg, entry.tgt.maxHp) });
  return `${body} (${entry.dmg})`;
}

export function fallsLine(unit) {
  return fill(pick('falls', LINES.falls), { u: unit.name });
}
