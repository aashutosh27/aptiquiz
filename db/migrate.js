import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool, { query } from './index.js';
import { logger } from '../src/utils/errorModule.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  logger.info('Starting database migrations...');

  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await query('SELECT name FROM schema_migrations WHERE name = $1', [file]);
    if (rows.length === 0) {
      logger.info(`Applying migration: ${file}`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info(`Migration applied successfully: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ err, file }, 'Migration failed');
        throw err;
      } finally {
        client.release();
      }
    } else {
      logger.info(`Migration already applied: ${file}`);
    }
  }

  logger.info('Database migrations completed.');
}

if (process.argv[1] === __filename) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      logger.error({ err }, 'Migration runner error');
      process.exit(1);
    });
}
