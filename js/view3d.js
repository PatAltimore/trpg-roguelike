/* ═══════════ 3D ISOMETRIC VIEW ═══════════
   An alternative to the flat 2D map: the same battlefield drawn as a low-poly
   diorama (three.js, orthographic camera at the classic isometric angle).

   It is view-only. A WebGL canvas sits directly under the 2D game canvas and
   covers exactly the map rectangle, so the 2D canvas keeps drawing everything
   else on top of it (info pane, menus, battle text, banners) and still receives
   all clicks. The renderer feeds this class the game state each frame; clicks
   are turned back into tiles with pick().

   World space: map x -> world x, map y -> world z, 1 tile = 1 unit, y is up. */

import { TILE, COLS, ROWS,
  T_PLAIN, T_FOREST, T_MOUNTAIN, T_WATER, T_WALL, T_ROAD, T_FORT,
  T_HILL, T_SWAMP, T_FORD, T_BRIDGE } from './constants.js';

const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

let threePromise = null;
export function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (!threePromise) {
    threePromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = THREE_URL;
      s.async = true;
      s.onload = () => window.THREE ? resolve(window.THREE) : reject(new Error('three.js did not initialise'));
      s.onerror = () => { threePromise = null; reject(new Error('three.js failed to load')); };
      document.head.appendChild(s);
    });
  }
  return threePromise;
}

const MAP_W = COLS * TILE, MAP_H = ROWS * TILE;
const PITCH = 0.6155;               // true isometric elevation (35.26 degrees)
const MIN_PITCH = 0.3, MAX_PITCH = 1.3;
const MIN_ZOOM = 0.8, MAX_ZOOM = 4;
const FOV = 30;          // degrees: narrow, so it reads as isometric-ish but edges converge naturally
const CAM_DIST = 28;     // camera distance from the point it looks at
const BASE_AZIMUTH = Math.PI * 0.75; // camera sits at -x / +z: the player's side is bottom-left

/* height of the standing surface on each terrain, in tiles */
const SURF = new Map([
  [T_PLAIN, 0.25], [T_FOREST, 0.25], [T_MOUNTAIN, 0.25], [T_WATER, 0.12], [T_WALL, 0.6],
  [T_ROAD, 0.22], [T_FORT, 0.3], [T_HILL, 0.78], [T_SWAMP, 0.18], [T_FORD, 0.14], [T_BRIDGE, 0.28],
]);

const HELM = { LORD:'#c0a000', FIGHTER:'#808080', MAGE:'#a000c0', ARCHER:'#206040',
               HEALER:'#e0e040', CAVALIER:'#208040', KNIGHT:'#4060a0', THIEF:'#606020',
               SOLDIER:'#804040', BRIGAND:'#604020', DARK_MAGE:'#300060', E_ARCHER:'#604040',
               WARLORD:'#ff0000' };
const WEAPON = { LORD:'sword', FIGHTER:'axe', MAGE:'staff', ARCHER:'bow', HEALER:'staff',
                 CAVALIER:'lance', KNIGHT:'lance', THIEF:'dagger', SOLDIER:'lance',
                 BRIGAND:'axe', DARK_MAGE:'staff', E_ARCHER:'bow', WARLORD:'staff' };
const ORB = { MAGE:'#ff7030', HEALER:'#fff080', DARK_MAGE:'#b040ff', WARLORD:'#ff2020' };

const TREE_SLOTS = [[-0.22, -0.2], [0.22, -0.12], [-0.04, 0.24], [0.26, 0.26], [-0.27, 0.22]];

