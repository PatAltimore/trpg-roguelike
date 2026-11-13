/* The view bar above the playfield (see #viewbar in index.html): a 2D | 3D switch and,
   while the 3D view is showing, camera buttons (rotate, tilt, zoom, reset).

   Plain HTML buttons, so they sit outside the game canvas. The game tells the bar what
   to show each frame via update(); the bar reports clicks through onMode / onTool. */
export class ViewBar {
  constructor(root, { onMode, onTool }) {
    this.root = root;
    this.tools = root.querySelector('.vb-tools');
    this.modeBtns = [...root.querySelectorAll('[data-mode]')];
    this._state = '';
    root.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      b.blur();                                   /* keep the keyboard on the game (Enter / Space) */
      if (b.dataset.mode) onMode(b.dataset.mode === '3d');
      else if (b.dataset.tool) onTool(b.dataset.tool);
    });
  }

  /* sit over a stretch of the page: `left` px in from the edge, `width` px wide */
  place(left, width) {
    this.root.style.marginLeft = `${Math.round(left)}px`;
    this.root.style.width = `${Math.round(width)}px`;
  }

  /* visible: show the bar at all; mode3d: the chosen view; tools: show the camera buttons */
  update({ visible, mode3d, tools }) {
    const key = `${visible}|${mode3d}|${tools}`;
    if (key === this._state) return;
    this._state = key;
    this.root.hidden = !visible;
    this.tools.hidden = !tools;
    for (const b of this.modeBtns) b.setAttribute('aria-pressed', String((b.dataset.mode === '3d') === mode3d));
  }
}
