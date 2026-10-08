import { describe, it, expect } from 'vitest';
import { verifyGoogleIdToken } from '../src/services/authService.js';
import { AppError } from '../src/utils/errorModule.js';

describe('Google Sign-In Token Verification', () => {
  it('verifies valid token and detects host allowlist', async () => {
    const mockGoogleClient = {
      verifyIdToken: async () => ({
        getPayload: () => ({
          sub: 'google_sub_12345',
          email: 'admin@college.edu',
          email_verified: true,
          name: 'Professor Smith',
        }),
      }),
    };

    const user = await verifyGoogleIdToken('valid_token', mockGoogleClient);

    expect(user.googleSub).toBe('google_sub_12345');
    expect(user.email).toBe('admin@college.edu');
    expect(user.role).toBe('host');
    expect(user.displayName).toBe('Professor Smith');
  });

  it('assigns player role for non-host emails', async () => {
    const mockGoogleClient = {
      verifyIdToken: async () => ({
        getPayload: () => ({
          sub: 'google_sub_67890',
          email: 'student@college.edu',
          email_verified: true,
          name: 'John Student',
        }),
      }),
    };

    const user = await verifyGoogleIdToken('valid_token', mockGoogleClient);

    expect(user.role).toBe('player');
  });

  it('rejects unverified emails', async () => {
    const mockGoogleClient = {
      verifyIdToken: async () => ({
        getPayload: () => ({
          sub: 'google_sub_unverified',
          email: 'fake@college.edu',
          email_verified: false,
        }),
      }),
    };

    await expect(
      verifyGoogleIdToken('token_unverified', mockGoogleClient)
    ).rejects.toThrowError('Google account email must be verified.');
  });
});
