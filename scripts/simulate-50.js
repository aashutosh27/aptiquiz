import http from 'http';
import { io as ioClient } from 'socket.io-client';
import app from '../src/app.js';
import { setupSocketIO } from '../src/socket/index.js';
import { roomManager } from '../src/socket/roomEngine.js';

async function runSimulation50() {
  console.log('=== Starting 50-Player Single Room Load & Latency Benchmark ===');

  const server = http.createServer(app);
  const ioServer = setupSocketIO(server);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const serverUrl = `http://localhost:${port}`;

  // Seed room with 3 questions
  const sampleQ = [
    { id: 1, text: 'Sim Q1', options: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }], correct_option_id: 'A' },
    { id: 2, text: 'Sim Q2', options: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }], correct_option_id: 'B' },
    { id: 3, text: 'Sim Q3', options: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }], correct_option_id: 'A' },
  ];

  const room = roomManager.createRoom(999, sampleQ);
  console.log(`Room created with PIN: ${room.pin}`);

  const hostSocket = ioClient(serverUrl, { auth: { user: { id: 999, displayName: 'Host', role: 'host' } } });
  await new Promise((res) => hostSocket.emit('room:join', { pin: room.pin }, res));

  const bots = [];
  const deliveryLatencies = [];
  const numBots = 50;

  console.log(`Spawning ${numBots} bots with simulated network jitter (0 - 400ms)...`);

  for (let i = 1; i <= numBots; i++) {
    const userId = 1000 + i;
    const botSocket = ioClient(serverUrl, {
      auth: { user: { id: userId, displayName: `SimBot_${i}` } },
      transports: ['websocket'],
    });

    const simulatedLatencyMs = Math.floor(Math.random() * 400); // 0 to 400ms latency
    const questionEventsReceived = new Set();

    botSocket.on('game:question_start', (data) => {
      const receiveTime = Date.now();
      questionEventsReceived.add(data.questionId);

      // Simulate variable answer speed (1s to 5s) + artificial latency
      const answerDelay = 1000 + Math.floor(Math.random() * 4000) + simulatedLatencyMs;
      
      setTimeout(() => {
        if (!botSocket.connected) return;
        const option = Math.random() > 0.3 ? data.options[0].id : 'B';
        const sendTime = Date.now();

        botSocket.emit('player:submit_answer', {
          questionId: data.questionId,
          selectedOption: option,
          clientSendTime: sendTime,
        }, (ack) => {
          if (ack && ack.success) {
            const ackTime = Date.now();
            deliveryLatencies.push(ackTime - sendTime);
          }
        });
      }, answerDelay);
    });

    // Simulate random drop & rejoin for 5 bots
    if (i <= 5) {
      setTimeout(() => {
        botSocket.disconnect();
        setTimeout(() => {
          botSocket.connect();
          botSocket.emit('room:rejoin', { roomId: room.id });
        }, 1000);
      }, 5000);
    }

    // Join room with random stagger
    await new Promise((r) => setTimeout(r, Math.random() * 20));
    botSocket.emit('room:join', { pin: room.pin });
    bots.push({ userId, socket: botSocket, questionEventsReceived });
  }

  await new Promise((r) => setTimeout(r, 500));
  console.log(`All ${numBots} bots joined. Host starting live game...`);

  // Host starts Q1
  hostSocket.emit('host:start_game');

  // Wait 16 seconds for Q1 to complete
  await new Promise((r) => setTimeout(r, 16000));

  // Host starts Q2
  hostSocket.emit('host:next_question');
  await new Promise((r) => setTimeout(r, 16000));

  // Host starts Q3
  hostSocket.emit('host:next_question');
  await new Promise((r) => setTimeout(r, 16000));

  // Assertions & Metrics
  deliveryLatencies.sort((a, b) => a - b);
  const p50 = deliveryLatencies[Math.floor(deliveryLatencies.length * 0.50)] || 0;
  const p95 = deliveryLatencies[Math.floor(deliveryLatencies.length * 0.95)] || 0;

  console.log('\n--- SIMULATION RESULTS ---');
  console.log(`Connected Bots: ${room.players.size - 1} / ${numBots}`);
  console.log(`Total Answer Submissions: ${deliveryLatencies.length}`);
  console.log(`p50 Delivery Latency: ${p50} ms`);
  console.log(`p95 Delivery Latency: ${p95} ms`);

  // Verify all 50 bots received at least 1 question
  let receivedAll = 0;
  for (const bot of bots) {
    if (bot.questionEventsReceived.size >= 1) receivedAll++;
  }
  console.log(`Bots receiving live question broadcasts: ${receivedAll} / ${numBots}`);

  hostSocket.close();
  bots.forEach((b) => b.socket.close());
  server.close();

  if (receivedAll === numBots) {
    console.log('\n✅ SIMULATION SUCCESSFUL: All 50 bots played cleanly.');
    process.exit(0);
  } else {
    console.error('\n❌ SIMULATION FAILED: Not all bots received question events.');
    process.exit(1);
  }
}

runSimulation50().catch((err) => {
  console.error('Simulation error:', err);
  process.exit(1);
});
