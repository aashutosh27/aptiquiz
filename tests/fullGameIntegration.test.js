import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { io as ioClient } from 'socket.io-client';
import app from '../src/app.js';
import { setupSocketIO } from '../src/socket/index.js';
import { roomManager } from '../src/socket/roomEngine.js';

describe('Full Multi-Bot Game Integration Test', () => {
  let server;
  let ioServer;
  let port;
  let room;
  let hostSocket;
  let bot1Socket;
  let bot2Socket;
  let bot3Socket;

  beforeAll(async () => {
    server = http.createServer(app);
    ioServer = setupSocketIO(server);
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;

    // Create a room with 2 questions
    room = roomManager.createRoom(100, [
      { id: 1, text: 'Q1', options: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }], correct_option_id: 'A' },
      { id: 2, text: 'Q2', options: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }], correct_option_id: 'B' },
    ]);
    room.questionDurationMs = 2000;
  });

  afterAll(async () => {
    if (room && room.timer) clearTimeout(room.timer);
    if (hostSocket) hostSocket.close();
    if (bot1Socket) bot1Socket.close();
    if (bot2Socket) bot2Socket.close();
    if (bot3Socket) bot3Socket.close();
    if (server) server.close();
  });

  it('runs a complete game lifecycle with 3 bots, mid-game rejoin, and 3-warning disqualification', { timeout: 45000 }, async () => {
    const serverUrl = `http://localhost:${port}`;

    // Connect Host
    hostSocket = ioClient(serverUrl, { auth: { user: { id: 100, displayName: 'Host', role: 'host' } } });
    
    // Connect Bot 1, Bot 2, Bot 3
    bot1Socket = ioClient(serverUrl, { auth: { user: { id: 101, displayName: 'Bot 1' } } });
    bot2Socket = ioClient(serverUrl, { auth: { user: { id: 102, displayName: 'Bot 2' } } });
    bot3Socket = ioClient(serverUrl, { auth: { user: { id: 103, displayName: 'Bot 3' } } });

    // 1. Join room
    await new Promise((res) => bot1Socket.emit('room:join', { pin: room.pin }, res));
    await new Promise((res) => bot2Socket.emit('room:join', { pin: room.pin }, res));
    await new Promise((res) => bot3Socket.emit('room:join', { pin: room.pin }, res));
    await new Promise((res) => hostSocket.emit('room:join', { pin: room.pin }, res));

    expect(room.players.size).toBe(4); // Host + 3 bots

    // 2. Warn Bot 3 three times -> Disqualify
    hostSocket.emit('proctor:warn_player', { targetUserId: 103, reason: 'suspicious answering' });
    hostSocket.emit('proctor:warn_player', { targetUserId: 103, reason: 'sharing answers' });
    
    let disqEventReceived = false;
    bot3Socket.on('player:disqualified', () => { disqEventReceived = true; });

    hostSocket.emit('proctor:warn_player', { targetUserId: 103, reason: 'abusive name or behaviour' });

    await new Promise((r) => setTimeout(r, 600));

    expect(room.players.get(103).status).toBe('disqualified');
    expect(disqEventReceived).toBe(true);

    // 3. Host starts game
    let q1ReceivedByBot1 = false;
    bot1Socket.on('game:question_start', (data) => {
      if (data.questionId === 1) q1ReceivedByBot1 = true;
    });

    hostSocket.emit('host:start_game');
    await new Promise((r) => setTimeout(r, 200));

    expect(q1ReceivedByBot1).toBe(true);
    expect(room.status).toBe('QUESTION');

    // 4. Bot 1 & Bot 2 submit answers
    let ackReceived = false;
    bot1Socket.emit('player:submit_answer', { questionId: 1, selectedOption: 'A', clientSendTime: Date.now() }, (ack) => {
      if (ack && ack.success) ackReceived = true;
    });

    bot2Socket.emit('player:submit_answer', { questionId: 1, selectedOption: 'B', clientSendTime: Date.now() });

    await new Promise((r) => setTimeout(r, 200));
    expect(ackReceived).toBe(true);

    // 5. Bot 1 drops mid-game and rejoins
    bot1Socket.disconnect();
    await new Promise((r) => setTimeout(r, 200));
    expect(room.players.get(101).status).toBe('disconnected');

    await new Promise((r) => {
      bot1Socket.once('connect', r);
      bot1Socket.connect();
    });

    await new Promise((r) => bot1Socket.emit('room:rejoin', { roomId: room.id }, r));

    expect(room.players.get(101).status).toBe('active');
    if (room && room.timer) clearTimeout(room.timer);
  });
});
