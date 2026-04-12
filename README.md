# Emblem Tactics – Roguelike TRPG

A tactical RPG with procedurally generated levels, inspired by Fire Emblem and roguelike games. Built with pure HTML5 Canvas and JavaScript — no dependencies.

## Gameplay

- **Tactical combat** on a grid-based map with turn-based player/enemy phases
- **Procedural levels** generated via BSP (Binary Space Partitioning) — every floor is different
- **Weapon triangle**: Sword > Axe > Lance > Sword (hit/damage bonuses)
- **Team draft**: Choose 3 units from 7 classes to join your Lord before each run
- **Inventory system**: Units carry items — potions, tonics, and enemy loot drops
- **Post-floor bonuses**: After each floor, choose a reward (recruit, strengthen, or fortify)
- **Terrain effects**: Forests (+DEF/AVO), Forts (heal + DEF/AVO), Roads, Mountains, Water
- **Combat system**: Hit%, damage, critical hits, double attacks (speed-based), counter-attacks
- **Enemy AI**: Mix of aggressive and guard-mode enemies with threat range awareness

## Classes

### Player Classes
| Class | Weapon | Range | Specialty |
|-------|--------|-------|-----------|
| Lord | Sword | 1 | Balanced leader — if the Lord falls, it's game over |
| Fighter | Axe | 1 | High HP & STR, slow but hits hard |
| Mage | Fire | 1-2 | Ranged magic, fragile but strong vs RES |
| Archer | Bow | 2 | High SKL, no melee capability |
| Healer | Staff | 1 | Heals allies instead of attacking |
| Cavalier | Javelin | 1-2 | High MOV (7), balanced melee/ranged |
| Knight | Lance | 1 | Massive DEF, low SPD — a wall |
| Thief | Dagger | 1 | Fast & lucky, can steal items from enemies |

### Enemy Types
| Class | Weapon | Notes |
|-------|--------|-------|
| Soldier | Lance | Balanced frontline |
| Brigand | Axe | High STR bruiser |
| Dark Mage | Thunder | Ranged magic attacker |
| Archer | Bow | Range 2 threat |
| Warlord | Dark | Final boss — always aggressive |

## Inventory & Items

Every unit starts with a **Potion** (full HP restore). Enemies may carry items that drop as loot when defeated — move onto the glowing chest to pick them up.

| Item | Effect |
|------|--------|
| Potion | Restores all HP |
| Vulnerary | Restores 50% HP |
| Str Tonic | +3 STR for the floor |
| Spd Tonic | +3 SPD for the floor |
| Shield | +3 DEF for the floor |

- Use items via the **ITEM** option in the action menu (consumes your turn)
- **Thief** units can **STEAL** items from adjacent enemies (SPD-based success chance)
- Max 4 items per unit

## How to Play

1. **Draft your team** — pick 3 classes to join your Lord
2. **Select** a blue player unit by clicking it
3. **Move** by clicking a highlighted (blue) tile
4. **Choose action**: Attack, Heal, Steal, Item, or Wait
5. When attacking, hover over enemies to see the **combat forecast**
6. Click **END TURN** when all units have acted
7. Survive the enemy phase and repeat!
8. **Click enemies** in idle mode to inspect their move/attack ranges
9. **Clear floors** to choose a bonus reward and advance

### Tips
- HP does **not** auto-heal between floors — use Healers, Forts, Potions, or choose the Fortify bonus
- Weapon triangle gives +15 hit and +1 damage when you have advantage
- Forests grant DEF+1 and AVO+15 — use them for cover
- Forts grant DEF+2, AVO+20, and heal 10% HP each turn
- Units with 4+ more SPD than the defender attack twice

## Running Locally

Serve the project root with any static HTTP server:

```bash
# Python (with cache-busting)
python server.py

# Or any static server
python -m http.server 8080
npx serve -l 8080
```

Then open `http://localhost:8080` in a browser.

## Deploy to Azure Static Web Apps

1. Create an **Azure Static Web App** resource in the Azure portal
2. Connect it to this GitHub repository
3. Set the following build configuration:
   - **App location**: `/`
   - **Output location**: `/`
   - **API location**: *(leave empty)*
4. Azure will auto-deploy on every push via GitHub Actions

The `staticwebapp.config.json` is already configured for routing.

## Tech Stack

- HTML5 Canvas for rendering (8-bit pixel art style)
- Vanilla ES Modules (no build step, no dependencies)
- Web Audio API for procedural 8-bit sound effects
- Press Start 2P font for retro aesthetics
- BSP tree algorithm for procedural dungeon generation
- Touch support with pinch-zoom and pan for mobile
