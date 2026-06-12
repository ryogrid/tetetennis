// Orchestrator: app/point state machines. Wires physics, entities, AI,
// scoring, UI and audio together.
import { CHARACTERS } from './characters.js';
import { createMatch, addPoint, scoreStrings, pointNumberInGame } from './match.js';
import { SURFACES, COURT, LINE_GRACE, STATS_MAP, G, IDEAL_CONTACT_H, PLAYER_BOUNDS } from './physics/constants.js';
import { stepBall, predictLanding, predictHitPoint, predictTrajectory } from './physics/ball.js';
import { computeStroke } from './game/shots.js';
import { computeServe, serveStanceX, isServeBoxIn, serveBox } from './game/serve.js';
import { createPlayer, SWING_CONTACT_T } from './entities/player.js';
import { createBallEntity } from './entities/ball.js';
import { buildCourt } from './court.js';
import { createAI, updateAI, chooseServe, DIFFICULTIES } from './ai.js';
import * as ui from './ui.js';
import * as audio from './audio.js';

const SURFACE_IDS = ['clay', 'grass', 'hard'];
const POINT_OVER_DUR = 2.0;

export function createGame(scene, cameraRig, input) {
  const g = {
    scene, cameraRig, input,
    state: 'menu_char',
    menuIdx: 0,
    sel: { player: null, opp: null, surfaceId: 'hard', difficulty: 'normal' },

    // match objects (created in startMatch)
    court: null, ball: null, human: null, cpu: null, ai: null,
    match: null, surface: null,
    pointState: 'pre_serve',
    serveNumber: 1,
    courtSide: 'deuce',
    rally: null,
    ballStamp: 0,
    sweetStamp: -1,
    sweetPos: null,
    time: 0,
    stateTimer: 0,
    cpuServePlan: null,
    events: [],
  };

  ui.initUI({ onVirtualKey: (code, isDown) => input.setVirtualKey(code, isDown) });
  ui.showCharSelect('SELECT YOUR PLAYER', CHARACTERS, g.menuIdx);

  // ---------- menu navigation (shared by keyboard and tap) ----------

  function showCharMenu() {
    ui.showCharSelect('SELECT YOUR PLAYER', CHARACTERS, g.menuIdx);
  }
  function showOppMenu() {
    ui.showCharSelect('SELECT OPPONENT', CHARACTERS, g.menuIdx, `You: ${g.sel.player.name}`);
  }
  function confirmChar() {
    audio.sfxConfirm();
    g.sel.player = CHARACTERS[g.menuIdx];
    g.state = 'menu_opp';
    g.menuIdx = 0;
    showOppMenu();
  }
  function confirmOpp() {
    audio.sfxConfirm();
    g.sel.opp = CHARACTERS[g.menuIdx];
    g.state = 'menu_surface';
    g.menuIdx = 2; // default hard
    ui.showSurfaceSelect(g.menuIdx);
  }
  function confirmSurface() {
    audio.sfxConfirm();
    g.sel.surfaceId = SURFACE_IDS[g.menuIdx];
    g.state = 'menu_difficulty';
    g.menuIdx = 1; // default normal
    ui.showDifficultySelect(DIFFICULTIES, g.menuIdx);
  }
  function confirmDifficulty() {
    audio.sfxConfirm();
    g.sel.difficulty = DIFFICULTIES[g.menuIdx].id;
    startMatch();
  }
  function backToCharMenu() {
    g.state = 'menu_char';
    g.menuIdx = 0;
    showCharMenu();
  }

  ui.setMenuTapHandler((idx) => {
    if (g.state === 'results') { backToCharMenu(); return; }
    if (g.state !== 'menu_char' && g.state !== 'menu_opp' &&
        g.state !== 'menu_surface' && g.state !== 'menu_difficulty') return;
    const count = (g.state === 'menu_surface' || g.state === 'menu_difficulty')
      ? 3 : CHARACTERS.length;
    if (typeof idx !== 'number' || idx < 0 || idx >= count) return;
    if (idx === g.menuIdx) {
      if (g.state === 'menu_char') confirmChar();
      else if (g.state === 'menu_opp') confirmOpp();
      else if (g.state === 'menu_surface') confirmSurface();
      else confirmDifficulty();
    } else {
      g.menuIdx = idx;
      audio.sfxMenu();
      if (g.state === 'menu_char') showCharMenu();
      else if (g.state === 'menu_opp') showOppMenu();
      else if (g.state === 'menu_surface') ui.showSurfaceSelect(g.menuIdx);
      else ui.showDifficultySelect(DIFFICULTIES, g.menuIdx);
    }
  });

  // ---------- helpers ----------

  function names() {
    return { p: g.sel.player.name + ' (You)', c: g.sel.opp.name };
  }

  function refreshScore() {
    const n = names();
    ui.updateScore(scoreStrings(g.match), n.p, n.c, g.serveNumber);
  }

  function showSweet(pos) {
    g.sweetPos = pos;
    g.ball.showSweetSpot(pos);
  }
  function hideSweet() {
    g.sweetPos = null;
    g.ball.hideSweetSpot();
    g.ball.hideTrail();
    ui.hideMoveHint();
  }

  // trajectory trail: from a little before the bounce through the
  // post-bounce arc, on the human's side only. The post-bounce point nearest
  // waist height is highlighted as the ideal hitting point.
  function showTrajectoryTrail() {
    const alreadyBounced = g.rally.bounces > 0;
    const { points, bounceT } = predictTrajectory(
      g.ball.state, g.surface, 1, 4, 0.04, alreadyBounced);
    if (bounceT === null) { g.ball.hideTrail(); return; }
    const from = alreadyBounced ? 0 : bounceT - 0.45;
    const shown = points.filter((p) => p.t >= from && p.z > 0.3);
    let idealIdx = -1, best = 0.25; // only when within 0.25 m of waist height
    for (let i = 0; i < shown.length; i++) {
      if (!shown[i].afterBounce) continue;
      const dh = Math.abs(shown[i].y - IDEAL_CONTACT_H);
      if (dh < best) { best = dh; idealIdx = i; }
    }
    g.ball.showTrail(shown, idealIdx);
  }

  function startMatch() {
    g.surface = SURFACES[g.sel.surfaceId];
    g.court = buildCourt(g.sel.surfaceId);
    scene.add(g.court);
    g.ball = createBallEntity(scene);
    g.human = createPlayer({ side: 'P', character: g.sel.player, scene });
    g.human.root.visible = true; // third-person view: player visible from behind
    g.ai = createAI(g.sel.opp, g.sel.difficulty);
    g.cpu = createPlayer({
      side: 'C', character: g.sel.opp, scene, speedMul: g.ai.diff.speedMul,
    });
    g.match = createMatch('P');
    g.time = 0;
    g.state = 'match';
    g.serveNumber = 1;
    ui.hideMenu();
    ui.showHUD();
    nextPoint();
    cameraRig.snap(cameraMode(), g.human, g.ball.state);
  }

  function teardownMatch() {
    if (g.court) { scene.remove(g.court); g.court = null; }
    if (g.ball) { g.ball.dispose(); g.ball = null; }
    if (g.human) { g.human.dispose(); g.human = null; }
    if (g.cpu) { g.cpu.dispose(); g.cpu = null; }
    ui.hideHUD();
  }

  function server() { return g.match.server; }
  function receiver() { return g.match.server === 'P' ? 'C' : 'P'; }
  function ent(side) { return side === 'P' ? g.human : g.cpu; }
  function charOf(side) { return side === 'P' ? g.sel.player : g.sel.opp; }

  function nextPoint() {
    g.serveNumber = g.serveNumber; // kept across faults; reset by pointEnd
    g.courtSide = pointNumberInGame(g.match) % 2 === 0 ? 'deuce' : 'ad';
    positionForServe();
    refreshScore();
  }

  function positionForServe() {
    const sv = server(), rc = receiver();
    const svSign = sv === 'P' ? 1 : -1;
    const stanceX = serveStanceX(sv, g.courtSide);
    ent(sv).place(stanceX, svSign * (COURT.halfLen + 0.4));
    const box = serveBox(sv, g.courtSide);
    const boxCx = (box.xMin + box.xMax) / 2;
    ent(rc).place(boxCx * 1.4, -svSign * (COURT.halfLen + 0.7));
    if (sv === 'P') cameraRig.setServeLookX(boxCx);
    g.ball.state.active = false;
    g.ball.hideLanding();
    hideSweet();
    g.rally = { phase: 'idle', lastHitBy: null, bounces: 0, serveNetTouched: false };
    g.pointState = 'pre_serve';
    g.stateTimer = 0;
    g.cpuServePlan = null;
    ent(sv).endServeAnim();
  }

  function startToss() {
    const sv = server();
    const e = ent(sv);
    const svSign = sv === 'P' ? 1 : -1;
    const b = g.ball.state;
    b.active = true;
    b.pos = { x: e.pos.x + 0.15 * svSign, y: 1.7, z: e.pos.z - 0.3 * svSign };
    const contactH = STATS_MAP.serveContactH(e.stats.REA);
    b.vel = { x: 0, y: Math.sqrt(2 * G * (contactH - 1.7 + 0.18)), z: 0 };
    b.spin = { x: 0, y: 0, z: 0 };
    e.startServeAnim();
    g.pointState = 'serving';
    audio.sfxToss();
  }

  function executeServe(type, qServe, preset, aimAdjust, aimDepth) {
    const sv = server();
    const e = ent(sv);
    const b = g.ball.state;
    const contactH = STATS_MAP.serveContactH(e.stats.REA);
    const from = {
      x: b.pos.x,
      y: Math.max(1.6, Math.min(b.pos.y, contactH)),
      z: b.pos.z,
    };
    const res = computeServe({
      stats: e.stats, type, from, servingSide: sv, courtSide: g.courtSide,
      targetPreset: preset, aimAdjust, aimDepth, qServe,
    });
    b.pos = from;
    b.vel = res.vel;
    b.spin = res.spin;
    g.rally = { phase: 'serve', lastHitBy: sv, bounces: 0, serveNetTouched: false };
    g.pointState = 'rally';
    g.ballStamp++;
    const speed = Math.hypot(res.vel.x, res.vel.y, res.vel.z);
    audio.sfxHit(speed);
    ui.serveSpeedToast(speed * 3.6);
    const landing = predictLanding(b, g.surface);
    if (landing) g.ball.showLanding(landing.pos);
    if (sv === 'P') ui.flashShot(type === 'kick' ? 'topspin' : type);
  }

  function attemptContact(side, type, aim) {
    const b = g.ball.state;
    if (!b.active || !g.rally || g.rally.phase !== 'live') return;
    if (g.rally.lastHitBy === side) return;
    const sideSign = side === 'P' ? 1 : -1;
    if (b.pos.z * sideSign < -0.2) return; // ball not on this player's side
    const e = ent(side);
    const res = computeStroke({
      playerPos: { x: e.pos.x, z: e.pos.z },
      ballPos: b.pos,
      ballVel: b.vel,
      stats: e.stats,
      shotType: type,
      aim,
      side,
    });
    if (!res) return; // whiff
    if (side === 'P') hideSweet();
    b.vel = res.vel;
    b.spin = res.spin;
    g.rally.lastHitBy = side;
    g.rally.bounces = 0;
    g.rally.serveNetTouched = false;
    g.ballStamp++;
    audio.sfxHit(Math.hypot(res.vel.x, res.vel.y, res.vel.z));
    if (side === 'P') ui.flashShot(res.type === 'lob' ? 'topspin' : res.type);
    const landing = predictLanding(b, g.surface);
    if (landing) g.ball.showLanding(landing.pos);
    else g.ball.hideLanding();
  }

  function fault() {
    g.ball.hideLanding();
    if (g.serveNumber === 1) {
      g.serveNumber = 2;
      ui.banner('FAULT');
      audio.sfxFault();
      positionForServe();
      refreshScore();
    } else {
      ui.banner('DOUBLE FAULT');
      audio.sfxFault();
      pointEnd(receiver());
    }
  }

  function letServe() {
    ui.banner('LET');
    audio.sfxFault();
    g.ball.hideLanding();
    positionForServe();
  }

  function pointEnd(winner, callText) {
    g.rally.phase = 'over';
    g.pointState = 'point_over';
    g.stateTimer = 0;
    g.ball.hideLanding();
    hideSweet();
    const ev = addPoint(g.match, winner);
    const n = names();
    const winName = winner === 'P' ? n.p : n.c;
    audio.sfxCrowd(winner === 'P' ? 1.0 : 0.55);
    if (callText) ui.banner(callText);
    if (ev === 'game') {
      const total = g.match.games.P + g.match.games.C;
      ui.toast(`GAME ${winName}` + (total % 2 === 1 ? ' — Changeover' : ''), 2000);
    } else if (ev === 'tiebreak_start') {
      ui.toast('GAME — 6-6: TIEBREAK', 2200);
    } else if (ev === 'set') {
      ui.toast(`GAME, SET, MATCH ${winName}`, 2400);
    } else if (!callText) {
      ui.toast(`Point: ${winName}`, 1200);
    }
    g.serveNumber = 1;
    refreshScore();
  }

  function processBounce(e) {
    audio.sfxBounce(e.speed, g.sel.surfaceId);
    g.ball.hideLanding();
    const r = g.rally;
    if (!r || r.phase === 'over' || r.phase === 'idle') return;
    const pos = e.pos;

    if (r.phase === 'serve') {
      if (isServeBoxIn(pos, server(), g.courtSide)) {
        if (r.serveNetTouched) { letServe(); return; }
        r.phase = 'live';
        r.bounces = 1;
      } else {
        fault();
      }
      return;
    }

    // live rally
    const side = pos.z > 0 ? 'P' : 'C';
    if (r.bounces === 0) {
      if (side === r.lastHitBy) {
        // ball never made it across (net dribble / mishit straight down)
        pointEnd(side === 'P' ? 'C' : 'P');
        return;
      }
      const inX = Math.abs(pos.x) <= COURT.halfWidth + LINE_GRACE;
      const inZ = Math.abs(pos.z) <= COURT.halfLen + LINE_GRACE;
      if (inX && inZ) {
        r.bounces = 1;
      } else {
        audio.sfxOut();
        pointEnd(r.lastHitBy === 'P' ? 'C' : 'P', 'OUT');
      }
    } else {
      // double bounce: opponent of last hitter failed to return
      pointEnd(r.lastHitBy);
    }
  }

  function cameraMode() {
    if (g.state !== 'match') return 'rally';
    if ((g.pointState === 'pre_serve' || g.pointState === 'serving') && server() === 'P') {
      return 'serve';
    }
    return 'rally';
  }

  // ---------- input (per render frame, edge-triggered) ----------

  function handleMenuNav(count) {
    let moved = false;
    if (input.wasPressed('ArrowLeft') || input.wasPressed('KeyA')) { g.menuIdx = (g.menuIdx + count - 1) % count; moved = true; }
    if (input.wasPressed('ArrowRight') || input.wasPressed('KeyD')) { g.menuIdx = (g.menuIdx + 1) % count; moved = true; }
    if (moved) audio.sfxMenu();
    return moved;
  }

  function confirmPressed() {
    return input.wasPressed('Enter') || input.wasPressed('Space');
  }

  g.handleInput = function () {
    if (g.state === 'menu_char') {
      if (handleMenuNav(CHARACTERS.length)) showCharMenu();
      if (confirmPressed()) confirmChar();
      return;
    }
    if (g.state === 'menu_opp') {
      if (handleMenuNav(CHARACTERS.length)) showOppMenu();
      if (input.wasPressed('Escape')) {
        g.state = 'menu_char';
        g.menuIdx = CHARACTERS.indexOf(g.sel.player);
        showCharMenu();
        return;
      }
      if (confirmPressed()) confirmOpp();
      return;
    }
    if (g.state === 'menu_surface') {
      if (handleMenuNav(3)) ui.showSurfaceSelect(g.menuIdx);
      if (input.wasPressed('Escape')) {
        g.state = 'menu_opp';
        g.menuIdx = CHARACTERS.indexOf(g.sel.opp);
        showOppMenu();
        return;
      }
      if (confirmPressed()) confirmSurface();
      return;
    }
    if (g.state === 'menu_difficulty') {
      if (handleMenuNav(3)) ui.showDifficultySelect(DIFFICULTIES, g.menuIdx);
      if (input.wasPressed('Escape')) {
        g.state = 'menu_surface';
        g.menuIdx = SURFACE_IDS.indexOf(g.sel.surfaceId);
        ui.showSurfaceSelect(g.menuIdx);
        return;
      }
      if (confirmPressed()) confirmDifficulty();
      return;
    }
    if (g.state === 'results') {
      if (confirmPressed()) backToCharMenu();
      return;
    }

    // ---- in match ----
    if (input.wasPressed('Escape')) {
      teardownMatch();
      backToCharMenu();
      return;
    }

    const shot = input.shotKeyPressed();

    if (g.pointState === 'pre_serve' && server() === 'P') {
      if (input.wasPressed('Space')) startToss();
      return;
    }
    if (g.pointState === 'serving' && server() === 'P') {
      if (shot) {
        const b = g.ball.state;
        const contactH = STATS_MAP.serveContactH(g.human.stats.REA);
        const qServe = 0.4 + 0.6 * Math.max(0, 1 - Math.abs(b.pos.y - contactH) / 0.7);
        const type = shot === 'topspin' ? 'kick' : shot;
        // direction comes from the D-pad held at the hit instant:
        // left/right sweep the box laterally, up = deep, down = short
        const aim = input.aimVec();
        executeServe(type, qServe, 'body', aim.x, aim.depth);
      }
      return;
    }
    if (g.pointState === 'rally' && shot) {
      const b = g.ball.state;
      const fh = (b.pos.x - g.human.pos.x) >= 0; // ball on right side -> forehand
      g.human.startSwing(shot, fh);
    }
  };

  // ---------- fixed update ----------

  g.fixedUpdate = function (dt) {
    if (g.state !== 'match') return;
    g.time += dt;
    const b = g.ball.state;

    // human movement
    let humanMove = input.moveVec();
    if ((g.pointState === 'pre_serve' || g.pointState === 'serving') && server() === 'P') {
      humanMove = { x: humanMove.x, z: 0 }; // slide along the baseline only
    }
    g.human.update(dt, humanMove);
    // clamp server stance to the correct half during serve
    if ((g.pointState === 'pre_serve' || g.pointState === 'serving') && server() === 'P') {
      const sx = serveStanceX('P', g.courtSide);
      if (sx > 0) g.human.pos.x = Math.max(0.2, Math.min(3.9, g.human.pos.x));
      else g.human.pos.x = Math.max(-3.9, Math.min(-0.2, g.human.pos.x));
      g.human.pos.z = COURT.halfLen + 0.4;
    }

    // CPU movement / brain
    let cpuMove = { x: 0, z: 0 };
    if (g.pointState === 'rally' && g.rally.phase !== 'over') {
      cpuMove = updateAI(g.ai, {
        ball: g.ball,
        ballStamp: g.ballStamp,
        surface: g.surface,
        cpu: g.cpu,
        human: g.human,
        gameTime: g.time,
        canHit: b.active && g.rally.lastHitBy === 'P',
        bounced: g.rally.bounces > 0,
        requestSwing(type, aim) {
          const fh = ((b.pos.x - g.cpu.pos.x) * -1) >= 0; // CPU faces +z
          if (g.cpu.startSwing(type, fh)) {
            g.cpu.pendingAim = aim;
            g.cpu.pendingType = type;
          }
        },
      });
    }
    g.cpu.update(dt, cpuMove);
    if ((g.pointState === 'pre_serve' || g.pointState === 'serving') && server() === 'C') {
      g.cpu.pos.z = -(COURT.halfLen + 0.4);
      g.cpu.pos.x = serveStanceX('C', g.courtSide);
    }

    // swing contacts
    for (const side of ['P', 'C']) {
      const e = ent(side);
      if (e.swing && !e.swing.contactDone && e.swing.t >= SWING_CONTACT_T) {
        e.swing.contactDone = true;
        if (side === 'P') {
          attemptContact('P', e.swing.type, input.aimVec());
        } else {
          attemptContact('C', e.pendingType || e.swing.type, e.pendingAim || { x: 0, depth: 0 });
        }
      }
    }

    // state-specific
    if (g.pointState === 'pre_serve') {
      g.stateTimer += dt;
      if (server() === 'C' && g.stateTimer > 1.0) {
        g.cpuServePlan = chooseServe(g.ai, g.serveNumber === 2);
        startToss();
      }
      return;
    }

    if (g.pointState === 'serving') {
      g.events.length = 0;
      stepBall(b, dt, g.surface, g.events);
      const sv = server();
      const contactH = STATS_MAP.serveContactH(ent(sv).stats.REA);
      if (sv === 'C' && g.cpuServePlan && b.vel.y < 0 && b.pos.y <= contactH) {
        const plan = g.cpuServePlan;
        g.cpuServePlan = null;
        executeServe(plan.type, plan.qServe, plan.preset, 0, 0);
        return;
      }
      // uncaught toss: silently re-toss
      if (b.pos.y < 1.2 && b.vel.y < 0) {
        b.active = false;
        g.pointState = 'pre_serve';
        g.stateTimer = 0.7; // CPU re-tosses quickly
        ent(sv).endServeAnim();
      }
      return;
    }

    if (g.pointState === 'rally') {
      if (b.active) {
        g.events.length = 0;
        stepBall(b, dt, g.surface, g.events);
        for (const e of g.events) {
          if (e.type === 'net') {
            audio.sfxNet();
            if (g.rally.phase === 'serve') g.rally.serveNetTouched = true;
            g.ballStamp++;
            if (g.rally.phase !== 'over') {
              const landing = predictLanding(b, g.surface);
              if (landing) g.ball.showLanding(landing.pos);
            }
          } else if (e.type === 'bounce') {
            processBounce(e);
            if (g.pointState !== 'rally') break;
          }
        }
        // "stand here" marker: where to STAND to meet the incoming ball in
        // the ideal band — a bit behind the contact and to the forehand side
        // (the ideal contact is an arm-plus-racket length from the body)
        if (g.pointState === 'rally' && g.rally.lastHitBy === 'C' &&
            g.sweetStamp !== g.ballStamp) {
          g.sweetStamp = g.ballStamp;
          const hp = predictHitPoint(b, g.surface, 1);
          if (hp) {
            showSweet({
              x: Math.max(PLAYER_BOUNDS.xMin, Math.min(PLAYER_BOUNDS.xMax, hp.pos.x - 0.55)),
              y: hp.pos.y,
              z: Math.min(PLAYER_BOUNDS.zMax, hp.pos.z + 0.15),
            });
          } else hideSweet();
          showTrajectoryTrail();
        }
      }
      return;
    }

    if (g.pointState === 'point_over') {
      // let the ball roll out for effect
      if (b.active) {
        g.events.length = 0;
        stepBall(b, dt, g.surface, g.events);
        for (const e of g.events) {
          if (e.type === 'bounce' && e.speed > 2) audio.sfxBounce(e.speed, g.sel.surfaceId);
        }
        const sp = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
        if (sp < 0.3 && b.pos.y < 0.1) b.active = false;
      }
      g.stateTimer += dt;
      if (g.stateTimer >= POINT_OVER_DUR) {
        if (g.match.winner) {
          g.state = 'results';
          const n = names();
          const winName = g.match.winner === 'P' ? n.p : n.c;
          const loseName = g.match.winner === 'P' ? n.c : n.p;
          const gm = g.match.games;
          const gStr = g.match.winner === 'P' ? `${gm.P}-${gm.C}` : `${gm.C}-${gm.P}`;
          teardownMatch();
          ui.showResults(winName, loseName, gStr, g.match.winner === 'P');
        } else {
          nextPoint();
        }
      }
      return;
    }
  };

  // ---------- per render frame ----------

  g.frameUpdate = function (dt) {
    if (g.state !== 'match' && g.state !== 'results') return;
    if (g.human) g.human.updateVisual(dt);
    if (g.cpu) g.cpu.updateVisual(dt);
    if (g.ball) g.ball.updateVisual(dt);
    if (g.human && g.ball) {
      cameraRig.update(dt, cameraMode(), g.human, g.ball.state);
      // Reach zone colour: pink when the incoming ball is within striking range
      if (g.human.setReachZoneColor) {
        const b = g.ball.state;
        const inReach = b.active &&
          Math.hypot(b.pos.x - g.human.pos.x, b.pos.z - g.human.pos.z) <= g.human.reach &&
          b.pos.y <= 1.15 + g.human.reach;
        g.human.setReachZoneColor(inReach ? 0xff50a0 : 0x3988ff);
        if (inReach && !g._wasInReach) audio.sfxReachAlert();
        g._wasInReach = inReach;
      }
    }
    // toss gauge: the FPV camera doesn't look up, so show toss height here
    if (g.state === 'match' && g.pointState === 'serving' && server() === 'P' &&
        g.ball.state.active) {
      const contactH = STATS_MAP.serveContactH(g.human.stats.REA);
      const lo = 1.2, hi = contactH + 0.5;
      const y = g.ball.state.pos.y;
      ui.updateTossGauge(
        (y - lo) / (hi - lo),
        (contactH - 0.15 - lo) / (hi - lo),
        (contactH + 0.15 - lo) / (hi - lo),
        Math.abs(y - contactH) <= 0.15,
      );
    } else {
      ui.hideTossGauge();
    }
    // where-to-stand hint (the floor marker is invisible when behind the FPV)
    if (g.sweetPos && g.human) {
      ui.updateMoveHint(g.sweetPos.x - g.human.pos.x, g.sweetPos.z - g.human.pos.z);
    } else {
      ui.hideMoveHint();
    }
  };

  return g;
}