function rnd(x, y, k) {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(k + 1, 1103515245);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class View3D {
  constructor(T, sibling) {
    this.T = T;
    this.cv2d = sibling;
    this.renderer = new T.WebGLRenderer({ antialias: true });   // throws without WebGL
    this.canvas = this.renderer.domElement;
    this.canvas.id = 'view3d';
    this.canvas.style.cssText =
      `width:${MAP_W}px;height:${MAP_H}px;pointer-events:none;image-rendering:auto;` +
      'transform-origin:0 0;display:none;';
    sibling.parentElement.insertBefore(this.canvas, sibling);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;

    this.scene = new T.Scene();
    this.scene.background = new T.Color('#1b3a5e');
    this.camera = new T.PerspectiveCamera(FOV, MAP_W / MAP_H, 1, 400);
    this._pr = 0;
    this._tf = null;
    this._setRes(1);

    this.scene.add(new T.AmbientLight(0xe8e0ff, 0.62));
    const sun = new T.DirectionalLight(0xffe6c0, 0.74);
    sun.position.set(COLS / 2 - 7, 14, ROWS / 2 + 9);
    sun.target.position.set(COLS / 2, 0, ROWS / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -13; sc.right = 13; sc.top = 13; sc.bottom = -13; sc.near = 1; sc.far = 40;
    sun.shadow.bias = -0.0008;
    this.scene.add(sun, sun.target);

    this.mapGroup = null;
    this.map = null;
    this.pickables = [];
    this.tileTags = [];
    this.surf = [];
    this.water = [];
    this._mapMats = [];
    this.units = new Map();
    this.items = [];
    this.matCache = new Map();
    /* cel shading: light falls into a few flat bands instead of a smooth gradient */
    const ramp = new T.DataTexture(new Uint8Array([70, 150, 215, 255]), 4, 1, T.LuminanceFormat);
    ramp.minFilter = ramp.magFilter = T.NearestFilter;
    ramp.generateMipmaps = false;
    ramp.needsUpdate = true;
    this.toon = ramp;
    this.ink = new T.MeshBasicMaterial({ color: '#0d0a1c', side: T.BackSide });   // outline: an inflated back-face shell
    this.shared = this._sharedGeos();

    this.yaw = 0; this.yawT = 0;     // board rotation (radians); yawT is where it is easing to
    this.pitch = PITCH;              // camera elevation
    this.zoom = 1;                   // 1 = whole board in view
    this.panV = { x: 0, z: 0 };      // pan: how far the look-at point is from the board's centre (world units)
    this.fwd = new T.Vector3();
    this.shown = false;
    this._last = performance.now();
    this.ray = new T.Raycaster();
    this.tmp = new T.Vector3();

    this._buildOverlays();
    this._buildSky();
  }

  /* ───────── resolution / visibility ───────── */
  _setRes(zoom) {
    const pr = Math.min(2.5, Math.max(1, zoom * (window.devicePixelRatio || 1)));
    if (pr === this._pr) return;
    this._pr = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(MAP_W, MAP_H, false);
  }

  show(on) {
    if (on === this.shown) return;
    this.shown = on;
    this.canvas.style.display = on ? 'block' : 'none';
  }

  /* the 3D canvas always mirrors the 2D canvas' pan/zoom transform */
  _syncTransform() {
    const tf = this.cv2d.style.transform;
    if (tf === this._tf) return;
    this._tf = tf;
    this.canvas.style.transform = tf;
    const m = /scale\(([\d.]+)\)/.exec(tf || '');
    this._setRes(m ? parseFloat(m[1]) : 1);
  }

  /* ───────── view controls ───────── */
  /* a quarter turn, snapping to the nearest quarter first if dragged off-axis */
  rotate(dir) {
    const q = Math.PI / 2;
    this.yawT = (Math.round(this.yawT / q) + dir) * q;
  }

  tilt(dir) { this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.pitch + dir * 0.12)); }

  /* free rotation while dragging: dx turns the board, dy tilts the camera */
  drag(dx, dy) {
    this.yaw += dx * 0.008;
    this.yawT = this.yaw;
    this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.pitch + dy * 0.004));
  }

  /* world units per canvas pixel at the point the camera looks at */
  _worldPerPx() {
    return 2 * CAM_DIST * Math.tan(FOV * Math.PI / 360) / this.zoom / MAP_H;
  }

  /* slide the view; dx, dy in canvas pixels. The board follows the mouse. */
  pan(dx, dy) {
    const a = BASE_AZIMUTH + this.yaw, u = this._worldPerPx();
    const fx = -Math.cos(a), fz = -Math.sin(a);               // ground direction away from the camera
    const rx = Math.sin(a), rz = -Math.cos(a);                // ground direction to the screen's right
    const ahead = dy * u / Math.sin(this.pitch);
    this.panV.x += -rx * dx * u + fx * ahead;
    this.panV.z += -rz * dx * u + fz * ahead;
  }

  zoomBy(f) { this.zoomAt(f, MAP_W / 2, MAP_H / 2); }

  /* the point on the ground plane under a canvas pixel, or null */
  _ground(px, py) {
    this.ray.setFromCamera({ x: px / MAP_W * 2 - 1, y: -(py / MAP_H * 2 - 1) }, this.camera);
    const { origin, direction } = this.ray.ray;
    if (Math.abs(direction.y) < 1e-6) return null;
    const t = (0.3 - origin.y) / direction.y;
    return t > 0 ? { x: origin.x + direction.x * t, z: origin.z + direction.z * t } : null;
  }

  /* zoom keeping the point under pixel (px, py) where it is */
  zoomAt(f, px, py) {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * f));
    if (z === this.zoom) return;
    const before = this._ground(px, py);
    this.zoom = this.camera.zoom = z;
    this.camera.updateProjectionMatrix();
    const after = this._ground(px, py);
    if (before && after) {
      this.panV.x += before.x - after.x;
      this.panV.z += before.z - after.z;
    }
  }

  reset() {
    const turn = Math.PI * 2;
    this.yaw -= Math.round(this.yaw / turn) * turn;      // take the short way round
    this.yawT = 0;
    this.pitch = PITCH;
    this.zoom = 1;
    this.panV = { x: 0, z: 0 };
  }

  /* ───────── materials / geometry helpers ───────── */
  _sharedGeos() {
    const T = this.T;
    return {
      box:  new T.BoxGeometry(1, 1, 1),
      cyl:  new T.CylinderGeometry(1, 1, 1, 10),
      cyl6: new T.CylinderGeometry(1, 1, 1, 6),
      sph:  new T.SphereGeometry(1, 12, 8),
      dome: new T.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      cone: this._flat(new T.ConeGeometry(1, 1, 5)),
      cone8: new T.ConeGeometry(1, 1, 8),
      ring: new T.RingGeometry(0.42, 0.5, 28),
      disc: new T.CircleGeometry(1, 20),
      plane: new T.PlaneGeometry(1, 1),
    };
  }

  _flat(geo) {
    const g = geo.toNonIndexed();
    g.computeVertexNormals();
    return g;
  }

  /* cel-shaded material, cached by colour (+ optional lightness variant) */
  mat(hex, shade = 0, opts = null) {
    const key = `${hex}|${shade}|${opts ? JSON.stringify(opts) : ''}`;
    let m = this.matCache.get(key);
    if (!m) {
      const c = new this.T.Color(hex);
      if (shade) c.offsetHSL(0, 0, shade * 0.03);
      m = new this.T.MeshToonMaterial(Object.assign({ color: c, gradientMap: this.toon }, opts || {}));
      this.matCache.set(key, m);
    }
    return m;
  }

  _mesh(geo, material, sx, sy, sz, px, py, pz) {
    const m = new this.T.Mesh(geo, material);
    m.scale.set(sx, sy, sz);
    m.position.set(px, py, pz);
    return m;
  }

  /* Draw a dark outline around `mesh` (a slightly larger back-face copy of it, added beside it).
     Tiny parts are left out so they don't turn into black blobs. */
  _inked(parent, mesh, minVolume = 0.008) {
    const s = mesh.scale;
    if (s.x * s.y * s.z < minVolume) return;
    const t = mesh.geometry === this.shared.box ? 0.06 : 0.035;
    const hull = new this.T.Mesh(mesh.geometry, this.ink);
    hull.position.copy(mesh.position);
    hull.rotation.copy(mesh.rotation);
    hull.scale.set(s.x + t, s.y + t, s.z + t);
    parent.add(hull);
  }

  /* axis-aligned box sitting on bottom y=py, centred on (px, pz) */
  _box(mat, sx, sy, sz, px, py, pz) {
    return this._mesh(this.shared.box, mat, sx, sy, sz, px, py + sy / 2, pz);
  }

  _cylinder(mat, r, h, px, py, pz, geo = this.shared.cyl) {
    return this._mesh(geo, mat, r, h, r, px, py + h / 2, pz);
  }

  _cone(mat, r, h, px, py, pz) {
    return this._mesh(this.shared.cone, mat, r, h, r, px, py + h / 2, pz);
  }

  /* ───────── map ───────── */
  surfaceAt(x, y) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return 0.25;
    return this.surf[y * COLS + x];
  }

  _buildMap(map) {
    const T = this.T;
    if (this.mapGroup) {
      this.scene.remove(this.mapGroup);
      for (const m of this._mapMats) m.dispose();
    }
    this._mapMats = [];
    this.pickables = [];
    this.tileTags = [];
    this.surf = [];
    this.water = [];
    this.map = map;
    const grp = this.mapGroup = new T.Group();
    this.scene.add(grp);

    /* the earth the board sits on — its dark sides show under the tiles */
    const slab = this._box(this.mat('#2e2218'), COLS + 0.4, 0.5, ROWS + 0.4, COLS / 2, -0.5, ROWS / 2);
    slab.receiveShadow = true;
    grp.add(slab);
    const rim = this._box(this.mat('#4a3826'), COLS + 0.4, 0.05, ROWS + 0.4, COLS / 2, -0.05, ROWS / 2);
    grp.add(rim);

    this.tileGroup = new T.Group();
    grp.add(this.tileGroup);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = map.at(x, y);
        this.surf[y * COLS + x] = SURF.has(t) ? SURF.get(t) : 0.25;
        this._buildTile(x, y, t);
      }
    }
  }

  _buildTile(x, y, t) {
    const g = new this.T.Group();
    g.position.set(x + 0.5, 0, y + 0.5);
    this.tileGroup.add(g);
    const tag = { x, y };
    this.tileTags[y * COLS + x] = tag;
    const v = Math.floor(rnd(x, y, 0) * 3) - 1;       // -1, 0, 1: a faint checker/noise in the colouring
    const put = (mesh, cast = false) => {
      mesh.userData.tile = tag;
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      g.add(mesh);
      this._inked(g, mesh);
      this.pickables.push(mesh);
      return mesh;
    };
    const base = (hex, h) => put(this._box(this.mat(hex, v), 0.98, h, 0.98, 0, 0, 0));
    const r = k => rnd(x, y, k);

    if (t === T_FOREST) {
      base('#3b6d2c', 0.25);
      const n = 2 + Math.floor(r(1) * 2);
      for (let i = 0; i < n; i++) {
        const s = TREE_SLOTS[(Math.floor(r(2) * 5) + i * 2) % 5];
        const sc = 0.85 + r(3 + i) * 0.4;
        put(this._cylinder(this.mat('#5a3a1a'), 0.045 * sc, 0.2 * sc, s[0], 0.25, s[1], this.shared.cyl6), true);
        put(this._cone(this.mat('#2a6a2a', v), 0.21 * sc, 0.42 * sc, s[0], 0.25 + 0.14 * sc, s[1]), true);
        put(this._cone(this.mat('#348a38', v), 0.16 * sc, 0.34 * sc, s[0], 0.25 + 0.34 * sc, s[1]), true);
      }
    } else if (t === T_MOUNTAIN) {
      base('#6f6a63', 0.25);
      const big = 1.15 + r(1) * 0.35;
      const mk = (px, pz, rad, h, col) => {
        put(this._cone(this.mat(col), rad, h, px, 0.25, pz), true);
        const cap = h * 0.34;                                   // snow, sized to fit the cone's taper
        put(this._cone(this.mat('#f0f0f4'), rad * 0.34, cap, px, 0.25 + h - cap, pz));
      };
      mk(-0.06, 0.04, 0.5, big, '#7d766c');
      mk(0.26, -0.22, 0.28, big * 0.55, '#8a8378');
    } else if (t === T_WATER) {
      const w = put(this._box(this.mat('#2060b0', 0, { transparent: true, opacity: 0.93 }), 0.98, 0.12, 0.98, 0, 0, 0));
      this.water.push({ mesh: w, ph: r(1) * 6.28, y: 0 });
      for (let i = 0; i < 2; i++) {
        const ripMat = new this.T.MeshBasicMaterial({ color: '#8cc8f0', transparent: true, opacity: 0.5, depthWrite: false });
        this._mapMats.push(ripMat);
        const rip = this._box(ripMat, 0.34, 0.01, 0.04, 0, 0.125, -0.2 + i * 0.4);
        rip.receiveShadow = false;
        g.add(rip);
        this.water.push({ mesh: rip, ph: r(5 + i) * 6.28, y: 0.125, ripple: true, z: -0.2 + i * 0.4 });
      }
    } else if (t === T_WALL) {
      base('#303038', 0.6);
      put(this._box(this.mat('#444452', v), 1.04, 0.07, 1.04, 0, 0.6, 0), true);
      for (const [mx, mz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) {
        put(this._box(this.mat('#3a3a46'), 0.2, 0.12, 0.2, mx, 0.67, mz), true);
      }
    } else if (t === T_FORT) {
      base('#9a7a40', 0.3);
      const wall = this.mat('#b89060', v), tower = this.mat('#7a5a30');
      put(this._box(wall, 0.98, 0.16, 0.12, 0, 0.3, -0.43), true);
      put(this._box(wall, 0.98, 0.16, 0.12, 0, 0.3, 0.43), true);
      put(this._box(wall, 0.12, 0.16, 0.74, -0.43, 0.3, 0), true);
      put(this._box(wall, 0.12, 0.16, 0.74, 0.43, 0.3, 0), true);
      for (const [mx, mz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) {
        put(this._box(tower, 0.2, 0.34, 0.2, mx, 0.3, mz), true);
      }
      put(this._cylinder(this.mat('#5a3a1a'), 0.015, 0.55, 0.4, 0.3, -0.4, this.shared.cyl6));
      put(this._box(this.mat('#d03030'), 0.2, 0.12, 0.02, 0.3, 0.7, -0.4));
    } else if (t === T_ROAD) {
      base('#c8a870', 0.22);
      for (const sx of [-0.24, 0.24]) put(this._box(this.mat('#b89860'), 0.07, 0.012, 0.98, sx, 0.22, 0));
      for (let i = 0; i < 3; i++) put(this._box(this.mat('#a89060'), 0.07, 0.04, 0.07, (r(1 + i) - 0.5) * 0.6, 0.22, (r(5 + i) - 0.5) * 0.7));
    } else if (t === T_HILL) {
      /* rolling hills: a broad terrace, a rounded crown on it where units stand, and a couple
         of lesser mounds on the flanks — laid out differently on each tile; bare brown earth */
      base('#6e5a3a', 0.25);
      const low = this.mat('#7a6240', v), flank = this.mat('#8a6e47', v), crown = this.mat('#9b7d52', v);
      const mound = (mat, px, pz, rx, h, rz, y0, rot) => {
        const m = this._mesh(this.shared.dome, mat, rx, h, rz, px, y0, pz);
        m.rotation.y = rot;
        return put(m, true);
      };
      const fx = r(2) < 0.5 ? 1 : -1, fz = r(3) < 0.5 ? 1 : -1;
      mound(low, 0, 0, 0.49, 0.3, 0.47, 0.25, r(1) * 3.14);                        // terrace, apex 0.55
      mound(flank, -0.24 * fx, -0.18 * fz, 0.23, 0.32, 0.2, 0.26, r(4) * 3);       // flank mounds
      mound(flank, 0.26 * fx, 0.24 * fz, 0.2, 0.24, 0.18, 0.26, r(5) * 3);
      mound(crown, 0, 0, 0.34, 0.32, 0.32, 0.46, r(6) * 3);                       // crown, apex 0.78
      put(this._box(this.mat('#8a8a80'), 0.1, 0.07, 0.08, 0.3 * fx, 0.36, -0.06 * fz), true);
      put(this._box(this.mat('#7a7a72'), 0.07, 0.05, 0.09, -0.12 * fx, 0.28, 0.4 * fz), true);
    } else if (t === T_SWAMP) {
      base('#3f5a45', 0.18);
      for (const [px, pz, rad] of [[-0.2, -0.15, 0.2], [0.2, 0.2, 0.17]]) {
        put(this._cylinder(this.mat('#25392c'), rad, 0.02, px, 0.18, pz));
      }
      for (let i = 0; i < 4; i++) {
        const px = (r(1 + i) - 0.5) * 0.8, pz = (r(7 + i) - 0.5) * 0.8;
        put(this._cylinder(this.mat('#6b8a58'), 0.015, 0.3, px, 0.18, pz, this.shared.cyl6));
        put(this._cylinder(this.mat('#5a3a1a'), 0.03, 0.08, px, 0.4, pz, this.shared.cyl6));
      }
    } else if (t === T_FORD) {
      const w = put(this._box(this.mat('#3d7fa8', 0, { transparent: true, opacity: 0.93 }), 0.98, 0.12, 0.98, 0, 0, 0));
      this.water.push({ mesh: w, ph: r(1) * 6.28, y: 0 });
      for (const [px, pz] of [[-0.25, -0.2], [0.22, -0.05], [-0.05, 0.28]]) {
        put(this._cylinder(this.mat('#8a9aa0'), 0.13, 0.05, px, 0.1, pz));
      }
    } else if (t === T_BRIDGE) {
      put(this._box(this.mat('#2060b0', 0, { transparent: true, opacity: 0.93 }), 0.98, 0.1, 0.98, 0, 0, 0));
      put(this._box(this.mat('#9a7a44'), 0.7, 0.08, 1.0, 0, 0.2, 0), true);
      for (const sx of [-0.33, 0.33]) {
        put(this._box(this.mat('#5a3a1a'), 0.06, 0.12, 1.0, sx, 0.28, 0), true);
        for (const sz of [-0.4, 0.4]) put(this._box(this.mat('#5a3a1a'), 0.07, 0.3, 0.07, sx, 0.0, sz));
      }
      for (let i = 0; i < 5; i++) put(this._box(this.mat('#7a5a30'), 0.7, 0.012, 0.025, 0, 0.28, -0.4 + i * 0.2));
    } else {
      /* plain grass */
      base(t.color || '#5a8a20', 0.25);
      const n = 1 + Math.floor(r(1) * 3);
      for (let i = 0; i < n; i++) {
        put(this._cone(this.mat('#4a7a10', v), 0.05, 0.15, (r(2 + i) - 0.5) * 0.8, 0.25, (r(8 + i) - 0.5) * 0.8));
      }
    }
  }

  /* ───────── enchanted backdrop: a misty twilight vista, drifting wisps, a rune circle, and the
     mossy island the board floats on ───────── */
  _buildSky() {
    const T = this.T;
    let seed = 20240611;
    const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

    /* the backdrop, painted on a canvas: an enchanted twilight vista */
    const W = 1024, H = Math.round(W * MAP_H / MAP_W);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0b1a33'); sky.addColorStop(0.35, '#1b3a5e'); sky.addColorStop(0.65, '#3d2f78'); sky.addColorStop(1, '#6a3f8a');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);

    const blob = (x, y, r, rgb, a) => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${rgb},${a})`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2);
    };

    /* aurora ribbons */
    g.globalCompositeOperation = 'lighter';
    const ribbons = [[0.24, '70,255,190', 150, 2.1, 38], [0.38, '150,110,255', 130, 1.6, 30], [0.16, '120,220,255', 110, 2.6, 26]];
    for (const [yBase, rgb, tall, freq, amp] of ribbons) {
      const phase = rand() * 6.28;
      for (let x = 0; x < W; x += 2) {
        const y = H * yBase + Math.sin(x / W * Math.PI * freq + phase) * amp + Math.sin(x / W * 9 + phase) * 8;
        const grad = g.createLinearGradient(0, y - tall, 0, y + tall * 0.5);
        const edge = Math.sin(Math.min(1, Math.max(0, x / W)) * Math.PI);          // fade out toward the sides
        grad.addColorStop(0, `rgba(${rgb},0)`);
        grad.addColorStop(0.7, `rgba(${rgb},${0.26 * edge})`);
        grad.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = grad; g.fillRect(x, y - tall, 2, tall * 1.5);
      }
    }

    /* slanting shafts of pale gold light */
    for (let i = 0; i < 6; i++) {
      const x0 = W * (0.02 + i * 0.17) + rand() * 40, w = 30 + rand() * 70, drift = W * 0.22;
      const grad = g.createLinearGradient(x0, 0, x0 + drift, H);
      grad.addColorStop(0, 'rgba(255,238,180,0.16)'); grad.addColorStop(1, 'rgba(255,238,180,0)');
      g.fillStyle = grad;
      g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + w, 0); g.lineTo(x0 + w + drift * 1.3, H); g.lineTo(x0 + drift * 0.9, H); g.closePath(); g.fill();
    }

    /* bokeh orbs of drifting light */
    const orbs = ['120,240,230', '255,170,230', '255,225,150', '170,150,255'];
    for (let i = 0; i < 30; i++) {
      const r = 14 + rand() * 46;
      blob(rand() * W, rand() * H * 0.85, r, orbs[Math.floor(rand() * orbs.length)], 0.1 + rand() * 0.2);
    }
    g.globalCompositeOperation = 'source-over';

    /* distant spires and towers in layers, with mist between them */
    const mist = (y, rgb, a) => {
      g.save(); g.translate(0, y); g.scale(3, 0.4);
      for (let i = 0; i < 6; i++) blob((i / 6 + rand() * 0.1) * W / 3, 0, 150 + rand() * 90, rgb, a);
      g.restore();
    };
    const range = (base, amp, color, towers) => {
      g.fillStyle = color;
      g.beginPath(); g.moveTo(0, H);
      let x = 0;
      while (x <= W) {
        const spire = rand() < 0.14;
        g.lineTo(x, base - (spire ? amp * (1.3 + rand() * 0.8) : rand() * amp * 0.55));
        x += 14 + rand() * 30;
      }
      g.lineTo(W, H); g.closePath(); g.fill();
      for (let i = 0; i < towers; i++) {                     // a tower with a pointed roof and lit windows
        const tx = W * (0.08 + rand() * 0.84), tw = 12 + rand() * 10, th = amp * (1 + rand() * 0.9), top = base - th;
        g.fillStyle = color;
        g.fillRect(tx, top, tw, th + 20);
        g.beginPath(); g.moveTo(tx - 3, top); g.lineTo(tx + tw / 2, top - tw * 1.7); g.lineTo(tx + tw + 3, top); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,214,120,0.9)';
        for (let w = 0; w < 3; w++) g.fillRect(tx + tw / 2 - 1.5, top + 8 + w * 14, 3, 5);
      }
    };
    mist(H * 0.66, '170,160,255', 0.1);
    range(H * 0.7, 110, 'rgba(34,30,92,0.55)', 0);
    mist(H * 0.76, '190,170,255', 0.13);
    range(H * 0.8, 90, 'rgba(24,20,70,0.75)', 4);
    mist(H * 0.88, '200,180,255', 0.16);
    range(H * 0.92, 60, 'rgba(14,12,46,0.92)', 0);
    this.scene.background = new T.CanvasTexture(cv);

    /* magic motes: soft glowing sparkles that rise around the island */
    const dot = document.createElement('canvas');
    dot.width = dot.height = 64;
    const dg = dot.getContext('2d');
    const dgr = dg.createRadialGradient(32, 32, 0, 32, 32, 32);
    dgr.addColorStop(0, 'rgba(255,255,255,1)'); dgr.addColorStop(0.25, 'rgba(255,255,255,0.7)'); dgr.addColorStop(1, 'rgba(255,255,255,0)');
    dg.fillStyle = dgr; dg.fillRect(0, 0, 64, 64);
    const dotTex = new T.CanvasTexture(dot);
    this.motes = [];
    for (const [count, size, color] of [[170, 9, 0xffd878], [130, 8, 0x80f0ff], [110, 9, 0xff90e0]]) {
      const pos = new Float32Array(count * 3);
      const state = [];
      for (let i = 0; i < count; i++) {
        const ang = rand() * Math.PI * 2, r = 7 + Math.sqrt(rand()) * 17;
        state.push({ x: COLS / 2 + Math.cos(ang) * r, y: -9 + rand() * 26, z: ROWS / 2 + Math.sin(ang) * r,
                     v: 0.25 + rand() * 0.5, ph: rand() * 6.28 });
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      const mat = new T.PointsMaterial({ size, sizeAttenuation: false, map: dotTex, color, transparent: true, opacity: 0.9,
                                         blending: T.AdditiveBlending, depthWrite: false });
      const pts = new T.Points(geo, mat);
      pts.frustumCulled = false;
      this.scene.add(pts);
      this.motes.push({ pts, state, pos, mat, ph: rand() * 6.28 });
    }

    /* a slowly turning rune circle glowing beneath the island */
    const rc = document.createElement('canvas');
    rc.width = rc.height = 512;
    const rg = rc.getContext('2d');
    rg.translate(256, 256);
    rg.strokeStyle = '#9ff0ff'; rg.fillStyle = '#9ff0ff';
    rg.shadowColor = '#7ad8ff'; rg.shadowBlur = 10;
    for (const [r, w] of [[240, 3], [226, 1.5], [170, 2], [120, 1.5]]) { rg.lineWidth = w; rg.beginPath(); rg.arc(0, 0, r, 0, Math.PI * 2); rg.stroke(); }
    /* compass rose: tick marks round the dial, then four long points and four short
       ones, each split into a filled half and an outlined half */
    rg.lineWidth = 1.2;
    for (let i = 0; i < 72; i++) {
      const a = i * Math.PI * 2 / 72, r1 = i % 6 === 0 ? 154 : 162;
      rg.beginPath();
      rg.moveTo(Math.sin(a) * 170, -Math.cos(a) * 170);
      rg.lineTo(Math.sin(a) * r1, -Math.cos(a) * r1);
      rg.stroke();
    }
    const point = (ang, len, half, baseR) => {
      rg.save();
      rg.rotate(ang);
      rg.fillStyle = 'rgba(159,240,255,0.5)';
      rg.lineWidth = 1.6;
      rg.beginPath(); rg.moveTo(0, -len); rg.lineTo(half, -baseR); rg.lineTo(0, 0); rg.closePath(); rg.fill(); rg.stroke();
      rg.beginPath(); rg.moveTo(0, -len); rg.lineTo(-half, -baseR); rg.lineTo(0, 0); rg.closePath(); rg.stroke();
      rg.restore();
    };
    for (let k = 0; k < 4; k++) point(Math.PI / 4 + k * Math.PI / 2, 150, 17, 46);   // intercardinal
    for (let k = 0; k < 4; k++) point(k * Math.PI / 2, 214, 26, 60);                 // N, E, S, W
    rg.lineWidth = 2;
    rg.beginPath(); rg.arc(0, 0, 60, 0, Math.PI * 2); rg.stroke();
    rg.beginPath(); rg.arc(0, 0, 14, 0, Math.PI * 2); rg.fill(); rg.stroke();
    rg.fillStyle = '#9ff0ff';
    for (let i = 0; i < 36; i++) {                              // runes between the outer rings
      rg.save();
      rg.rotate(i * Math.PI * 2 / 36);
      rg.translate(0, -233);
      rg.beginPath();
      const k = (rand() * 4) | 0;
      if (k === 0) { rg.moveTo(-3, -5); rg.lineTo(3, 5); rg.moveTo(3, -5); rg.lineTo(-3, 5); }
      else if (k === 1) { rg.moveTo(0, -6); rg.lineTo(0, 6); rg.moveTo(-4, -1); rg.lineTo(4, -1); }
      else if (k === 2) { rg.moveTo(-4, 5); rg.lineTo(0, -6); rg.lineTo(4, 5); }
      else { rg.arc(0, 0, 4, 0, Math.PI * 1.6); }
      rg.stroke();
      rg.restore();
    }
    const runeTex = new T.CanvasTexture(rc);
    this.rune = new T.Mesh(new T.PlaneGeometry(40, 40),
      new T.MeshBasicMaterial({ map: runeTex, transparent: true, opacity: 0.8, blending: T.AdditiveBlending,
                                depthWrite: false, side: T.DoubleSide }));
    this.rune.rotation.x = -Math.PI / 2;
    this.rune.position.set(COLS / 2, -7, ROWS / 2);
    this.scene.add(this.rune);

    /* the floating island: a tapering chunk of earth under the board */
    const rockMat = this.mat('#6b5444'), deepMat = this.mat('#4d4141');
    const island = new T.Group();
    const jag = (geo, amt) => {                           // jitter vertices consistently, then facet the normals
      const p = geo.attributes.position, seen = new Map();
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
        let d = seen.get(key);
        if (!d) { d = [(rand() - 0.5) * amt, (rand() - 0.5) * amt, (rand() - 0.5) * amt]; seen.set(key, d); }
        p.setXYZ(i, x + d[0], y + d[1], z + d[2]);
      }
      geo.computeVertexNormals();
      return geo;
    };
    const taper = (top, bottom, h, sx, sz, mat, y) => {
      const geo = new T.CylinderGeometry(top, bottom, h, 4, 3);
      geo.rotateY(Math.PI / 4);
      geo.scale(sx, 1, sz);
      const m = new T.Mesh(jag(geo.toNonIndexed(), 0.45), mat);
      m.position.set(COLS / 2, y, ROWS / 2);
      island.add(m);
    };
    const side = Math.SQRT2;                              // a 4-sided cylinder of radius r has side r*sqrt(2)
    taper(1, 0.62, 1.4, (COLS + 0.4) / side, (ROWS + 0.4) / side, rockMat, -0.5 - 0.7);
    taper(0.62, 0.0, 3.2, (COLS + 0.4) / side, (ROWS + 0.4) / side, deepMat, -0.5 - 1.4 - 1.6);
    const under = new T.PointLight(0xb888ff, 1.0, 16, 1.6);
    under.position.set(COLS / 2, -4.5, ROWS / 2);
    island.add(under);
    this.scene.add(island);

    /* little floating islets, some with a tree */
    this.islets = [];
    const leaf = this.mat('#3f8f4a'), trunk = this.mat('#5a3a1a'), moss = this.mat('#5a9a3a');
    const islets = [[-3.2, -1.8, 7.5, 0.6, 'tree'], [17.4, -2.6, 3.2, 0.75, 'tree'], [12, -4.2, 14.5, 0.5, 'tree'],
                    [1.5, -3.6, -2.4, 0.42, 'tree'], [9, -6.2, 6.5, 0.34, null], [-1.8, 0.4, -2.6, 0.32, 'tree'],
                    [16.2, 0.2, 12.6, 0.34, 'tree'], [19, -1.2, 9.5, 0.4, null]];
    for (const [x, y, z, sc, deco] of islets) {
      const grp = new T.Group();
      const sx = sc * (0.9 + rand() * 0.4), sy = sc * (0.7 + rand() * 0.3), sz = sc * (0.9 + rand() * 0.4);
      const rock = new T.Mesh(jag(new T.IcosahedronGeometry(1, 1), 0.45), rand() < 0.5 ? rockMat : deepMat);
      rock.scale.set(sx, sy, sz);
      grp.add(rock);
      if (deco) {
        const cap = this._mesh(this.shared.cyl, moss, sx * 0.85, 0.12, sz * 0.85, 0, sy * 0.82, 0);
        grp.add(cap);
        grp.add(this._cylinder(trunk, 0.05 * sc / 0.4, 0.3 * sc / 0.4, 0, sy * 0.88, 0, this.shared.cyl6));
        grp.add(this._cone(leaf, 0.28 * sc / 0.4, 0.55 * sc / 0.4, 0, sy * 0.88 + 0.2 * sc / 0.4, 0));
      }
      grp.position.set(x, y, z);
      this.scene.add(grp);
      this.islets.push({ g: grp, y, phase: rand() * 6.28, speed: 0.3 + rand() * 0.4, spin: (rand() - 0.5) * 0.3 });
    }
  }

  _updateSky(now, dt) {
    for (const m of this.motes) {
      const p = m.pos;
      m.state.forEach((s, i) => {
        s.y += s.v * dt;
        if (s.y > 17) s.y = -9;                                         // rise out of sight, return from below
        p[i * 3] = s.x + Math.sin(now * 0.6 + s.ph) * 0.5;
        p[i * 3 + 1] = s.y;
        p[i * 3 + 2] = s.z + Math.cos(now * 0.5 + s.ph) * 0.5;
      });
      m.pts.geometry.attributes.position.needsUpdate = true;
      m.mat.opacity = 0.65 + 0.3 * Math.sin(now * 1.7 + m.ph);          // slow shimmer
    }
    this.rune.rotation.z = now * 0.08;
    this.rune.material.opacity = 0.6 + 0.25 * Math.sin(now * 1.1);
    for (const r of this.islets) {
      r.g.position.y = r.y + Math.sin(now * r.speed + r.phase) * 0.18;
      r.g.rotation.y += r.spin * dt;
    }
  }

  /* ───────── persistent overlays: highlights, cursor ───────── */
  _buildOverlays() {
    const T = this.T;
    this.hlMove = []; this.hlAtk = [];
    const mk = (hex) => new T.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.42, depthWrite: false,
                                                  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.hlMoveMat = mk(0x3c78ff);
    this.hlAtkMat = mk(0xff3c3c);
    this.hlGroup = new T.Group();
    this.scene.add(this.hlGroup);
    for (let i = 0; i < COLS * ROWS; i++) {
      const a = new T.Mesh(this.shared.plane, this.hlMoveMat);
      const b = new T.Mesh(this.shared.plane, this.hlAtkMat);
      for (const m of [a, b]) {
        m.rotation.x = -Math.PI / 2;
        m.scale.set(0.94, 0.94, 1);
        m.visible = false;
        m.renderOrder = 2;
        this.hlGroup.add(m);
      }
      this.hlMove.push(a); this.hlAtk.push(b);
    }
    /* cursor: a square frame */
    const outer = new T.Shape();
    outer.moveTo(-0.5, -0.5); outer.lineTo(0.5, -0.5); outer.lineTo(0.5, 0.5); outer.lineTo(-0.5, 0.5); outer.closePath();
    const hole = new T.Path();
    hole.moveTo(-0.42, -0.42); hole.lineTo(-0.42, 0.42); hole.lineTo(0.42, 0.42); hole.lineTo(0.42, -0.42); hole.closePath();
    outer.holes.push(hole);
    this.cursor = new T.Mesh(new T.ShapeGeometry(outer),
      new T.MeshBasicMaterial({ color: 0xfff060, transparent: true, depthWrite: false,
                                polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.cursor.rotation.x = -Math.PI / 2;
    this.cursor.renderOrder = 3;
    this.cursor.visible = false;
    this.scene.add(this.cursor);
  }

  /* ───────── units ───────── */
  _makeUnit(u) {
    const T = this.T, S = this.shared;
    const hue = u.hue, key = u.key;
    const m = {
      body: new T.MeshToonMaterial({ color: hue, gradientMap: this.toon }),
      skin: new T.MeshToonMaterial({ color: '#f0c890', gradientMap: this.toon }),
      helm: new T.MeshToonMaterial({ color: HELM[key] || '#888888', gradientMap: this.toon }),
      ring: new T.MeshBasicMaterial({ color: u.isPlayer ? 0x5a86ff : 0xff5a5a }),
    };
    const dark = this.mat('#25252d'), steel = this.mat('#c8ccd4'), wood = this.mat('#6a4524');
    const group = new T.Group();
    const model = new T.Group();
    group.add(model);

    const tag = { x: u.x, y: u.y };
    const cast = (mesh) => { mesh.castShadow = true; mesh.userData.tile = tag; this.pickables.push(mesh); return mesh; };
    const part = (parent, mesh) => { parent.add(cast(mesh)); this._inked(parent, mesh, 0.003); return mesh; };

    const mounted = key === 'CAVALIER';
    const lift = mounted ? 0.3 : 0;
    const rider = new T.Group();
    rider.position.y = lift;
    model.add(rider);

    /* team ring on the ground (not pickable, no shadow) */
    const ring = new T.Mesh(S.cyl, m.ring);
    ring.scale.set(mounted ? 0.5 : 0.38, 0.04, mounted ? 0.5 : 0.38);
    ring.position.y = 0.02;
    group.add(ring);

    /* legs */
    const legs = [];
    for (const z of [-0.08, 0.08]) {
      const pivot = new T.Group();
      pivot.position.set(0, 0.22, z);
      part(pivot, this._mesh(S.box, dark, 0.12, 0.22, 0.12, 0, -0.11, 0));
      rider.add(pivot);
      legs.push(pivot);
    }
    /* torso, head, helmet, eyes */
    part(rider, this._mesh(S.cyl, m.body, 0.2, 0.34, 0.2, 0, 0.39, 0));
    part(rider, this._mesh(S.sph, m.skin, 0.15, 0.15, 0.15, 0, 0.7, 0));
    if (key === 'MAGE' || key === 'DARK_MAGE') {
      part(rider, this._mesh(S.cyl, m.helm, 0.24, 0.03, 0.24, 0, 0.81, 0));
      part(rider, this._mesh(S.cone8, m.helm, 0.16, 0.38, 0.16, 0, 1.0, 0));
    } else {
      part(rider, this._mesh(S.dome, m.helm, 0.17, 0.17, 0.17, 0, 0.71, 0));
    }
    for (const z of [-0.06, 0.06]) part(rider, this._mesh(S.box, dark, 0.03, 0.035, 0.035, 0.14, 0.72, z));

    /* arms */
    const arms = [];
    for (const z of [-0.22, 0.22]) {
      const pivot = new T.Group();
      pivot.position.set(0, 0.54, z);
      part(pivot, this._mesh(S.box, m.body, 0.09, 0.3, 0.09, 0, -0.13, 0));
      part(pivot, this._mesh(S.sph, m.skin, 0.055, 0.055, 0.055, 0, -0.29, 0));
      rider.add(pivot);
      arms.push(pivot);
    }
    /* weapon in the right hand */
    const hand = new T.Group();
    hand.position.set(0.03, -0.29, 0);
    arms[1].add(hand);
    const kind = WEAPON[key] || 'sword';
    if (kind === 'sword') {
      hand.rotation.z = -0.45;
      part(hand, this._mesh(S.box, steel, 0.04, 0.46, 0.012, 0, 0.26, 0));
      part(hand, this._mesh(S.box, dark, 0.04, 0.03, 0.14, 0, 0.02, 0));
    } else if (kind === 'dagger') {
      hand.rotation.z = -0.45;
      part(hand, this._mesh(S.box, steel, 0.03, 0.22, 0.01, 0, 0.13, 0));
    } else if (kind === 'axe') {
      hand.rotation.z = -0.3;
      part(hand, this._mesh(S.cyl6, wood, 0.02, 0.6, 0.02, 0, 0.22, 0));
      part(hand, this._mesh(S.box, steel, 0.06, 0.18, 0.2, 0.0, 0.46, 0.06));
    } else if (kind === 'lance') {
      hand.rotation.z = -0.2;
      part(hand, this._mesh(S.cyl6, wood, 0.018, 1.15, 0.018, 0, 0.3, 0));
      part(hand, this._mesh(S.cone, steel, 0.05, 0.2, 0.05, 0, 0.98, 0));
    } else if (kind === 'bow') {
      hand.rotation.z = 0;
      const bow = new T.Mesh(new T.TorusGeometry(0.26, 0.015, 4, 12, Math.PI), wood);
      bow.rotation.z = -Math.PI / 2;
      bow.position.set(0.04, 0.08, 0);
      part(hand, bow);
      part(hand, this._mesh(S.box, steel, 0.005, 0.5, 0.005, 0, 0.08, 0));
    } else if (kind === 'staff') {
      hand.rotation.z = -0.1;
      part(hand, this._mesh(S.cyl6, wood, 0.02, 0.85, 0.02, 0, 0.3, 0));
      const orb = m.orb = new T.MeshBasicMaterial({ color: ORB[key] || '#80c0ff' });
      part(hand, this._mesh(S.sph, orb, 0.07, 0.07, 0.07, 0, 0.78, 0));
    }

    /* class extras */
    if (key === 'LORD' || key === 'WARLORD') {
      part(rider, this._mesh(S.box, this.mat(key === 'LORD' ? '#a02030' : '#2a0a0a'), 0.04, 0.42, 0.3, -0.2, 0.38, 0));
    }
    if (key === 'WARLORD') {
      for (const z of [-0.12, 0.12]) {
        const horn = this._mesh(S.cone, steel, 0.04, 0.2, 0.04, 0, 0.9, z);
        horn.rotation.x = z > 0 ? -0.5 : 0.5;
        part(rider, horn);
      }
    }
    if (key === 'KNIGHT') {
      for (const z of [-0.2, 0.2]) part(rider, this._mesh(S.sph, steel, 0.11, 0.08, 0.11, 0, 0.56, z));
    }
    const horse = [];
    if (mounted) {
      const hm = this.mat('#7a5a3a');
      const hb = new T.Group();
      model.add(hb);
      part(hb, this._mesh(S.box, hm, 0.7, 0.28, 0.3, 0, 0.3, 0));
      part(hb, this._mesh(S.box, hm, 0.14, 0.3, 0.14, 0.38, 0.52, 0));
      part(hb, this._mesh(S.box, hm, 0.26, 0.14, 0.14, 0.5, 0.64, 0));
      part(hb, this._mesh(S.box, dark, 0.06, 0.2, 0.04, 0.28, 0.58, 0));
      for (const [lx, lz] of [[0.26, -0.1], [0.26, 0.1], [-0.26, -0.1], [-0.26, 0.1]]) {
        const pivot = new T.Group();
        pivot.position.set(lx, 0.3, lz);
        part(pivot, this._mesh(S.box, hm, 0.09, 0.3, 0.09, 0, -0.15, 0));
        hb.add(pivot);
        horse.push(pivot);
      }
    }

    const scale = (key === 'WARLORD' ? 1.35 : key === 'KNIGHT' ? 1.1 : 1) * 1.2;
    model.scale.setScalar(scale);

    /* selection / attack-target rings */
    const sel = new T.Mesh(S.ring, new T.MeshBasicMaterial({ color: 0xffff00, side: T.DoubleSide, transparent: true, depthWrite: false }));
    sel.rotation.x = -Math.PI / 2; sel.position.y = 0.05; sel.visible = false; sel.renderOrder = 4;
    const tgt = new T.Mesh(S.ring, new T.MeshBasicMaterial({ color: 0xffe040, side: T.DoubleSide, transparent: true, depthWrite: false }));
    tgt.rotation.x = -Math.PI / 2; tgt.position.y = 0.05; tgt.visible = false; tgt.renderOrder = 4;
    group.add(sel, tgt);

    this.scene.add(group);
    return {
      group, model, rider, legs, arms, horse, mats: m, sel, tgt, tag, scale, lift, mounted, ring, air: 0,
      x: u.x, y: u.y, h: this.surfaceAt(Math.round(u.x), Math.round(u.y)),
      face: u.isPlayer ? 0 : Math.PI, phase: 0, gait: 0, done: null, dying: 0, alive: true,
    };
  }

  _disposeUnit(rec) {
    this.scene.remove(rec.group);
    for (const k of Object.keys(rec.mats)) rec.mats[k].dispose();
    rec.group.traverse(o => {
      if (o.userData.tile) {
        const i = this.pickables.indexOf(o);
        if (i >= 0) this.pickables.splice(i, 1);
      }
    });
  }

  _updateUnits(units, o, now, dt) {
    const seen = new Set();
    const targets = new Set(o.targets || []);
    const atkAnim = o.atkAnim;
    for (const u of units) {
      seen.add(u.id);
      let s = this.units.get(u.id);
      if (!s) { s = this._makeUnit(u); this.units.set(u.id, s); }
      s.dying = 0;
      s.alive = true;
      s.group.visible = true;
      s.tag.x = Math.round(u.x); s.tag.y = Math.round(u.y);

      /* glide toward the logical tile; snap if it jumped (new level, rewind) */
      let dx = u.x - s.x, dz = u.y - s.y;
      if (Math.hypot(dx, dz) > 7) { s.x = u.x; s.y = u.y; dx = dz = 0; }
      const k = Math.min(1, dt * 9);
      s.x += dx * k; s.y += dz * k;
      const dist = Math.hypot(u.x - s.x, u.y - s.y);
      const jp = u.jump;                       // mid-leap in a level transition: placed directly
      const moving = !jp && dist > 0.04;
      if (moving) s.face = this._turn(s.face, Math.atan2(-dz, dx), dt * 14);
      if (jp) {
        s.x = jp.x; s.y = jp.y;
        s.face = this._turn(s.face, Math.atan2(-jp.dz, jp.dx), dt * 10);
      }
      const hTarget = this.surfaceAt(Math.round(s.x), Math.round(s.y));
      s.h += (hTarget - s.h) * (jp ? 1 : Math.min(1, dt * 14));
      const air = jp ? jp.lift : 0;
      s.air = air;

      /* attacker lunges at the defender; defender shudders */
      let lx = 0, lz = 0, hit = 0, swing = 0;
      if (atkAnim && atkAnim.atk && atkAnim.def) {
        if (u === atkAnim.atk) {
          const ax = atkAnim.def.x - u.x, az = atkAnim.def.y - u.y;
          const len = Math.hypot(ax, az) || 1;
          s.face = this._turn(s.face, Math.atan2(-az, ax), dt * 14);
          const p = Math.abs(Math.sin(now * 4.5));
          lx = ax / len * 0.26 * p; lz = az / len * 0.26 * p;
          swing = p;
        } else if (u === atkAnim.def) {
          hit = 0.35 + 0.35 * Math.sin(now * 14);
          lx = Math.sin(now * 40) * 0.03;
        }
      }

      /* walk cycle */
      const target = moving ? 1 : 0;
      s.gait += (target - s.gait) * Math.min(1, dt * 12);
      s.phase += dt * (9 + 5 * s.gait);
      const sw = Math.sin(s.phase) * s.gait;
      s.legs[0].rotation.z = sw * 0.8;
      s.legs[1].rotation.z = -sw * 0.8;
      s.arms[0].rotation.z = -sw * 0.6;
      s.arms[1].rotation.z = sw * 0.6 + swing * 1.5;
      s.horse.forEach((p, i) => { p.rotation.z = (i % 2 ? -1 : 1) * (i < 2 ? 1 : -1) * sw * 0.7; });
      if (air > 0.25) {                        // airborne: arms thrown up, legs tucked
        for (const a of s.arms) a.rotation.z = 2.5;
        for (const l of s.legs) l.rotation.z = 0.8;
      }

      const done = !!(u.isPlayer && u.done);
      if (s.done !== done) {
        s.done = done;
        s.mats.body.color.set(done ? this._dim(u.hue) : u.hue);
        s.mats.skin.color.set(done ? '#9a8a6a' : '#f0c890');
        s.mats.helm.color.set(done ? this._dim(HELM[u.key] || '#888888') : (HELM[u.key] || '#888888'));
      }
      const flash = hit;
      for (const key of ['body', 'skin', 'helm']) s.mats[key].emissive.setRGB(flash, flash * 0.1, flash * 0.1);

      const selected = o.sel === u;
      const bounce = selected ? Math.abs(Math.sin(now * 5)) * 0.12 : 0;
      const bob = done ? 0 : Math.sin(now * 2.6 + u.id) * 0.012;
      const hop = Math.abs(sw) * 0.07;
      s.group.position.set(s.x + 0.5 + lx, s.h + air, s.y + 0.5 + lz);
      s.ring.position.y = 0.02 - air;          // the team ring stays on the ground
      /* ...but not out over empty space, where it would hang in the void */
      const offBoard = jp && (jp.x < -0.5 || jp.x >= COLS - 0.5 || jp.y < -0.5 || jp.y >= ROWS - 0.5);
      s.ring.visible = !offBoard;
      s.model.position.y = bob + hop + bounce;
      s.model.rotation.y = s.face;
      s.model.scale.setScalar(s.scale);

      s.sel.visible = selected;
      if (selected) {
        const p = 1 + Math.sin(now * 6) * 0.06;
        s.sel.scale.set(p, p, 1);
        s.sel.material.opacity = 0.75 + Math.sin(now * 6) * 0.25;
      }
      const isTgt = targets.has(u);
      s.tgt.visible = isTgt;
      if (isTgt) {
        const p = 1.1 + Math.sin(now * 8) * 0.12;
        s.tgt.scale.set(p, p, 1);
        s.tgt.material.opacity = 0.6 + Math.sin(now * 8) * 0.4;
      }
    }
    /* units that left the list shrink away, then are freed */
    for (const [id, s] of this.units) {
      if (seen.has(id)) continue;
      s.dying += dt;
      s.tgt.visible = s.sel.visible = false;
      const p = Math.max(0, 1 - s.dying / 0.45);
      s.model.scale.setScalar(Math.max(0.001, s.scale * p));
      s.model.position.y -= dt * 0.3;
      s.alive = false;
      if (p <= 0) { this._disposeUnit(s); this.units.delete(id); }
    }
  }

  _turn(cur, target, k) {
    let d = target - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return cur + d * Math.min(1, k);
  }

  _dim(hex) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${(r * 0.4) | 0},${(g * 0.4) | 0},${(b * 0.4) | 0})`;
  }

  /* ───────── dropped items: little treasure chests ───────── */
  _updateItems(items, now) {
    const T = this.T, S = this.shared;
    while (this.items.length < items.length) {
      const g = new T.Group();
      const brown = this.mat('#8a5a24'), gold = this.mat('#e8c030');
      g.add(this._box(brown, 0.4, 0.2, 0.28, 0, 0, 0));
      g.add(this._mesh(S.box, gold, 0.42, 0.04, 0.3, 0, 0.12, 0));
      g.add(this._mesh(S.cyl, brown, 0.14, 0.4, 0.14, 0, 0.2, 0));
      g.children[2].rotation.x = Math.PI / 2;
      g.add(this._box(gold, 0.06, 0.08, 0.04, 0, 0.1, 0.15));
      g.traverse(o => { o.castShadow = true; });
      const glow = new T.Mesh(S.disc, new T.MeshBasicMaterial({ color: 0xffd700, transparent: true, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2;
      glow.scale.set(0.45, 0.45, 1);
      glow.position.y = 0.04;
      const wrap = new T.Group();
      wrap.add(g, glow);
      wrap.userData = { chest: g, glow };
      this.scene.add(wrap);
      this.items.push(wrap);
    }
    this.items.forEach((w, i) => {
      const d = items[i];
      w.visible = !!d;
      if (!d) return;
      const pulse = 0.5 + Math.sin(now * 6 + d.x + d.y) * 0.3;
      w.position.set(d.x + 0.5, this.surfaceAt(d.x, d.y), d.y + 0.5);
      w.userData.chest.position.y = 0.05 + Math.abs(Math.sin(now * 2.4 + d.x)) * 0.05;
      w.userData.chest.rotation.y = now * 0.8 + d.x;
      w.userData.glow.material.opacity = pulse * 0.45;
    });
  }

  /* ───────── highlights ───────── */
  _updateHighlights(o, now) {
    const mv = new Set((o.moveRange || []).map(p => p.y * COLS + p.x));
    const at = new Set((o.atkRange || []).map(p => p.y * COLS + p.x));
    for (let i = 0; i < COLS * ROWS; i++) {
      const x = i % COLS, y = (i / COLS) | 0;
      const yy = this.surf[i] + 0.012;
      const a = this.hlMove[i], b = this.hlAtk[i];
      a.visible = mv.has(i);
      b.visible = at.has(i);
      if (a.visible) a.position.set(x + 0.5, yy, y + 0.5);
      if (b.visible) b.position.set(x + 0.5, yy + 0.004, y + 0.5);
    }
    const c = o.cur;
    this.cursor.visible = !!c && c.x >= 0 && c.x < COLS && c.y >= 0 && c.y < ROWS;
    if (this.cursor.visible) {
      const p = 1 + Math.sin(now * 6) * 0.04;
      this.cursor.position.set(c.x + 0.5, this.surf[c.y * COLS + c.x] + 0.02, c.y + 0.5);
      this.cursor.scale.set(p, p, 1);
    }
  }

  /* ───────── water shimmer ───────── */
  _updateWater(now) {
    for (const w of this.water) {
      if (w.ripple) {
        const t = ((now * 0.25 + w.ph) % 1);
        w.mesh.position.x = (t - 0.5) * 0.7;
        w.mesh.material.opacity = Math.sin(t * Math.PI) * 0.55;
      } else {
        w.mesh.position.y = w.mesh.scale.y / 2 + Math.sin(now * 1.6 + w.ph) * 0.012;
      }
    }
  }

  /* ───────── camera ───────── */
  _updateCamera(dt) {
    const d = this.yawT - this.yaw;
    this.yaw = Math.abs(d) < 0.001 ? this.yawT : this.yaw + d * Math.min(1, dt * 9);

    /* the look-at point may wander, but not off the board */
    const lx = COLS / 2 + 2, lz = ROWS / 2 + 2;
    this.panV.x = Math.max(-lx, Math.min(lx, this.panV.x));
    this.panV.z = Math.max(-lz, Math.min(lz, this.panV.z));

    const cam = this.camera, ang = BASE_AZIMUTH + this.yaw, pitch = this.pitch, D = CAM_DIST;
    const tx = COLS / 2 + this.panV.x, ty = 0.3, tz = ROWS / 2 + this.panV.z;
    cam.position.set(tx + Math.cos(ang) * D * Math.cos(pitch), ty + D * Math.sin(pitch), tz + Math.sin(ang) * D * Math.cos(pitch));
    cam.lookAt(tx, ty, tz);
    cam.zoom = this.zoom;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  /* ───────── per-frame entry point ───────── */
  frame(map, units, items, o = {}) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - this._last);
    this._last = now;
    if (map !== this.map) this._buildMap(map);
    this._syncTransform();
    this._updateCamera(dt);
    this._updateWater(now);
    this._updateSky(now, dt);
    this._updateUnits(units, o, now, dt);
    this._updateItems(items || [], now);
    this._updateHighlights(o, now);
    this.renderer.render(this.scene, this.camera);
  }

  /* ───────── projection and picking (canvas pixel space of the 2D canvas) ───────── */
  project(wx, wy, wz) {
    const v = this.tmp.set(wx, wy, wz).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * MAP_W, y: (-v.y * 0.5 + 0.5) * MAP_H };
  }

  /* centre of a tile's standing surface */
  tilePoint(tx, ty, lift = 0) {
    return this.project(tx + 0.5, this.surfaceAt(tx, ty) + lift, ty + 0.5);
  }

  /* the ground direction that points to the right of the screen, as a unit vector [x, z] */
  screenRight() {
    const a = BASE_AZIMUTH + this.yaw;
    return [Math.sin(a), -Math.cos(a)];
  }

  /* where a unit's head is on screen right now (follows its glide), or null */
  unitAnchor(u, lift = 1.0) {
    const s = this.units.get(u.id);
    if (!s) return null;
    return this.project(s.x + 0.5, s.h + s.air + lift * s.scale, s.y + 0.5);
  }

  /* pixels per world unit at a unit's depth: perspective makes nearer units bigger */
  unitScale(u) {
    const s = this.units.get(u.id);
    if (!s) return null;
    const cam = this.camera;
    cam.getWorldDirection(this.fwd);
    const depth = this.tmp.set(s.x + 0.5, s.h + s.air, s.y + 0.5).sub(cam.position).dot(this.fwd);
    return MAP_H / (2 * Math.tan(FOV * Math.PI / 360) / this.zoom * Math.max(0.1, depth));
  }

  unitFeet(u) {
    const s = this.units.get(u.id);
    if (!s) return null;
    return this.project(s.x + 0.5, s.h + s.air, s.y + 0.5);
  }

  /* the tile under a pixel of the 2D canvas, or null */
  pick(px, py) {
    if (px < 0 || py < 0 || px >= MAP_W || py >= MAP_H) return null;
    this.ray.setFromCamera({ x: px / MAP_W * 2 - 1, y: -(py / MAP_H * 2 - 1) }, this.camera);
    const hits = this.ray.intersectObjects(this.pickables, false);
    for (const h of hits) {
      const tag = h.object.userData.tile;
      if (tag) return { x: tag.x, y: tag.y };
    }
    return null;
  }
}
