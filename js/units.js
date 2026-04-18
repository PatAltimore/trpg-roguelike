import { W_SWORD, W_AXE, W_LANCE, W_BOW, W_FIRE, W_THUNDER, W_DARK, W_STAFF, W_JAVELIN,
         ITEMS, MAX_INVENTORY } from './constants.js';

/* ── Two-word unit name pools ── */

/* Humorous adjectives — heroes sound gallant but slightly ridiculous */
const P_ADJ = [
  'Wobbly','Snoring','Pudgy','Timid','Clumsy','Soggy','Grumpy','Itchy',
  'Pompous','Lanky','Squinting','Fidgety','Bumbling','Drowsy','Portly','Nervous',
  'Sneezing','Hiccuping','Balding','Gassy','Forgetful','Twitchy','Lopsided','Rotund',
  'Mumbling','Freckled','Squabbling','Dizzy','Wheezing','Befuddled',
];

/* Humorous adjectives — villains sound menacing but also a bit absurd */
const E_ADJ = [
  'Festering','Rancid','Malodorous','Bloated','Crusty','Mangy','Pungent','Grimy',
  'Sneering','Splotchy','Toadish','Greasy','Soggy','Mouldy','Wretched','Quivering',
  'Gurgling','Dribbling','Cackling','Flatulent','Belching','Scabby','Lumbering','Snivelling',
  'Wheezing','Lurching','Squelching','Gibbering','Shambling','Blundering',
];

/* Medieval-ish given names — shared pool, unisex */
const ALL_NAMES = [
  'Aldric','Morrigan','Caspian','Isolde','Theron','Elspeth','Gideon','Rowena',
  'Leofric','Seraphine','Oswald','Thessaly','Cormac','Vesper','Aldous','Sigrid',
  'Bramwell','Ondine','Fennick','Calista','Gareth','Nimue','Bertram','Lysander',
  'Edwina','Torben','Celestine','Wolfric','Amaryllis','Godfrey','Perdita','Hawthorn',
  'Eulalia','Merrick','Saoirse','Dunstan','Belphoebe','Radulf','Thessaly','Godwin',
  'Orlaith','Crispin','Elowen','Baldric','Sophronia','Wulfstan','Araminta','Edric',
];

const _usedNames = new Set();

function genName(id, isPlayer, key) {
  if (key === 'WARLORD') return 'Dark Sovereign';
  const adjs = isPlayer ? P_ADJ : E_ADJ;
  const adj  = adjs[Math.floor(Math.random() * adjs.length)];

  /* pick a given name not yet in use this session */
  let name;
  const pool = ALL_NAMES.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  name = pool.find(n => !_usedNames.has(n)) ?? pool[0]; // fallback: reuse if pool exhausted
  _usedNames.add(name);
  return `${adj} ${name}`;
}

export const W_DAGGER = { name: 'Dagger', mt: 3, hit: 95, rng: [1,1], magic: false, tri: 'sword' };

