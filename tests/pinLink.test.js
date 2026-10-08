import { describe, it, expect } from 'vitest';
import { RoomManager } from '../src/socket/roomEngine.js';

describe('PIN and Share Link Feature Logic', () => {
  it('generates 6-digit PIN and long invite token', () => {
    const rm = new RoomManager();
    const room = rm.createRoom(1, []);

    expect(room.pin).toMatch(/^\d{6}$/);
    expect(room.inviteToken).toHaveLength(48);
  });

  it('regenerating token invalidates old token immediately', () => {
    const rm = new RoomManager();
    const room = rm.createRoom(1, []);
    const oldToken = room.inviteToken;

    const newToken = rm.regenerateLink(room);

    expect(newToken).not.toBe(oldToken);
    expect(rm.findRoomByToken(oldToken)).toBeUndefined();
    expect(rm.findRoomByToken(newToken)).toBe(room);
  });

  it('releases PIN and tokens on room close', () => {
    const rm = new RoomManager();
    const room = rm.createRoom(1, []);
    const pin = room.pin;
    const token = room.inviteToken;

    rm.closeRoom(room);

    expect(rm.findRoomByPin(pin)).toBeUndefined();
    expect(rm.findRoomByToken(token)).toBeUndefined();
  });
});
