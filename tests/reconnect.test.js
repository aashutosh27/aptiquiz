import { describe, it, expect, beforeEach } from 'vitest';
import { RoomManager } from '../src/socket/roomEngine.js';

describe('Reconnection & State Snapshot Restore', () => {
  let roomManager;
  let room;

  beforeEach(() => {
    roomManager = new RoomManager();
    room = roomManager.createRoom(1, [
      { id: 10, text: 'Question 1', options: [{ id: 'A', text: 'Opt A' }, { id: 'B', text: 'Opt B' }], correct_option_id: 'A' },
      { id: 20, text: 'Question 2', options: [{ id: 'A', text: 'Opt A' }, { id: 'B', text: 'Opt B' }], correct_option_id: 'B' },
    ]);

    room.addPlayer({ id: 101, displayName: 'Player 101' }, 'socket_1');
  });

  it('restores snapshot mid-question with exact remaining time and answered status', () => {
    room.startNextQuestion(); // Starts Question 10

    // Player submits answer
    room.submitAnswer(101, 10, 'A', Date.now());

    // Player drops connection
    room.disconnectPlayer('socket_1');
    expect(room.players.get(101).status).toBe('disconnected');

    // Player reconnects
    room.addPlayer({ id: 101, displayName: 'Player 101' }, 'socket_2');
    const snapshot = room.getSnapshotForPlayer(101);

    expect(snapshot.status).toBe('QUESTION');
    expect(snapshot.currentQuestion.id).toBe(10);
    expect(snapshot.currentQuestion.hasAnswered).toBe(true);
    expect(snapshot.currentQuestion.selectedOption).toBe('A');
    expect(snapshot.currentQuestion.remainingTimeMs).toBeGreaterThan(0);
    expect(snapshot.currentQuestion.remainingTimeMs).toBeLessThanOrEqual(15000);
  });

  it('accepts duplicate answer resend after reconnect only once (idempotent)', () => {
    room.startNextQuestion();

    const ans1 = room.submitAnswer(101, 10, 'A', Date.now());
    expect(ans1.accepted).toBe(true);
    expect(ans1.duplicate).toBe(false);

    // Resend after drop
    const ans2 = room.submitAnswer(101, 10, 'A', Date.now());
    expect(ans2.accepted).toBe(true);
    expect(ans2.duplicate).toBe(true);
  });
});