/* ── Class templates ── */
const CLASSES = {
  /* player */
  LORD:    { name:'Lord',    lbl:'L', hue:'#2860f0', w: W_SWORD,   base:{hp:24,str:7,mag:0,skl:8,spd:8,lck:7,def:6,res:3,mov:5}, gr:{hp:60,str:40,mag:5,skl:50,spd:45,lck:40,def:25,res:15} },
  FIGHTER: { name:'Fighter', lbl:'F', hue:'#e06020', w: W_AXE,     base:{hp:30,str:10,mag:0,skl:4,spd:5,lck:3,def:4,res:1,mov:5}, gr:{hp:80,str:60,mag:0,skl:30,spd:30,lck:20,def:20,res:5}  },
  MAGE:    { name:'Mage',    lbl:'M', hue:'#a020e0', w: W_FIRE,    base:{hp:18,str:0,mag:10,skl:6,spd:7,lck:5,def:3,res:8,mov:5}, gr:{hp:40,str:5,mag:65,skl:45,spd:40,lck:25,def:10,res:45} },
  ARCHER:  { name:'Archer',  lbl:'A', hue:'#20a040', w: W_BOW,     base:{hp:22,str:7,mag:0,skl:9,spd:7,lck:5,def:5,res:2,mov:5}, gr:{hp:55,str:40,mag:0,skl:60,spd:40,lck:30,def:20,res:10} },
  HEALER:  { name:'Healer',  lbl:'H', hue:'#f0f060', w: W_STAFF,   base:{hp:16,str:0,mag:8,skl:5,spd:6,lck:8,def:2,res:10,mov:5}, gr:{hp:35,str:0,mag:55,skl:30,spd:35,lck:40,def:5,res:55} },
  CAVALIER:{ name:'Cavalier',lbl:'C', hue:'#30b060', w: W_JAVELIN, base:{hp:26,str:8,mag:0,skl:6,spd:6,lck:4,def:7,res:2,mov:7}, gr:{hp:65,str:45,mag:0,skl:35,spd:35,lck:25,def:25,res:10} },
  KNIGHT:  { name:'Knight',  lbl:'K', hue:'#6080c0', w: W_LANCE,   base:{hp:28,str:9,mag:0,skl:5,spd:3,lck:2,def:12,res:1,mov:4}, gr:{hp:70,str:45,mag:0,skl:25,spd:15,lck:10,def:50,res:5} },
  THIEF:   { name:'Thief',  lbl:'T', hue:'#808040', w: W_DAGGER,  base:{hp:20,str:5,mag:0,skl:10,spd:12,lck:10,def:3,res:4,mov:7}, gr:{hp:45,str:30,mag:0,skl:55,spd:60,lck:50,def:10,res:15}, canSteal: true },
  /* enemy */
  SOLDIER:  { name:'Soldier',  lbl:'S', hue:'#c03030', w: W_LANCE,   base:{hp:22,str:6,mag:0,skl:5,spd:5,lck:3,def:7,res:2,mov:5}, gr:{hp:55,str:35,mag:0,skl:30,spd:30,lck:15,def:30,res:10} },
  BRIGAND:  { name:'Brigand',  lbl:'B', hue:'#904020', w: W_AXE,     base:{hp:28,str:9,mag:0,skl:4,spd:4,lck:2,def:4,res:1,mov:5}, gr:{hp:70,str:55,mag:0,skl:25,spd:25,lck:10,def:20,res:5}  },
  DARK_MAGE:{ name:'D.Mage',  lbl:'D', hue:'#6010a0', w: W_THUNDER, base:{hp:18,str:0,mag:9,skl:5,spd:6,lck:3,def:3,res:6,mov:5}, gr:{hp:40,str:0,mag:60,skl:35,spd:35,lck:15,def:10,res:40} },
  E_ARCHER: { name:'Archer',  lbl:'A', hue:'#a04020', w: W_BOW,     base:{hp:20,str:6,mag:0,skl:7,spd:6,lck:4,def:4,res:2,mov:5}, gr:{hp:50,str:35,mag:0,skl:50,spd:35,lck:20,def:15,res:8}  },
  /* boss */
  WARLORD:  { name:'Warlord', lbl:'W', hue:'#ff1010', w: W_DARK,    base:{hp:45,str:4,mag:14,skl:8,spd:6,lck:5,def:8,res:10,mov:4}, gr:{hp:50,str:10,mag:50,skl:30,spd:20,lck:20,def:30,res:40} },
};

let _id = 0;

export class Unit {
  constructor(key, x, y, isPlayer, level = 1) {
    const c = CLASSES[key];
    this.id = _id++;
    this.key = key;
    this.className = c.name;                      // class name: "Lord", "Fighter", …
    this.name = genName(this.id, isPlayer, key);  // unique two-word name for the log
    this.lbl  = c.lbl;
    this.hue  = c.hue;
    this.weapon = c.w;
    this.isPlayer = isPlayer;
    this.x = x;  this.y = y;
    this.level = level;
    this.moved = false;  this.acted = false;  this.alive = true;
    this.inventory = [];
    this.canSteal = !!c.canSteal;

    const b = c.base, gr = c.gr, lv = level - 1;
    /* growth scaled for a short 5-floor journey (divide by 20 instead of 100) */
    this.maxHp = b.hp  + Math.floor(gr.hp  * lv / 20);
    this.str   = b.str + Math.floor(gr.str * lv / 20);
    this.mag   = b.mag + Math.floor(gr.mag * lv / 20);
    this.skl   = b.skl + Math.floor(gr.skl * lv / 20);
    this.spd   = b.spd + Math.floor(gr.spd * lv / 20);
    this.lck   = b.lck + Math.floor(gr.lck * lv / 20);
    this.def   = b.def + Math.floor(gr.def * lv / 20);
    this.res   = b.res + Math.floor(gr.res * lv / 20);
    this.mov   = b.mov;
    this.hp    = this.maxHp;
  }

