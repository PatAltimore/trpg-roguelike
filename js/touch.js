/* ═══════════ Mobile Pinch-Zoom & Pan ═══════════
   Manages CSS-transform based zoom/pan on the canvas container.
   Converts touch coordinates back to canvas-space for game input.

   Gestures:
   - Single tap:  game click
   - Single drag:  pan the view
   - Pinch:  zoom in/out
   - Double-tap:  reset zoom to fit screen                       */

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
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
    this.panX = 0;
    this.panY = 0;
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

  /* ── Clamp pan so canvas doesn't drift too far off-screen ── */
  _clampPan() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = this.cv.width * this.zoom;
    const ch = this.cv.height * this.zoom;
    /* allow some overscroll but keep at least 25% visible */
    const marginX = Math.min(cw * 0.25, vw * 0.5);
    const marginY = Math.min(ch * 0.25, vh * 0.5);
    this.panX = Math.max(-(cw - marginX), Math.min(marginX + vw - cw, this.panX));
    this.panY = Math.max(-(ch - marginY), Math.min(marginY + vh - ch, this.panY));
  }

  /* ── Convert screen touch position to the coordinate space _px() expects ── */
  /* _px() uses getBoundingClientRect(), which accounts for CSS transforms.
     So we just pass the raw screen coordinates through — _px() handles it. */

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
      const ratio = newZoom / this._startZoom;
      this.panX = midX - (this._startMidX - this._startPanX) * ratio;
      this.panY = midY - (this._startMidY - this._startPanY) * ratio;
      this.zoom = newZoom;

      /* also allow two-finger drag */
      this.panX += midX - this._startMidX - (this.panX - this._startPanX);
      this.panY += midY - this._startMidY - (this.panY - this._startPanY);

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
          this._fitToScreen();
          this._lastTapTime = 0;
          this._touches = [];
          return;
        }
        this._lastTapTime = now;

        /* pass raw screen coords — _px() uses getBoundingClientRect()
           which already accounts for the CSS transform */
        this.game._hover(t);
        this.game._click(t);
      }
    }

    this._touches = Array.from(e.touches);
  }
}
