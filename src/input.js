// Keyboard state: held keys + per-frame edge-triggered presses.
const ALIASES = {
  KeyJ: 'KeyZ', KeyK: 'KeyX', KeyL: 'KeyC',
};

export function createInput(onFirstInput) {
  const down = new Set();
  const pressed = new Set();
  let first = false;

  function norm(code) { return ALIASES[code] || code; }

  function firstInput() {
    if (!first) { first = true; if (onFirstInput) onFirstInput(); }
  }

  // any touch/click counts as first interaction (resumes audio context)
  window.addEventListener('pointerdown', firstInput);

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    firstInput();
    const code = norm(e.code);
    down.add(code);
    pressed.add(code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    down.delete(norm(e.code));
  });
  window.addEventListener('blur', () => down.clear());

  return {
    isDown: (code) => down.has(code),
    wasPressed: (code) => pressed.has(code),
    // on-screen buttons synthesize the same key codes as the keyboard
    setVirtualKey(code, isDown) {
      firstInput();
      if (isDown) {
        if (!down.has(code)) pressed.add(code);
        down.add(code);
      } else {
        down.delete(code);
      }
    },
    // movement vector from WASD + arrows, in court coords for the human
    // (+x right on screen, -z toward the net)
    moveVec() {
      let x = 0, z = 0;
      if (down.has('KeyA') || down.has('ArrowLeft')) x -= 1;
      if (down.has('KeyD') || down.has('ArrowRight')) x += 1;
      if (down.has('KeyW') || down.has('ArrowUp')) z -= 1;
      if (down.has('KeyS') || down.has('ArrowDown')) z += 1;
      const m = Math.hypot(x, z);
      if (m > 1) { x /= m; z /= m; }
      return { x, z };
    },
    // aim from held keys at contact: x -1..1, depth +1 deep / -1 short
    aimVec() {
      const v = this.moveVec();
      return { x: v.x, depth: -v.z }; // W/up = deep
    },
    shotKeyPressed() {
      if (pressed.has('KeyZ')) return 'flat';
      if (pressed.has('KeyX')) return 'topspin';
      if (pressed.has('KeyC')) return 'slice';
      return null;
    },
    endFrame() { pressed.clear(); },
  };
}