  get done() { return this.moved && this.acted; }
  reset()    { this.moved = false; this.acted = false; }

  atk()        { return this.weapon.magic ? this.mag : this.str; }
  defVs(magic) { return magic ? this.res : this.def; }

  takeDmg(d) { this.hp = Math.max(0, this.hp - d); if (!this.hp) this.alive = false; }
}

/* ── Factory helpers ── */
const PLAYER_CLASSES = ['LORD','FIGHTER','MAGE','ARCHER'];
const ENEMY_CLASSES  = ['SOLDIER','BRIGAND','DARK_MAGE','E_ARCHER'];
/* classes available for draft (Lord always included) */
export const DRAFT_POOL = ['FIGHTER','MAGE','ARCHER','HEALER','CAVALIER','KNIGHT','THIEF'];
export const CLASS_INFO = CLASSES; /* expose for UI descriptions */
export function resetNames() { _usedNames.clear(); } /* call at game start so names are fresh */

/*  Difficulty balance table
    ───────────────────────────────────────────────────────
              │  Easy        │  Medium      │  Hard
    ──────────┼──────────────┼──────────────┼──────────────
    Player lv │  floor + 1   │  floor       │  floor
    Enemy  lv │  floor       │  floor       │  floor + 1
    Enemy cnt │  2 + floor   │  3 + floor   │  3 + floor×1.5
    ───────────────────────────────────────────────────────  */

export function spawnParty(spawns, floor, existing, diff = 'easy', roster = null) {
  if (existing && existing.length) {
    /* build a set of occupied positions so every unit lands on a unique tile */
    const occupied = new Set();
    existing.forEach((u, i) => {
      let p = spawns[Math.min(i, spawns.length - 1)];
      /* if this spawn is already taken (shouldn't happen with enough spawns, but be safe),
         search adjacent tiles until we find a free one */
      if (occupied.has(`${p.x},${p.y}`)) {
        const offsets = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
        for (const [ox, oy] of offsets) {
          const nx = p.x + ox, ny = p.y + oy;
          if (!occupied.has(`${nx},${ny}`)) { p = { x: nx, y: ny }; break; }
        }
      }
      occupied.add(`${p.x},${p.y}`);
      u.x = p.x; u.y = p.y;
      u.alive = true;
      u.reset();
    });
    return existing;
  }
  const lvBonus = diff === 'easy' ? 1 : 0;
  const classes = roster || PLAYER_CLASSES;
  return classes.slice(0, Math.min(classes.length, spawns.length))
    .map((k, i) => {
      const u = new Unit(k, spawns[i].x, spawns[i].y, true, Math.max(1, floor + lvBonus));
      u.inventory.push({ ...ITEMS.POTION });
      return u;
    });
}

export function spawnEnemies(spawns, floor, diff = 'easy') {
  const countBase = diff === 'easy'   ? 2 + floor
                  : diff === 'medium' ? 3 + floor
                  :                     3 + Math.floor(floor * 1.5);
  const count = Math.min(spawns.length, countBase);
  const lvBonus = diff === 'hard' ? 1 : 0;
  return spawns.slice(0, count).map((p, i) => {
    const lv = Math.max(1, floor + lvBonus);
    /* tutorial spawns can specify exact class */
    const cls = p.cls || ENEMY_CLASSES[i % ENEMY_CLASSES.length];
    const u = new Unit(cls, p.x, p.y, false, lv);
    /* boss units are always aggressive */
    if (cls === 'WARLORD') u._ai = 'aggressive';
    /* tutorial: first enemy always carries a Vulnerary to teach drops */
    if (floor === 0 && i === 0) {
      u.inventory.push({ ...ITEMS.VULNERARY });
    } else if (Math.random() < 0.4) {
      /* ~40% chance to carry a droppable item */
      const pool = [ITEMS.POTION, ITEMS.VULNERARY, ITEMS.STRENGTH_TOME, ITEMS.SPEED_TOME, ITEMS.SHIELD];
      u.inventory.push({ ...pool[Math.floor(Math.random() * pool.length)] });
    }
    return u;
  });
}
