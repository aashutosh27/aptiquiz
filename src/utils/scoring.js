import crypto from 'crypto';

/**
 * Calculate adjusted response time (t in ms).
 * t = serverReceivedAt - questionStartTime - min(rtt/2, 300)
 * Clamped to 0..timeLimitMs
 */
export function calculateAdjustedTime(serverReceivedAt, questionStartTime, rtt = 0, timeLimitMs = 15000) {
  const rttDiscount = Math.min(Math.max(0, rtt / 2), 300);
  const rawTime = serverReceivedAt - questionStartTime - rttDiscount;
  return Math.min(Math.max(0, Math.round(rawTime)), timeLimitMs);
}

/**
 * Calculate score for a question.
 * Points = round(1000 - 500 * (t / T)) if correct, 0 if wrong or missing.
 */
export function calculateScore(isCorrect, adjustedTimeMs, timeLimitMs = 15000) {
  if (!isCorrect) return 0;
  const clampedT = Math.min(Math.max(0, adjustedTimeMs), timeLimitMs);
  const points = Math.round(1000 - 500 * (clampedT / timeLimitMs));
  return Math.min(1000, Math.max(500, points));
}

/**
 * Check if answer arrived within deadline + 300ms grace window.
 */
export function isWithinGracePeriod(serverReceivedAt, questionStartTime, timeLimitMs = 15000) {
  const elapsed = serverReceivedAt - questionStartTime;
  return elapsed <= timeLimitMs + 300;
}

/**
 * Deterministically shuffle options per player per question.
 * Seeded by (userId + "_" + questionId).
 */
export function shuffleOptionsForPlayer(options, userId, questionId) {
  if (!options || !Array.isArray(options)) return [];

  // Create hash string for deterministic seed
  const seedString = `${userId}_${questionId}`;
  const hashHex = crypto.createHash('md5').update(seedString).digest('hex');

  // Create a copy of options array
  const shuffled = [...options];

  // Seeded Fisher-Yates shuffle using slice of hash
  for (let i = shuffled.length - 1; i > 0; i--) {
    const hexSlice = hashHex.substring((i * 2) % (hashHex.length - 4), ((i * 2) % (hashHex.length - 4)) + 4);
    const num = parseInt(hexSlice, 16);
    const j = num % (i + 1);
    const temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }

  return shuffled;
}

/**
 * Compare two player scores for tie-breaking:
 * 1. Higher total score
 * 2. Earlier adjusted arrival time for round
 * 3. Server receive order / userId
 */
export function comparePlayerRanks(a, b) {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (a.lastAdjustedTime !== b.lastAdjustedTime) {
    return a.lastAdjustedTime - b.lastAdjustedTime;
  }
  return a.userId - b.userId;
}
