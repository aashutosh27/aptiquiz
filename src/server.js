import http from 'http';
import app from './app.js';
import { setupSocketIO } from './socket/index.js';
import { config } from './config/env.js';
import { logger } from './utils/errorModule.js';

const server = http.createServer(app);
const io = setupSocketIO(server);

// Process-level error handling safety nets
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason }, 'Unhandled Rejection captured safely');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught Exception captured safely');
});

server.listen(config.PORT, () => {
  logger.info(`AptiQuiz server running on ${config.PUBLIC_BASE_URL} (Port: ${config.PORT})`);
});

export { server, io };
