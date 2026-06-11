import { describe, it, expect } from 'vitest';
import { createMatch, addPoint, scoreStrings, pointNumberInGame } from '../src/match.js';

function winPoints(m, who, n) {
  let ev;
  for (let i = 0; i < n; i++) ev = addPoint(m, who);
  return ev;
}

describe('game scoring', () => {
  it('love to game in four points', () => {
    const m = createMatch('P');
    expect(winPoints(m, 'P', 3)).toBe('point');
    expect(scoreStrings(m).points).toBe('40-0');
    expect(addPoint(m, 'P')).toBe('game');
    expect(m.games.P).toBe(1);
    expect(m.server).toBe('C');
  });

  it('deuce and advantage cycling', () => {
    const m = createMatch('P');
    winPoints(m, 'P', 3);
    winPoints(m, 'C', 3);
    expect(scoreStrings(m).points).toBe('Deuce');
    addPoint(m, 'P');
    expect(scoreStrings(m).points).toBe('Ad P');
    addPoint(m, 'C');
    expect(scoreStrings(m).points).toBe('Deuce');
    addPoint(m, 'C');
    expect(scoreStrings(m).points).toBe('Ad C');
    expect(addPoint(m, 'C')).toBe('game');
    expect(m.games.C).toBe(1);
  });

  it('serve alternates each game', () => {
    const m = createMatch('P');
    winPoints(m, 'P', 4);
    expect(m.server).toBe('C');
    winPoints(m, 'P', 4);
    expect(m.server).toBe('P');
  });

  it('set won at 6 games with 2 clear', () => {
    const m = createMatch('P');
    for (let i = 0; i < 5; i++) winPoints(m, 'P', 4);
    expect(m.winner).toBe(null);
    expect(winPoints(m, 'P', 4)).toBe('set');
    expect(m.winner).toBe('P');
  });

  it('no set win at 6-5; tiebreak starts at 6-6', () => {
    const m = createMatch('P');
    for (let i = 0; i < 5; i++) {
      winPoints(m, 'P', 4);
      winPoints(m, 'C', 4);
    }
    expect(winPoints(m, 'P', 4)).toBe('game'); // 6-5
    expect(m.winner).toBe(null);
    expect(winPoints(m, 'C', 4)).toBe('tiebreak_start'); // 6-6
    expect(m.tiebreak).toBe(true);
  });

  it('tiebreak to 7 with 2 clear, 7-6 final games', () => {
    const m = createMatch('P');
    for (let i = 0; i < 6; i++) {
      winPoints(m, 'P', 4);
      winPoints(m, 'C', 4);
    }
    expect(m.tiebreak).toBe(true);
    winPoints(m, 'P', 6);
    winPoints(m, 'C', 6); // 6-6 in TB
    expect(m.winner).toBe(null);
    addPoint(m, 'P'); // 7-6: not enough
    expect(m.winner).toBe(null);
    expect(addPoint(m, 'P')).toBe('set'); // 8-6
    expect(m.winner).toBe('P');
    expect(m.games.P).toBe(7);
    expect(m.games.C).toBe(6);
  });

  it('tiebreak serve rotation: 1 then 2-2-2', () => {
    const m = createMatch('P');
    for (let i = 0; i < 6; i++) {
      winPoints(m, 'P', 4);
      winPoints(m, 'C', 4);
    }
    // server after 12 games of alternation starting from P: P served games
    // 1,3,5,... game 12 was served by C, so TB starts with P
    const first = m.server;
    const seq = [first];
    for (let i = 0; i < 5; i++) {
      addPoint(m, i % 2 === 0 ? 'P' : 'C');
      seq.push(m.server);
    }
    // pattern: X Y Y X X Y
    expect(seq[1]).not.toBe(seq[0]);
    expect(seq[2]).toBe(seq[1]);
    expect(seq[3]).not.toBe(seq[2]);
    expect(seq[4]).toBe(seq[3]);
    expect(seq[5]).not.toBe(seq[4]);
  });

  it('point parity for serve side, including deuce cycles', () => {
    const m = createMatch('P');
    expect(pointNumberInGame(m) % 2).toBe(0); // first point: deuce side
    addPoint(m, 'P');
    expect(pointNumberInGame(m) % 2).toBe(1); // ad side
    winPoints(m, 'P', 2);
    winPoints(m, 'C', 3); // deuce (6 points played)
    expect(pointNumberInGame(m) % 2).toBe(0);
    addPoint(m, 'P'); // advantage (7 points)
    expect(pointNumberInGame(m) % 2).toBe(1);
    addPoint(m, 'C'); // back to deuce
    expect(pointNumberInGame(m) % 2).toBe(0);
  });
});
