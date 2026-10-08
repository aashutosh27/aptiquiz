import { describe, it, expect } from 'vitest';
import { AppError, formatErrorForUser, ERROR_CODES } from '../src/utils/errorModule.js';

describe('Dedicated Error Handling Module', () => {
  it('formats known AppErrors into clean user notices', () => {
    const err = new AppError('ROOM_NOT_FOUND');
    const formatted = formatErrorForUser(err);

    expect(formatted.code).toBe('ROOM_NOT_FOUND');
    expect(formatted.message).toBe('Room not found. Check the PIN and try again.');
    expect(formatted.errorId).toMatch(/^ERR-[A-Z0-9]{6}$/);
  });

  it('sanitizes internal server/SQL errors and attaches an Error ID', () => {
    const rawError = new Error('select * from invalid_table where secret_token="abc123xyz"');
    const formatted = formatErrorForUser(rawError);

    expect(formatted.code).toBe('SERVER_ERROR');
    expect(formatted.message).toContain('Something went wrong on our side. Reference: ERR-');
    expect(formatted.message).not.toContain('invalid_table');
    expect(formatted.message).not.toContain('secret_token');
    expect(formatted.errorId).toMatch(/^ERR-[A-Z0-9]{6}$/);
  });

  it('maps custom AppErrors correctly without leaking internal stack traces', () => {
    const customErr = new AppError('RATE_LIMITED', 'You are doing that too quickly. Please wait a moment.');
    const formatted = formatErrorForUser(customErr);

    expect(formatted.code).toBe('RATE_LIMITED');
    expect(formatted.message).toBe('You are doing that too quickly. Please wait a moment.');
  });
});
