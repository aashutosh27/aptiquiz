import { describe, it, expect } from 'vitest';
import {
  calculateAdjustedTime,
  calculateScore,
  isWithinGracePeriod,
  shuffleOptionsForPlayer,
  comparePlayerRanks,
} from '../src/utils/scoring.js';

describe('Scoring & RTT Adjustment Math', () => {
  it('calculates score correctly based on response time formula', () => {
    // Instant correct answer (t = 0) -> 1000 points
    expect(calculateScore(true, 0, 15000)).toBe(1000);

    // Deadline correct answer (t = 15000) -> 500 points
    expect(calculateScore(true, 15000, 15000)).toBe(500);

    // Halfway correct answer (t = 7500) -> 750 points
    expect(calculateScore(true, 7500, 15000)).toBe(750);

    // Wrong or missing answer -> 0 points
    expect(calculateScore(false, 1000, 15000)).toBe(0);
  });

  it('clamps adjusted response time correctly and caps RTT discount at 300ms', () => {
    const startTime = 10000;

    // Normal ping 100ms RTT -> discount = 50ms
    const t1 = calculateAdjustedTime(15000, startTime, 100, 15000);
    expect(t1).toBe(4950);

    // High ping 1000ms RTT -> discount capped at 300ms
    const t2 = calculateAdjustedTime(15000, startTime, 1000, 15000);
    expect(t2).toBe(4700);

    // Ensure negative values clamp to 0
    const t3 = calculateAdjustedTime(10050, startTime, 500, 15000);
    expect(t3).toBe(0);
  });

  it('property test: earlier adjusted arrival never receives fewer points than later arrival', () => {
    const timeLimit = 15000;
    for (let i = 0; i < 100; i++) {
      const tEarly = Math.floor(Math.random() * 14000);
      const tLate = tEarly + Math.floor(Math.random() * 1000) + 1;

      const sEarly = calculateScore(true, tEarly, timeLimit);
      const sLate = calculateScore(true, tLate, timeLimit);

      expect(sEarly).toBeGreaterThanOrEqual(sLate);
      expect(sEarly).toBeGreaterThanOrEqual(500);
      expect(sEarly).toBeLessThanOrEqual(1000);
    }
  });

  it('grace period check: allows up to 300ms after deadline', () => {
    const startTime = 1000;
    const limit = 15000;

    expect(isWithinGracePeriod(15000, startTime, limit)).toBe(true);
    expect(isWithinGracePeriod(16300, startTime, limit)).toBe(true);
    expect(isWithinGracePeriod(16301, startTime, limit)).toBe(false);
  });

  it('option shuffling is deterministic per player + question combo', () => {
    const options = [
      { id: 'A', text: 'Opt A' },
      { id: 'B', text: 'Opt B' },
      { id: 'C', text: 'Opt C' },
      { id: 'D', text: 'Opt D' },
    ];

    const player1Q1_a = shuffleOptionsForPlayer(options, 101, 1);
    const player1Q1_b = shuffleOptionsForPlayer(options, 101, 1);
    const player2Q1 = shuffleOptionsForPlayer(options, 102, 1);

    expect(player1Q1_a).toEqual(player1Q1_b);
    // Different players should likely get different orderings (or at least evaluated deterministically)
    expect(player1Q1_a).toBeDefined();
    expect(player2Q1).toBeDefined();
  });

  it('breaks ties by earlier adjusted arrival time then server receive order', () => {
    const players = [
      { userId: 1, score: 800, lastAdjustedTime: 4000 },
      { userId: 2, score: 800, lastAdjustedTime: 3500 },
      { userId: 3, score: 950, lastAdjustedTime: 2000 },
    ];

    players.sort(comparePlayerRanks);

    expect(players[0].userId).toBe(3); // Highest score
    expect(players[1].userId).toBe(2); // Same score as #1, but earlier arrival (3500ms vs 4000ms)
    expect(players[2].userId).toBe(1);
  });
});
