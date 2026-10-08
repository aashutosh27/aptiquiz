import { OAuth2Client } from 'google-auth-library';
import { config } from '../config/env.js';
import { AppError } from '../utils/errorModule.js';
import { logger } from '../utils/errorModule.js';

const googleClient = new OAuth2Client(config.GOOGLE_CLIENT_ID);

/**
 * Verify Google ID Token with google-auth-library
 */
export async function verifyGoogleIdToken(idToken, clientOverride = googleClient) {
  try {
    const ticket = await clientOverride.verifyIdToken({
      idToken,
      audience: config.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      throw new AppError('SESSION_EXPIRED', 'Invalid Google token payload.');
    }

    if (!payload.email_verified) {
      throw new AppError('NOT_ALLOWED', 'Google account email must be verified.');
    }

    const email = payload.email ? payload.email.toLowerCase() : null;
    const isHost = email && config.HOST_EMAILS.includes(email);

    return {
      googleSub: payload.sub,
      email,
      displayName: payload.name || payload.given_name || 'Student',
      role: isHost ? 'host' : 'player',
      picture: payload.picture,
    };
  } catch (err) {
    logger.error({ err }, 'Google ID token verification failed');
    if (err instanceof AppError) throw err;
    throw new AppError('SESSION_EXPIRED', 'Failed to authenticate with Google. Sign in again.');
  }
}
