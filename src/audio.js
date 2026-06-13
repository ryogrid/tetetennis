// All SFX synthesized with Web Audio. No assets. Adapted from old/src/audio.js
// into a factory that returns the host.audio surface plus initAudio().
//
// The MoonBit logic calls these as:
//   audio.sfxHit(speed), audio.sfxBounce(speed, surfaceId), audio.sfxCrowd(i)
//   audio[name]()  for the no-arg cues (sfxToss, sfxFault, sfxNet, sfxOut,
//                  sfxMenu, sfxConfirm, sfxReachAlert)
export function createAudio() {
  let ctx = null;
  let master = null;
  let whiteBuf = null;
  let pinkBuf = null;

  function initAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);

    const len = 2 * ctx.sampleRate;
    whiteBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = whiteBuf.getChannelData(0);
    for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;

    // Paul Kellet pink noise approximation
    pinkBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const p = pinkBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      p[i] = (b0 + b1 + b2 + white * 0.1848) * 0.25;
    }
  }

  function noiseSrc(buf, dur) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start(ctx.currentTime, Math.random() * 1.0, dur + 0.1);
    src.stop(ctx.currentTime + dur + 0.1);
    return src;
  }

  function env(gainNode, peak, attack, decay) {
    const t = ctx.currentTime;
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  // Racket impact. speed in m/s (~10-55).
  function sfxHit(speed) {
    if (!ctx) return;
    const sNorm = Math.min(speed / 55, 1);
    const noise = noiseSrc(whiteBuf, 0.09);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400 + speed * 25;
    bp.Q.value = 1.2;
    const g1 = ctx.createGain();
    env(g1, 0.5 + 0.4 * sNorm, 0.002, 0.09);
    noise.connect(bp).connect(g1).connect(master);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 180 + speed * 1.5;
    const g2 = ctx.createGain();
    env(g2, 0.4 * (0.5 + sNorm), 0.002, 0.06);
    osc.connect(g2).connect(master);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  }

  // Ground bounce; surfaceId 'clay' | 'grass' | 'hard'.
  const BOUNCE_CUTOFF = { clay: 900, grass: 550, hard: 2200 };
  function sfxBounce(speed, surfaceId) {
    if (!ctx) return;
    const sNorm = Math.min(speed / 40, 1);
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.08);
    const g1 = ctx.createGain();
    env(g1, 0.5 * (0.3 + 0.7 * sNorm), 0.002, 0.11);
    osc.connect(g1).connect(master);
    osc.start();
    osc.stop(t + 0.15);

    const noise = noiseSrc(whiteBuf, 0.06);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = BOUNCE_CUTOFF[surfaceId] || 1200;
    const g2 = ctx.createGain();
    env(g2, 0.25 * (0.3 + 0.7 * sNorm), 0.002, 0.07);
    noise.connect(lp).connect(g2).connect(master);
  }

  function sfxNet() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.12);
    const g = ctx.createGain();
    env(g, 0.35, 0.003, 0.18);
    // rattle LFO on the gain
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 30;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.15;
    lfo.connect(lfoG).connect(g.gain);
    osc.connect(g).connect(master);
    const noise = noiseSrc(whiteBuf, 0.1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 400;
    const g2 = ctx.createGain();
    env(g2, 0.2, 0.003, 0.1);
    noise.connect(bp).connect(g2).connect(master);
    osc.start(); lfo.start();
    osc.stop(t + 0.2); lfo.stop(t + 0.2);
  }

  // Crowd swell at point end. intensity 0..1.
  function sfxCrowd(intensity) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 1.8;
    const noise = noiseSrc(pinkBuf, dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.35 * intensity, t + 0.3);
    g.gain.setValueAtTime(0.35 * intensity, t + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    noise.connect(lp).connect(g).connect(master);
    // "voices" layer
    const noise2 = noiseSrc(pinkBuf, dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200;
    bp.Q.value = 0.7;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.linearRampToValueAtTime(0.10 * intensity, t + 0.35);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    noise2.connect(bp).connect(g2).connect(master);
  }

  function beep(freq, when, dur, vol = 0.22) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime + when;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.setValueAtTime(vol, t + dur - 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function sfxOut() {
    if (!ctx) return;
    beep(880, 0, 0.12);
    beep(880, 0.2, 0.12);
  }

  function sfxFault() {
    if (!ctx) return;
    beep(660, 0, 0.15);
  }

  function sfxToss() {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1200;
    const g = ctx.createGain();
    env(g, 0.08, 0.002, 0.03);
    osc.connect(g).connect(master);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  }

  function sfxMenu() {
    if (!ctx) return;
    beep(520, 0, 0.05, 0.1);
  }
  function sfxConfirm() {
    if (!ctx) return;
    beep(520, 0, 0.06, 0.12);
    beep(780, 0.07, 0.09, 0.12);
  }

  // Subtle alert when the ball enters the player's reach zone
  function sfxReachAlert() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.04);
    const g = ctx.createGain();
    env(g, 0.10, 0.005, 0.06);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  return {
    initAudio,
    sfxHit, sfxBounce, sfxCrowd, sfxNet, sfxOut, sfxFault,
    sfxToss, sfxMenu, sfxConfirm, sfxReachAlert,
  };
}
