// All SFX synthesized with Web Audio. No assets. Adapted from old/src/audio.js
// into a factory that returns the host.audio surface plus initAudio().
//
// The MoonBit logic calls these as:
//   audio.sfxHit(speed), audio.sfxBounce(speed, surfaceId), audio.sfxCrowd(i)
//   audio[name]()  for the no-arg cues (sfxToss, sfxFault, sfxNet, sfxOut,
//                  sfxMenu, sfxConfirm, sfxReachAlert)
import racketUrl from './sound/tennis-racket1.mp3?url';

export function createAudio() {
  let ctx = null;
  let master = null;
  let whiteBuf = null;
  let pinkBuf = null;
  let reverb = null;     // ConvolverNode (procedural IR)
  let reverbSend = null; // wet bus
  const samples = {};    // optional decoded hit samples by shot type
  let hitBuffer = null;  // tennis-racket1.mp3, used for ALL hit sounds (serve/smash/stroke)
  let ambientNodes = null; // continuous crowd murmur bed (immersion 03 §3.1)
  let wantAmbient = false;  // ambient requested before the audio ctx existed
  let gruntsEnabled = true; // player effort grunts on big hits (immersion 03 §3.3)
  let footstepsEnabled = true; // footstep / slide SFX (immersion 03 §3.4)

  // Procedural impulse response: decaying stereo noise.
  function makeReverbIR(sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function initAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);

    // small procedural room reverb on a wet send bus
    reverb = ctx.createConvolver();
    reverb.buffer = makeReverbIR(1.1, 2.6);
    reverb.connect(ctx.destination);
    reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.18;
    reverbSend.connect(reverb);

    loadSamples();    // optional per-type samples; falls back to synth if absent
    loadHitSample();  // the bundled racket sample, used for every hit

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

    // a match may have started before the first user gesture created the ctx;
    // honour a pending ambient-bed request now that pinkBuf exists.
    if (wantAmbient) ambient(true);
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

  // Optional recorded hit samples. Drop {flat,topspin,slice,lob,drop,serve}.mp3
  // into src/audio/samples/ (see CREDITS.md) to use them; otherwise the synth
  // below is used. Kept fully offline-friendly: a missing manifest just no-ops.
  async function loadSamples() {
    try {
      const res = await fetch('audio/samples/manifest.json');
      if (!res.ok) return;
      const list = await res.json(); // { flat: "flat.mp3", ... }
      for (const [type, file] of Object.entries(list)) {
        try {
          const r = await fetch(`audio/samples/${file}`);
          const arr = await r.arrayBuffer();
          samples[type] = await ctx.decodeAudioData(arr);
        } catch { /* skip this one */ }
      }
    } catch { /* no samples bundled -> synth fallback */ }
  }

  // Load the bundled racket-hit sample (self-hosted in src/sound). Every hit
  // sound (serve / smash / stroke) plays this buffer; falls back to the synth
  // if it can't be decoded.
  async function loadHitSample() {
    try {
      const r = await fetch(racketUrl);
      const arr = await r.arrayBuffer();
      hitBuffer = await ctx.decodeAudioData(arr);
    } catch { /* decode failed -> synth fallback */ }
  }

  // per-shot tone shaping for the synth hit
  const SHOT = {
    flat:    { body: 220, bright: 1.00, ring: 0,  brush: 0.0, rate: 1.00 },
    topspin: { body: 200, bright: 0.85, ring: 1,  brush: 0.5, rate: 1.02 },
    slice:   { body: 240, bright: 0.70, ring: -1, brush: 0.4, rate: 1.05 },
    lob:     { body: 175, bright: 0.50, ring: 0,  brush: 0.1, rate: 0.92 },
    drop:    { body: 185, bright: 0.45, ring: -1, brush: 0.2, rate: 0.90 },
    serve:   { body: 205, bright: 1.10, ring: 0,  brush: 0.0, rate: 0.96 },
  };

  // Racket impact: a 5-layer synth (Body, Crack, Shimmer, String Ring, Brush)
  // shaped per shot type, panned by contact x, with a reverb send. A jammed
  // (mishit) contact is detuned and low-passed into a dull thud.
  // Player effort grunt: two detuned sawtooths through "ah"-vowel formant
  // bandpasses with a quick pitch-drop, fired on hard contacts. (immersion 03 §3.3)
  function sfxGrunt(speed, pan) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const sN = Math.min(speed / 55, 1);
    const f0 = 118 + Math.random() * 70; // grunt fundamental
    const out = ctx.createGain();
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) { panner.pan.value = Math.max(-1, Math.min(1, pan || 0)); out.connect(panner); panner.connect(master); }
    else out.connect(master);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass'; f1.frequency.value = 720; f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass'; f2.frequency.value = 1150; f2.Q.value = 8;
    const mix = ctx.createGain();
    f1.connect(mix); f2.connect(mix);
    const g = ctx.createGain();
    const v = 0.05 + sN * 0.12;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    mix.connect(g).connect(out);
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0 * 1.6, t);
      o.frequency.exponentialRampToValueAtTime(f0, t + 0.12);
      o.detune.value = det;
      o.connect(f1); o.connect(f2);
      o.start(t); o.stop(t + 0.32);
    }
  }

  function setGrunts(on) { gruntsEnabled = !!on; }
  function setFootsteps(on) { footstepsEnabled = !!on; }

  // Latest 0..1 match tension (immersion 06 §6.0). Stored here so the ambient
  // crowd bed can swell with the moment (mid-rally reactions build on this).
  let tensionLevel = 0;
  function setTension(v) {
    tensionLevel = Math.max(0, Math.min(1, v || 0));
    // lift the ambient bed a touch on tense points
    if (ambientNodes) {
      ambientNodes.g.gain.setTargetAtTime(
        ambientGainTarget * (1 + tensionLevel * 0.8), ctx.currentTime, 0.6);
    }
  }
  function getTension() { return tensionLevel; }

  // A short crowd vocal reaction (immersion 03 §3.2): "groan" (error, falling),
  // "ooh"/gasp (near-miss, rising), "cheer" (winner, bright).
  function sfxCrowdReact(kind, intensity) {
    if (!ctx || !pinkBuf) return;
    const t = ctx.currentTime;
    const v = 0.10 + Math.min(Math.max(intensity || 0.5, 0), 1) * 0.18;
    const dur = kind === 'cheer' ? 1.2 : 0.7;
    const n = noiseSrc(pinkBuf, dur);
    const f = ctx.createBiquadFilter();
    if (kind === 'groan') {
      f.type = 'lowpass';
      f.frequency.setValueAtTime(900, t);
      f.frequency.exponentialRampToValueAtTime(280, t + dur);
    } else if (kind === 'cheer') {
      f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.6;
    } else { // ooh / gasp
      f.type = 'bandpass'; f.Q.value = 0.7;
      f.frequency.setValueAtTime(700, t);
      f.frequency.exponentialRampToValueAtTime(1400, t + dur * 0.6);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + (kind === 'cheer' ? 0.25 : 0.12));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(master);
  }

  // Briefly lift the ambient crowd bed on each hit so a long rally audibly
  // builds (it settles back toward the tension-scaled base).
  function bumpCrowd() {
    if (!ambientNodes) return;
    const now = ctx.currentTime;
    const base = ambientGainTarget * (1 + tensionLevel * 0.8);
    ambientNodes.g.gain.setTargetAtTime(base * 1.6, now, 0.12);
    ambientNodes.g.gain.setTargetAtTime(base, now + 0.25, 1.1);
  }

  function sfxHit(speed, type, pan, jammed) {
    if (!ctx) return;
    bumpCrowd(); // a rally that keeps going lifts the crowd
    // effort grunt on hard, clean contacts (serves/smashes/big drives)
    if (gruntsEnabled && !jammed && speed > 20
        && Math.random() < 0.45 + Math.min(speed / 55, 1) * 0.4) {
      sfxGrunt(speed, pan);
    }
    const s = SHOT[type] || SHOT.flat;
    const sNorm = Math.min((speed || 20) / 55, 1);
    const jit = 1 + (Math.random() - 0.5) * 0.06; // pitch jitter every hit
    const out = ctx.createGain();
    out.gain.value = jammed ? 0.7 : 1.0;
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) { panner.pan.value = Math.max(-1, Math.min(1, pan || 0)); out.connect(panner); panner.connect(master); panner.connect(reverbSend); }
    else { out.connect(master); out.connect(reverbSend); }

    // a jammed contact dulls everything through a low-pass
    let bus = out;
    if (jammed) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 600;
      lp.connect(out); bus = lp;
    }

    // Play the racket sample for every hit (per-type override > bundled racket),
    // still panned/reverbed. Tuned a bit "heavier": the pitch is dropped and the
    // highs are rolled off so the impact sounds weightier.
    const buf = samples[type] || hitBuffer;
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      // 0.86 base detune lowers the pitch for a heavier body (jammed dips further).
      src.playbackRate.value = s.rate * jit * (jammed ? 0.78 : 0.86);
      // Low-pass to thicken. A jammed contact already routes through a 600 Hz
      // lp via `bus`; a clean hit gets a gentler 2500 Hz roll-off here.
      let dst = bus;
      if (!jammed) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2500;
        lp.connect(bus);
        dst = lp;
      }
      const g = ctx.createGain();
      env(g, 0.55 + 0.5 * sNorm, 0.001, 0.26);
      src.connect(g).connect(dst);
      src.start();
      return;
    }

    const bright = s.bright * (jammed ? 0.4 : 1) * (0.7 + 0.3 * sNorm);
    const body = s.body * jit;

    // (1) Body / Pock: triangle swooping from high down to bodyHz
    const o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(body * 6, ctx.currentTime);
    o1.frequency.exponentialRampToValueAtTime(body, ctx.currentTime + 0.05);
    const g1 = ctx.createGain();
    env(g1, 0.45 * (0.5 + sNorm), 0.001, 0.09);
    o1.connect(g1).connect(bus); o1.start(); o1.stop(ctx.currentTime + 0.12);

    // (2) Crack / Attack: sharp high-passed noise click
    const n2 = noiseSrc(whiteBuf, 0.03);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2600 * bright;
    const g2 = ctx.createGain();
    env(g2, 0.30 * bright, 0.0005, 0.03);
    n2.connect(hp).connect(g2).connect(bus);

    // (3) Shimmer: 1.8-2.8kHz bandpass noise for high-end sparkle
    const n3 = noiseSrc(whiteBuf, 0.06);
    const bp3 = ctx.createBiquadFilter();
    bp3.type = 'bandpass'; bp3.frequency.value = (1800 + 1000 * sNorm) * bright; bp3.Q.value = 0.8;
    const g3 = ctx.createGain();
    env(g3, 0.18 * bright, 0.001, 0.06);
    n3.connect(bp3).connect(g3).connect(bus);

    // (4) String Ring: high-Q bandpass tail, centre sweeps up (topspin) / down (slice)
    const n4 = noiseSrc(whiteBuf, 0.12);
    const bp4 = ctx.createBiquadFilter();
    bp4.type = 'bandpass'; bp4.Q.value = 9;
    bp4.frequency.setValueAtTime(body * 3, ctx.currentTime);
    bp4.frequency.exponentialRampToValueAtTime(body * 3 * (1 + 0.4 * s.ring), ctx.currentTime + 0.12);
    const g4 = ctx.createGain();
    env(g4, 0.16, 0.002, 0.12);
    n4.connect(bp4).connect(g4).connect(bus);

    // (5) Brush / Scrape: spin shots get a little scraping noise
    if (s.brush > 0) {
      const n5 = noiseSrc(whiteBuf, 0.08);
      const bp5 = ctx.createBiquadFilter();
      bp5.type = 'bandpass'; bp5.frequency.value = 3200; bp5.Q.value = 0.5;
      const g5 = ctx.createGain();
      env(g5, 0.10 * s.brush, 0.004, 0.08);
      n5.connect(bp5).connect(g5).connect(bus);
    }
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

  // Footstep tick: a short filtered-noise scuff flavoured by surface, panned by
  // court x, volume scaled by player speed. (immersion 03 §3.4)
  function sfxFootstep(speed, surfaceId, pan) {
    if (!ctx || !whiteBuf || !footstepsEnabled) return;
    const v = Math.min(0.04 + speed * 0.011, 0.15);
    const out = ctx.createGain();
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) { panner.pan.value = Math.max(-1, Math.min(1, pan || 0)); out.connect(panner); panner.connect(master); }
    else out.connect(master);
    const n = noiseSrc(whiteBuf, 0.06);
    const f = ctx.createBiquadFilter();
    if (surfaceId === 'hard') { f.type = 'highpass'; f.frequency.value = 1600; }
    else if (surfaceId === 'clay') { f.type = 'lowpass'; f.frequency.value = 700; }
    else { f.type = 'lowpass'; f.frequency.value = 1100; }
    const g = ctx.createGain();
    env(g, v, 0.002, surfaceId === 'hard' ? 0.05 : 0.08);
    n.connect(f).connect(g).connect(out);
    // hard courts squeak at speed: a quick rising chirp
    if (surfaceId === 'hard' && speed > 6) {
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(900, t);
      o.frequency.exponentialRampToValueAtTime(1550, t + 0.08);
      const g2 = ctx.createGain();
      env(g2, v * 0.5, 0.004, 0.09);
      o.connect(g2).connect(out);
      o.start(t); o.stop(t + 0.13);
    }
  }

  // Clay slide: a longer band-passed pink-noise scrape for a sliding stop.
  function sfxSlide(speed, pan) {
    if (!ctx || !pinkBuf || !footstepsEnabled) return;
    const v = Math.min(0.05 + speed * 0.01, 0.14);
    const out = ctx.createGain();
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) { panner.pan.value = Math.max(-1, Math.min(1, pan || 0)); out.connect(panner); panner.connect(master); }
    else out.connect(master);
    const t = ctx.currentTime;
    const n = noiseSrc(pinkBuf, 0.35);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1600, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.3);
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    n.connect(bp).connect(g).connect(out);
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

  // Continuous ambient crowd bed: a low looped pink-noise murmur through a
  // slowly-breathing lowpass, so the stadium is never dead-silent between
  // points. Started at match start, stopped at teardown. (immersion 03 §3.1)
  let ambientGainTarget = 0.045;
  function ambient(on) {
    if (!ctx) { wantAmbient = on; return; } // defer until initAudio builds pinkBuf
    wantAmbient = on;
    if (on) {
      if (ambientNodes || !pinkBuf) return; // already running / no buffer yet
      const src = ctx.createBufferSource();
      src.buffer = pinkBuf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 480;
      // slow LFO on the cutoff → a gentle "breathing" murmur, not a flat hiss
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 180;
      lfo.connect(lfoG).connect(lp.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.setTargetAtTime(ambientGainTarget, ctx.currentTime, 1.5); // fade in
      src.connect(lp).connect(g).connect(master);
      src.start();
      lfo.start();
      ambientNodes = { src, lp, g, lfo };
    } else {
      if (!ambientNodes) return;
      const { src, g, lfo } = ambientNodes;
      const t = ctx.currentTime;
      g.gain.setTargetAtTime(0.0001, t, 0.4); // fade out
      try { src.stop(t + 2); lfo.stop(t + 2); } catch { /* already stopped */ }
      ambientNodes = null;
    }
  }

  // Live volume control for the ambient bed (used by the settings panel and by
  // mid-rally crowd swells, immersion 03 §3.2 / 07 §7.1).
  function setAmbientLevel(v) {
    ambientGainTarget = Math.max(0, v);
    if (ambientNodes) ambientNodes.g.gain.setTargetAtTime(ambientGainTarget, ctx.currentTime, 0.3);
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

  // Perfect-Hit bell: a clear two-partial chime stacked on top of the hit.
  function sfxPerfect() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, v, d] of [[1568, 0.16, 0.28], [2349, 0.09, 0.22]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(g).connect(master);
      if (reverbSend) g.connect(reverbSend);
      osc.start(t);
      osc.stop(t + d + 0.02);
    }
  }

  return {
    initAudio,
    sfxHit, sfxBounce, sfxCrowd, sfxNet, sfxOut, sfxFault,
    sfxToss, sfxMenu, sfxConfirm, sfxReachAlert, sfxPerfect,
    ambient, setAmbientLevel, sfxFootstep, sfxSlide,
    sfxGrunt, setGrunts, setFootsteps, setTension, getTension,
    sfxCrowdReact,
  };
}
