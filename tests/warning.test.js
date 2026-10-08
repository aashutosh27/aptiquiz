import { describe, it, expect, beforeEach } from 'vitest';
import { RoomManager } from '../src/socket/roomEngine.js';

describe('Warning & Disqualification Engine', () => {
  let roomManager;
  let room;

  beforeEach(() => {
    roomManager = new RoomManager();
    room = roomManager.createRoom(1, [
      { id: 1, text: 'Q1', options: [{ id: 'A', text: '1' }], correct_option_id: 'A' },
    ]);
    room.addPlayer({ id: 101, displayName: 'Player 101' }, 'socket_101');
  });

  it('handles 1st and 2nd warnings without disqualification', () => {
    const w1 = room.warnPlayer(101, 'host', 'suspicious answering');
    expect(w1.warningCount).toBe(1);
    expect(w1.disqualified).toBe(false);

    const w2 = room.warnPlayer(101, 'proctor', 'switching devices or tabs');
    expect(w2.warningCount).toBe(2);
    expect(w2.disqualified).toBe(false);

    const player = room.players.get(101);
    expect(player.status).toBe('active');
  });

  it('disqualifies automatically on the 3rd warning', () => {
    room.warnPlayer(101, 'host', 'suspicious answering');
    room.warnPlayer(101, 'host', 'sharing answers');
    const w3 = room.warnPlayer(101, 'host', 'abusive behaviour');

    expect(w3.warningCount).toBe(3);
    expect(w3.disqualified).toBe(true);

    const player = room.players.get(101);
    expect(player.status).toBe('disqualified');
  });

  it('revokes a warning correctly', () => {
    const w1 = room.warnPlayer(101, 'host', 'suspicious answering');
    const w2 = room.warnPlayer(101, 'host', 'sharing answers');
    const w3 = room.warnPlayer(101, 'host', 'abusive behaviour');

    expect(room.players.get(101).status).toBe('disqualified');

    const res = room.revokeWarning(w3.warningId);
    expect(res.warningCount).toBe(2);

    const player = room.players.get(101);
    expect(player.status).toBe('active');
  });

  it('reinstates a disqualified player', () => {
    room.warnPlayer(101, 'host', 'suspicious answering');
    room.warnPlayer(101, 'host', 'sharing answers');
    room.warnPlayer(101, 'host', 'abusive behaviour');

    expect(room.players.get(101).status).toBe('disqualified');

    const res = room.reinstatePlayer(101);
    expect(res.warningCount).toBe(2);
    expect(room.players.get(101).status).toBe('active');
  });

  it('rejects rejoin attempts for disqualified players', () => {
    room.warnPlayer(101, 'host', 'suspicious answering');
    room.warnPlayer(101, 'host', 'sharing answers');
    room.warnPlayer(101, 'host', 'abusive behaviour');

    expect(() => {
      room.checkCanJoin({ id: 101, displayName: 'Player 101' });
    }).toThrowError('You have been disqualified from this room.');
  });
});
