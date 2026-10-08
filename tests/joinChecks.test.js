import { describe, it, expect, beforeEach } from 'vitest';
import { RoomManager } from '../src/socket/roomEngine.js';

describe('Sequential Room Join Checks', () => {
  let roomManager;
  let room;

  beforeEach(() => {
    roomManager = new RoomManager();
    room = roomManager.createRoom(1, [
      { id: 1, text: 'Q1', options: [{ id: 'A', text: '1' }], correct_option_id: 'A' },
    ]);
  });

  it('1. throws ROOM_NOT_FOUND for invalid link when disabled', () => {
    room.settings.link_enabled = false;
    expect(() => {
      room.checkCanJoin({ id: 99 }, true);
    }).toThrowError('Room not found. Check the PIN and try again.');
  });

  it('2. throws ROOM_LOCKED when room is locked', () => {
    room.settings.locked = true;
    expect(() => {
      room.checkCanJoin({ id: 99 });
    }).toThrowError('This room is currently locked by the host.');
  });

  it('3. throws GAME_ALREADY_STARTED when game started and late join off', () => {
    room.status = 'QUESTION';
    room.settings.allow_late_join = false;
    expect(() => {
      room.checkCanJoin({ id: 99 });
    }).toThrowError('This game has already started. Ask the host to let you in.');
  });

  it('allows late join when allow_late_join is true', () => {
    room.status = 'QUESTION';
    room.settings.allow_late_join = true;
    expect(room.checkCanJoin({ id: 99 })).toBe(true);
  });

  it('4. throws ROOM_FULL when 50 players are in room', () => {
    room.status = 'LOBBY';
    for (let i = 2; i <= 51; i++) {
      room.addPlayer({ id: i, displayName: `Player ${i}` }, `socket_${i}`);
    }

    expect(() => {
      room.checkCanJoin({ id: 99 });
    }).toThrowError('This room is full. Maximum capacity is 50 players.');
  });

  it('5. throws DISQUALIFIED for disqualified user', () => {
    room.status = 'LOBBY';
    room.addPlayer({ id: 99, displayName: 'Player 99' }, 'socket_99');
    room.warnPlayer(99, 'host', 'r1');
    room.warnPlayer(99, 'host', 'r2');
    room.warnPlayer(99, 'host', 'r3');

    expect(() => {
      room.checkCanJoin({ id: 99 });
    }).toThrowError('You have been disqualified from this room.');
  });

  it('6. handles connection takeover if user is rejoining from second device', () => {
    room.addPlayer({ id: 10, displayName: 'User 10' }, 'socket_old');
    expect(room.players.get(10).socketId).toBe('socket_old');

    const res = room.addPlayer({ id: 10, displayName: 'User 10' }, 'socket_new');
    expect(res.takeover).toBe(true);
    expect(room.players.get(10).socketId).toBe('socket_new');
  });
});
