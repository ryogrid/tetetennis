// Instant-replay ring buffer (immersion 04 §4.1). Records the lightweight
// render state every frame — ball (active + position + spin) and both players'
// court positions — into a flat Float32Array, so a notable point can be played
// back through the SAME render.setBall / render.setPlayer calls in slow motion.
// This is recorded-state playback, NOT re-simulation, so it can never diverge
// from the original point. ~165 frames × 11 floats ≈ 7 KB.

const STRIDE = 11; // active, bx,by,bz, sx,sy,sz, p0x,p0z, p1x,p1z

export function createReplayBuffer(capacity = 420) { // ~7 s @ 60 fps
  const buf = new Float32Array(capacity * STRIDE);
  let head = 0;  // total frames ever written
  let count = 0; // frames currently held (≤ capacity)

  return {
    record(ball, p0, p1) {
      const o = (head % capacity) * STRIDE;
      const sp = ball.spin || { x: 0, y: 0, z: 0 };
      buf[o] = ball.active ? 1 : 0;
      buf[o + 1] = ball.pos.x; buf[o + 2] = ball.pos.y; buf[o + 3] = ball.pos.z;
      buf[o + 4] = sp.x; buf[o + 5] = sp.y; buf[o + 6] = sp.z;
      buf[o + 7] = p0.pos.x; buf[o + 8] = p0.pos.z;
      buf[o + 9] = p1.pos.x; buf[o + 10] = p1.pos.z;
      head++;
      if (count < capacity) count++;
    },
    frames() { return count; },
    // i in [0, count): 0 = oldest held frame, count-1 = most recent
    read(i) {
      const start = head - count;
      const idx = (((start + i) % capacity) + capacity) % capacity;
      const o = idx * STRIDE;
      return {
        active: buf[o] > 0.5,
        bx: buf[o + 1], by: buf[o + 2], bz: buf[o + 3],
        sx: buf[o + 4], sy: buf[o + 5], sz: buf[o + 6],
        p0x: buf[o + 7], p0z: buf[o + 8],
        p1x: buf[o + 9], p1z: buf[o + 10],
      };
    },
    clear() { head = 0; count = 0; },
    // Copy the last `n` held frames into a standalone clip (array of rows) for
    // the highlight reel, so it survives later overwrites of the ring buffer.
    snapshot(n) {
      const k = Math.min(n, count);
      const out = [];
      for (let i = count - k; i < count; i++) out.push(this.read(i));
      return out;
    },
  };
}
