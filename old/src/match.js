// Pure tennis scoring for a 1-set match. No imports, no side effects.
// Players: 'P' (human) and 'C' (cpu).

const POINT_LABELS = ['0', '15', '30', '40'];

export function createMatch(firstServer = 'P') {
  return {
    points: { P: 0, C: 0 },   // 0..3 = 0/15/30/40, 4 = advantage
    games: { P: 0, C: 0 },
    tiebreak: false,
    tbPoints: { P: 0, C: 0 },
    server: firstServer,
    winner: null,
  };
}

function other(who) { return who === 'P' ? 'C' : 'P'; }

function winGame(m, who) {
  m.games[who]++;
  m.points.P = 0; m.points.C = 0;
  m.server = other(m.server);
  const lead = m.games[who] - m.games[other(who)];
  if (m.games[who] >= 6 && lead >= 2) {
    m.winner = who;
    return 'set';
  }
  if (m.games.P === 6 && m.games.C === 6) {
    m.tiebreak = true;
    return 'tiebreak_start';
  }
  return 'game';
}

// Returns 'point' | 'game' | 'tiebreak_start' | 'set'
export function addPoint(m, who) {
  if (m.winner) return 'set';
  if (m.tiebreak) {
    m.tbPoints[who]++;
    const a = m.tbPoints[who], b = m.tbPoints[other(who)];
    if (a >= 7 && a - b >= 2) {
      m.games[who]++; // 7-6
      m.winner = who;
      return 'set';
    }
    // serve rotation: 1 point, then 2-2-2...: swap after odd totals
    if ((m.tbPoints.P + m.tbPoints.C) % 2 === 1) m.server = other(m.server);
    return 'point';
  }
  const p = m.points, o = other(who);
  if (p[who] === 3 && p[o] === 3) { p[who] = 4; return 'point'; }   // deuce -> ad
  if (p[o] === 4) { p[o] = 3; return 'point'; }                     // back to deuce
  if (p[who] >= 3) return winGame(m, who);                          // wins game
  p[who]++;
  return 'point';
}

// Point index within the current game (for serve side: even = deuce side).
export function pointNumberInGame(m) {
  if (m.tiebreak) return m.tbPoints.P + m.tbPoints.C;
  // advantage counts: map 0/1/2/3/4 -> raw points played parity.
  // Sum of point indices works for parity through deuce cycles because
  // returning from ad to deuce keeps parity consistent (40-40 = 6 = even,
  // ad = 7 = odd).
  return m.points.P + m.points.C;
}

export function scoreStrings(m) {
  const games = `${m.games.P}-${m.games.C}`;
  let points;
  if (m.tiebreak) {
    points = `TB ${m.tbPoints.P}-${m.tbPoints.C}`;
  } else if (m.points.P >= 3 && m.points.C >= 3) {
    if (m.points.P === m.points.C) points = 'Deuce';
    else points = m.points.P > m.points.C ? 'Ad P' : 'Ad C';
  } else {
    points = `${POINT_LABELS[m.points.P]}-${POINT_LABELS[m.points.C]}`;
  }
  return { games, points, server: m.server, winner: m.winner };
}
