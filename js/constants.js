export const TILE = 40;
export const COLS = 20;
export const ROWS = 15;
export const SIDEBAR_W = 224;
export const CANVAS_W = COLS * TILE + SIDEBAR_W;
export const CANVAS_H = ROWS * TILE;

/* ── Terrain ── */
export const T_PLAIN    = { id: 0, name: 'Plain',    color: '#5a8a20', cost: 1, def: 0, avo: 0  };
export const T_FOREST   = { id: 1, name: 'Forest',   color: '#2d5a27', cost: 2, def: 1, avo: 15 };
export const T_MOUNTAIN = { id: 2, name: 'Mountain', color: '#8a8070', cost: 99, def: 0, avo: 0  };
export const T_WATER    = { id: 3, name: 'Water',    color: '#1a4a8a', cost: 99, def: 0, avo: 0  };
export const T_WALL     = { id: 4, name: 'Wall',     color: '#303038', cost: 99, def: 0, avo: 0  };
export const T_ROAD     = { id: 5, name: 'Road',     color: '#c8a870', cost: 1,  def: 0, avo: 0  };
export const T_FORT     = { id: 6, name: 'Fort',     color: '#8a6a30', cost: 1,  def: 2, avo: 20, heal: 10 };

/* ── Weapons ── */
export const W_SWORD   = { name: 'Sword',   mt: 5, hit: 90, rng: [1,1], magic: false, tri: 'sword' };
export const W_AXE     = { name: 'Axe',     mt: 8, hit: 70, rng: [1,1], magic: false, tri: 'axe'   };
export const W_LANCE   = { name: 'Lance',   mt: 6, hit: 80, rng: [1,1], magic: false, tri: 'lance' };
export const W_BOW     = { name: 'Bow',     mt: 6, hit: 85, rng: [2,2], magic: false, tri: null    };
export const W_FIRE    = { name: 'Fire',    mt: 5, hit: 80, rng: [1,2], magic: true,  tri: null    };
export const W_THUNDER = { name: 'Thunder', mt: 8, hit: 65, rng: [1,2], magic: true,  tri: null    };
export const W_DARK    = { name: 'Dark',    mt:10, hit: 75, rng: [1,2], magic: true,  tri: null    };
export const W_STAFF   = { name: 'Staff',   mt: 0, hit:100, rng: [1,1], magic: true,  tri: null, heal: true };
export const W_JAVELIN = { name: 'Javelin', mt: 5, hit: 75, rng: [1,2], magic: false, tri: 'lance' };

/* Weapon triangle: sword > axe > lance > sword */
export const TRI = { sword: { strong: 'axe', weak: 'lance' },
                     axe:   { strong: 'lance', weak: 'sword' },
                     lance: { strong: 'sword', weak: 'axe' } };
export const TRI_HIT = 15;
export const TRI_DMG = 1;

/* ── Items ── */
export const ITEMS = {
  POTION:       { name: 'Potion',       type: 'consumable', effect: 'heal_full',  desc: 'Restores all HP' },
  VULNERARY:    { name: 'Vulnerary',    type: 'consumable', effect: 'heal_half',  desc: 'Restores 50% HP' },
  STRENGTH_TOME:{ name: 'Str Tonic',    type: 'consumable', effect: 'str_boost',  desc: '+3 STR this floor' },
  SPEED_TOME:   { name: 'Spd Tonic',    type: 'consumable', effect: 'spd_boost',  desc: '+3 SPD this floor' },
  SHIELD:       { name: 'Shield',       type: 'consumable', effect: 'def_boost',  desc: '+3 DEF this floor' },
};

/* Weapons that can drop as items (equippable) */
export const WEAPON_ITEMS = {
  IRON_SWORD:  { name: 'Iron Sword',  type: 'weapon', weapon: 'W_SWORD' },
  IRON_AXE:    { name: 'Iron Axe',    type: 'weapon', weapon: 'W_AXE' },
  IRON_LANCE:  { name: 'Iron Lance',  type: 'weapon', weapon: 'W_LANCE' },
  IRON_BOW:    { name: 'Iron Bow',    type: 'weapon', weapon: 'W_BOW' },
  FIRE_TOME:   { name: 'Fire Tome',   type: 'weapon', weapon: 'W_FIRE' },
  JAVELIN_ITEM:{ name: 'Javelin',     type: 'weapon', weapon: 'W_JAVELIN' },
};

/* map weapon item keys to actual weapon objects */
export const WEAPON_MAP = {
  W_SWORD: W_SWORD, W_AXE: W_AXE, W_LANCE: W_LANCE,
  W_BOW: W_BOW, W_FIRE: W_FIRE, W_JAVELIN: W_JAVELIN,
};

export const MAX_INVENTORY = 4;

/* ── Game states ── */
export const S_TITLE        = 0;
export const S_IDLE         = 1;
export const S_UNIT_SEL     = 2;
export const S_ACTION_MENU  = 3;
export const S_ATK_SELECT   = 4;
export const S_COMBAT_ANIM  = 5;
export const S_ENEMY_TURN   = 6;
export const S_WIN          = 7;
export const S_LOSE         = 8;
export const S_TRANS_OUT    = 9;   // units marching off-screen
export const S_TRANS_IN     = 10;  // units marching on-screen
export const S_VICTORY      = 11;  // final victory screen
export const S_DRAFT        = 12;  // team selection before run
export const S_BONUS        = 13;  // post-floor reward choice

/* ── Journey structure ── */
export const FINAL_FLOOR    = 4;   // boss level — last floor of the journey

/* ── Palette ── */
export const C = {
  PLAYER:    '#2060e0',
  PLAYER_DONE:'#506880',
  ENEMY:     '#e02020',
  MOVE_HL:   'rgba(60,120,255,0.30)',
  ATK_HL:    'rgba(255,40,40,0.45)',
  CURSOR:    '#ffff00',
  SIDE_BG:   '#0d0d1a',
  SIDE_BD:   '#4040a0',
  TXT:       '#e8e8e8',
  GOLD:      '#ffd700',
  HP_BG:     '#400000',
  HP_OK:     '#00e000',
  HP_MID:    '#e0a000',
  HP_LOW:    '#e00000',
};
