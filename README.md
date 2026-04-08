# Emblem Tactics – Roguelike TRPG

A tactical RPG with procedurally generated levels, inspired by Fire Emblem and roguelike games. Built with pure HTML5 Canvas and JavaScript — no dependencies.

## Gameplay

- **Tactical combat** on a grid-based map with turn-based player/enemy phases
- **Procedural levels** generated via BSP (Binary Space Partitioning) — every floor is different
- **Weapon triangle**: Sword > Axe > Lance > Sword (hit/damage bonuses)
- **4 player classes**: Lord (sword), Fighter (axe), Mage (fire magic), Archer (bow)
- **4 enemy types**: Soldier (lance), Brigand (axe), Dark Mage (thunder), Archer (bow)
- **Terrain effects**: Forests (+DEF/AVO), Forts (heal + DEF/AVO), Roads, Mountains, Water
- **Combat system**: Hit%, damage, critical hits, double attacks (speed-based), counter-attacks

## How to Play

1. **Select** a blue player unit by clicking it
2. **Move** by clicking a highlighted (blue) tile
3. **Choose action**: Attack (if enemy in range) or Wait
4. When attacking, hover over enemies to see the **combat forecast**
5. Click **END TURN** when all units have acted
6. Survive the enemy phase and repeat!

## Running Locally

Serve the project root with any static HTTP server:

```bash
# Python
python -m http.server 8080

# Node.js (npx)
npx serve -l 8080

# VS Code Live Server extension also works
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
- Press Start 2P font for retro aesthetics
- BSP tree algorithm for procedural dungeon generation
