// Keyboard state: held keys + per-frame edge-triggered presses. PULL model:
// the MoonBit logic queries this each frame (moveX/moveZ/wasPressed/shotKey).
// Adapted from old/src/input.js; moveVec() split into moveX()/moveZ(), and
// shotKeyPressed() (null|'flat'|...) -> shotKey() ('' | 'flat' | ...).
const ALIASES = {
  KeyJ: 'KeyZ', KeyK: 'KeyX', KeyL: 'KeyC',
};

export function createInput(onFirstInput) {
  const down = new Set();
  const pressed = new Set();
  // analog movement (touch joystick): used in place of the arrow keys when active
  const axis = { x: 0, z: 0, active: false };
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

  // movement vector in court coords for the human (+x right on screen, -z
  // toward the net): the analog joystick when active, else the arrow keys
  function moveVec() {
    if (axis.active) {
      let { x, z } = axis;
      const m = Math.hypot(x, z);
      if (m > 1) { x /= m; z /= m; }
      return { x, z };
    }
    let x = 0, z = 0;
    if (down.has('ArrowLeft')) x -= 1;
    if (down.has('ArrowRight')) x += 1;
    if (down.has('ArrowUp')) z -= 1;
    if (down.has('ArrowDown')) z += 1;
    const m = Math.hypot(x, z);
    if (m > 1) { x /= m; z /= m; }
    return { x, z };
  }

  return {
    isDown: (code) => down.has(code),
    wasPressed: (code) => pressed.has(code),
    moveX() { return moveVec().x; },
    moveZ() { return moveVec().z; },
    // "" if none, else 'flat' | 'topspin' | 'slice' | 'drop'
    shotKey() {
      if (pressed.has('KeyZ')) return 'flat';
      if (pressed.has('KeyX')) return 'topspin';
      if (pressed.has('KeyC')) return 'slice';
      if (pressed.has('KeyV')) return 'drop';
      return '';
    },
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
    // analog movement from the touch joystick (court coords); (0,0) = released
    setMoveAxis(x, z) {
      firstInput();
      axis.x = x; axis.z = z;
      axis.active = Math.hypot(x, z) > 0.001;
    },
    endFrame() { pressed.clear(); },
  };
}
