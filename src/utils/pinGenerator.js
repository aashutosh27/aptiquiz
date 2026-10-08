import crypto from 'crypto';

/**
 * Generate a cryptographically secure 6-digit PIN string.
 */
export function generatePin() {
  const num = crypto.randomInt(100000, 1000000);
  return num.toString();
}

/**
 * Generate a random long invite token.
 */
export function generateInviteToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Generate a random proctor code.
 */
export function generateProctorCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

/**
 * Hash a string using SHA-256 for secure storage.
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
