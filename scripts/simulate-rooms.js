import http from 'http';
import app from '../src/app.js';
import { setupSocketIO } from '../src/socket/index.js';
import { roomManager } from '../src/socket/roomEngine.js';

async function runMultiRoomSimulation() {
  console.log('=== Starting Multi-Room Scale & Capacity Benchmark ===');

  const server = http.createServer(app);
  const ioServer = setupSocketIO(server);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const roomSteps = [10, 25, 50, 75];
  const botsPerRoom = 50;

  const sampleQ = [
    { id: 1, text: 'Scale Q1', options: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }], correct_option_id: 'A' },
  ];

  console.log('Room Count | Total Players | Memory (MB) | Event Loop Delay (ms) | Active Rooms');
  console.log('-------------------------------------------------------------------------');

  for (const count of roomSteps) {
    const startMemory = process.memoryUsage().heapUsed / 1024 / 1024;
    const startLoop = performance.now();

    // Create rooms
    for (let r = 0; r < count; r++) {
      const room = roomManager.createRoom(1000 + r, sampleQ);
      for (let p = 1; p <= botsPerRoom; p++) {
        room.addPlayer({ id: r * 1000 + p, displayName: `Bot_${p}` }, `socket_${r}_${p}`);
      }
    }

    const loopDelay = (performance.now() - startLoop).toFixed(2);
    const endMemory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    console.log(
      `${String(count).padEnd(10)} | ${String(count * botsPerRoom).padEnd(13)} | ${String(endMemory).padEnd(11)} | ${String(loopDelay).padEnd(20)} | ${roomManager.roomsById.size}`
    );

    // Clean up created rooms for next iteration
    Array.from(roomManager.roomsById.values()).forEach((room) => roomManager.closeRoom(room));
  }

  server.close();
  console.log('\n✅ Multi-room scale capacity benchmark finished successfully.');
  process.exit(0);
}

runMultiRoomSimulation().catch((err) => {
  console.error('Multi-room simulation error:', err);
  process.exit(1);
});
