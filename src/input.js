// キーボード・ゲームパッド・タッチをまとめて { mx, my, shot, lob, drop } にする。
// mx: 右が +、my: 奥（前）が +。shot / lob / drop は押した瞬間だけ true。
export class Input {
  constructor() {
    this.keys = new Set();
    this.edges = new Set();
    this.touch = { mx: 0, my: 0, active: false };
    window.addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.edges.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.padPrev = {};
  }

  // タッチ操作の部品をつなぐ
  bindTouch(stickEl, knobEl, shotEl, lobEl, dropEl) {
    let id = null, cx = 0, cy = 0;
    const R = 50;
    const move = (x, y) => {
      let dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touch.mx = dx / R; this.touch.my = -dy / R;
    };
    stickEl.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      id = t.identifier;
      const r = stickEl.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      move(t.clientX, t.clientY);
    }, { passive: false });
    stickEl.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === id) move(t.clientX, t.clientY);
    }, { passive: false });
    const end = e => {
      for (const t of e.changedTouches) if (t.identifier === id) {
        id = null; this.touch.mx = this.touch.my = 0; knobEl.style.transform = '';
      }
    };
    stickEl.addEventListener('touchend', end);
    stickEl.addEventListener('touchcancel', end);
    const btn = (el, code) => el.addEventListener('touchstart', e => { e.preventDefault(); this.edges.add(code); el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 150); }, { passive: false });
    btn(shotEl, 'TouchShot');
    btn(lobEl, 'TouchLob');
    btn(dropEl, 'TouchDrop');
  }

  pressed(...codes) { return codes.some(c => this.edges.has(c)); }

  read() {
    const k = this.keys;
    let mx = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    let my = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0);
    let shot = this.pressed('Space', 'KeyJ', 'KeyZ', 'TouchShot');
    let lob = this.pressed('KeyK', 'KeyX', 'ShiftLeft', 'ShiftRight', 'TouchLob');
    let drop = this.pressed('KeyL', 'KeyC', 'TouchDrop');
    if (this.touch.mx || this.touch.my) { mx = this.touch.mx; my = this.touch.my; }
    // ゲームパッド
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.2) { mx = ax; my = -ay; }
      if (gp.buttons[14]?.pressed) mx = -1;
      if (gp.buttons[15]?.pressed) mx = 1;
      if (gp.buttons[12]?.pressed) my = 1;
      if (gp.buttons[13]?.pressed) my = -1;
      const now = { a: gp.buttons[0]?.pressed, b: gp.buttons[1]?.pressed, x: gp.buttons[2]?.pressed, y: gp.buttons[3]?.pressed, start: gp.buttons[9]?.pressed };
      if (now.a && !this.padPrev.a) shot = true;
      if (now.b && !this.padPrev.b) lob = true;
      if (now.x && !this.padPrev.x) drop = true;
      if (now.y && !this.padPrev.y) this.edges.add('KeyV');
      if (now.start && !this.padPrev.start) this.edges.add('Escape');
      this.padPrev = now;
      break;
    }
    return { mx, my, shot, lob, drop };
  }

  endFrame() { this.edges.clear(); }
}
