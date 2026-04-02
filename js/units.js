import { W_SWORD, W_AXE, W_LANCE, W_BOW, W_FIRE, W_THUNDER, W_DARK } from './constants.js';

/* ── Class templates ── */
const CLASSES = {
  /* player */
  LORD:    { name:'Lord',    lbl:'L', hue:'#2860f0', w: W_SWORD,   base:{hp:24,str:7,mag:0,skl:8,spd:8,lck:7,def:6,res:3,mov:5}, gr:{hp:60,str:40,mag:5,skl:50,spd:45,lck:40,def:25,res:15} },
  FIGHTER: { name:'Fighter', lbl:'F', hue:'#e06020', w: W_AXE,     base:{hp:30,str:10,mag:0,skl:4,spd:5,lck:3,def:4,res:1,mov:5}, gr:{hp:80,str:60,mag:0,skl:30,spd:30,lck:20,def:20,res:5}  },
  MAGE:    { name:'Mage',    lbl:'M', hue:'#a020e0', w: W_FIRE,    base:{hp:18,str:0,mag:10,skl:6,spd:7,lck:5,def:3,res:8,mov:5}, gr:{hp:40,str:5,mag:65,skl:45,spd:40,lck:25,def:10,res:45} },
  ARCHER:  { name:'Archer',  lbl:'A', hue:'#20a040', w: W_BOW,     base:{hp:22,str:7,mag:0,skl:9,spd:7,lck:5,def:5,res:2,mov:5}, gr:{hp:55,str:40,mag:0,skl:60,spd:40,lck:30,def:20,res:10} },
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
    this.name = c.name;
    this.lbl  = c.lbl;
    this.hue  = c.hue;
    this.weapon = c.w;
    this.isPlayer = isPlayer;
    this.x = x;  this.y = y;
    this.level = level;
    this.moved = false;  this.acted = false;  this.alive = true;

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

export function spawnParty(spawns, floor, existing) {
  if (existing && existing.length) {
    existing.forEach((u, i) => {
      const p = spawns[i % spawns.length];
      u.x = p.x; u.y = p.y; u.reset();
    });
    return existing;
  }
  return PLAYER_CLASSES.slice(0, Math.min(4, spawns.length))
    .map((k, i) => new Unit(k, spawns[i].x, spawns[i].y, true, Math.max(1, floor + 1)));
}

export function spawnEnemies(spawns, floor) {
  const count = Math.min(spawns.length, 2 + floor);
  return spawns.slice(0, count).map((p, i) => {
    const lv = Math.max(1, floor);
    /* tutorial spawns can specify exact class */
    const cls = p.cls || ENEMY_CLASSES[i % ENEMY_CLASSES.length];
    return new Unit(cls, p.x, p.y, false, lv);
  });
}
