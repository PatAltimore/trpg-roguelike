/* ═══════════ Mobile Pinch-Zoom & Pan ═══════════
   Manages CSS-transform based zoom/pan on the canvas container.
   Converts touch coordinates back to canvas-space for game input.

   Gestures:
   - Single tap:  game click
   - Single drag:  pan the view
   - Pinch:  zoom in/out
   - Double-tap:  toggle zoom (fit ↔ 2× at tap location)           */

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const ZOOM_IN_LEVEL = 2.0;   // zoom level for double-tap zoom-in
const TAP_THRESHOLD = 10;     // px — max movement to count as a tap
const TAP_TIMEOUT   = 250;    // ms — max duration for a tap
const DBLTAP_GAP    = 300;    // ms — max gap between taps for double-tap

export class TouchController {
  constructor(canvas, game) {
    this.cv = canvas;
    this.game = game;
    this.container = canvas.parentElement;

    /* transform state */
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this._fitZoom = 1;  // remember the fit-to-screen zoom level

    /* gesture tracking */
    this._touches = [];
    this._startDist = 0;
    this._startZoom = 1;
    this._startPanX = 0;
    this._startPanY = 0;
    this._startMidX = 0;
    this._startMidY = 0;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._dragStartPanX = 0;
    this._dragStartPanY = 0;
    this._moved = false;

    /* tap detection */
    this._tapStartTime = 0;
    this._tapStartPos = { x: 0, y: 0 };
    this._lastTapTime = 0;
    this._lastTapPos = { x: 0, y: 0 };

    /* bind events */
    canvas.addEventListener('touchstart',  e => this._onTouchStart(e), { passive: false });
    canvas.addEventListener('touchmove',   e => this._onTouchMove(e),  { passive: false });
    canvas.addEventListener('touchend',    e => this._onTouchEnd(e),   { passive: false });
    canvas.addEventListener('touchcancel', e => this._onTouchEnd(e),   { passive: false });

    /* initial fit */
    this._fitToScreen();
    window.addEventListener('resize', () => this._fitToScreen());
  }

  /* ── Fit the canvas to the screen on load / resize ── */
  _fitToScreen() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = this.cv.width;
    const ch = this.cv.height;
    this.zoom = Math.min(vw / cw, vh / ch);
    this._fitZoom = this.zoom;
    /* center the canvas */
    this.panX = (vw - cw * this.zoom) / 2;
    this.panY = (vh - ch * this.zoom) / 2;
    this._applyTransform();
  }

  /* ── Zoom to a specific level centered on a screen point ── */
  _zoomToPoint(newZoom, screenX, screenY) {
    /* find the canvas-space point under the screen tap */
    const canvasX = (screenX - this.panX) / this.zoom;
    const canvasY = (screenY - this.panY) / this.zoom;
    /* set new zoom and adjust pan so the same canvas point stays under the tap */
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    this.panX = screenX - canvasX * this.zoom;
    this.panY = screenY - canvasY * this.zoom;
    this._clampPan();
    this._applyTransform();
  }

  /* ── Apply CSS transform ── */
  _applyTransform() {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom));
    this.cv.style.transformOrigin = '0 0';
    this.cv.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    /* remove the default max-width/max-height so our transform controls sizing */
    this.cv.style.maxWidth = 'none';
    this.cv.style.maxHeight = 'none';
  }

  /* ── Clamp pan so the canvas stays reachable ── */
  _clampPan() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = this.cv.width * this.zoom;
    const ch = this.cv.height * this.zoom;

    if (cw <= vw) {
      /* canvas fits horizontally — center it */
      this.panX = (vw - cw) / 2;
    } else {
      /* canvas wider than viewport — allow full scroll, right edge can't go past left, left edge can't go past right */
      this.panX = Math.max(vw - cw, Math.min(0, this.panX));
    }

    if (ch <= vh) {
      /* canvas fits vertically — center it */
      this.panY = (vh - ch) / 2;
    } else {
      /* canvas taller than viewport — allow full scroll */
      this.panY = Math.max(vh - ch, Math.min(0, this.panY));
    }
  }

  /* ── Touch event handlers ── */

  _onTouchStart(e) {
    e.preventDefault();
    this._touches = Array.from(e.touches);

    if (e.touches.length === 1) {
      /* start tracking potential tap or drag */
      const t = e.touches[0];
      this._dragStartX = t.clientX;
      this._dragStartY = t.clientY;
      this._dragStartPanX = this.panX;
      this._dragStartPanY = this.panY;
      this._tapStartTime = Date.now();
      this._tapStartPos = { x: t.clientX, y: t.clientY };
      this._moved = false;
    }

    if (e.touches.length === 2) {
      /* start pinch */
      const [a, b] = [e.touches[0], e.touches[1]];
      this._startDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      this._startZoom = this.zoom;
      this._startPanX = this.panX;
      this._startPanY = this.panY;
      this._startMidX = (a.clientX + b.clientX) / 2;
      this._startMidY = (a.clientY + b.clientY) / 2;
      this._moved = true; // pinch is never a tap
    }
  }

  _onTouchMove(e) {
    e.preventDefault();

    if (e.touches.length === 1 && this._touches.length < 2) {
      /* single-finger pan */
      const t = e.touches[0];
      const dx = t.clientX - this._dragStartX;
      const dy = t.clientY - this._dragStartY;
      if (Math.abs(dx) > TAP_THRESHOLD || Math.abs(dy) > TAP_THRESHOLD) {
        this._moved = true;
      }
      this.panX = this._dragStartPanX + dx;
      this.panY = this._dragStartPanY + dy;
      this._clampPan();
      this._applyTransform();
    }

    if (e.touches.length === 2) {
      /* pinch zoom + pan */
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;

      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM,
        this._startZoom * (dist / this._startDist)));

      /* zoom centered on the pinch midpoint */
      const canvasX = (this._startMidX - this._startPanX) / this._startZoom;
      const canvasY = (this._startMidY - this._startPanY) / this._startZoom;
      this.zoom = newZoom;
      this.panX = midX - canvasX * newZoom;
      this.panY = midY - canvasY * newZoom;

      this._clampPan();
      this._applyTransform();
    }
  }

  _onTouchEnd(e) {
    e.preventDefault();
    const now = Date.now();

    /* detect tap (single touch that didn't move much, was short) */
    if (!this._moved && e.changedTouches.length === 1 && e.touches.length === 0) {
      const dt = now - this._tapStartTime;
      const t = e.changedTouches[0];
      const dx = Math.abs(t.clientX - this._tapStartPos.x);
      const dy = Math.abs(t.clientY - this._tapStartPos.y);

      if (dt < TAP_TIMEOUT && dx < TAP_THRESHOLD && dy < TAP_THRESHOLD) {
        /* check for double-tap */
        if (now - this._lastTapTime < DBLTAP_GAP) {
          /* toggle: if zoomed in, fit to screen; if fit, zoom in to tap point */
          if (this.zoom > this._fitZoom * 1.2) {
            this._fitToScreen();
          } else {
            this._zoomToPoint(ZOOM_IN_LEVEL, t.clientX, t.clientY);
          }
          this._lastTapTime = 0;
          this._touches = [];
          return;
        }
        this._lastTapTime = now;
        this._lastTapPos = { x: t.clientX, y: t.clientY };

        /* pass raw screen coords — _px() uses getBoundingClientRect()
           which already accounts for the CSS transform */
        this.game._hover(t);
        this.game._click(t);
      }
    }

    this._touches = Array.from(e.touches);
  }
}
