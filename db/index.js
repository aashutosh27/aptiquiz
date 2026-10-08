import pg from 'pg';
import dotenv from 'dotenv';
import { logger } from '../src/utils/errorModule.js';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

export const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug({ text, duration, rows: res.rowCount }, 'Executed SQL query');
    return res;
  } catch (err) {
    logger.error({ err, text }, 'Database query failure');
    throw err;
  }
};

export const getClient = async () => {
  return await pool.connect();
};

export default pool;
