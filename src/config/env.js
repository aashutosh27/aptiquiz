import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3000').transform((val) => parseInt(val, 10)),
  DATABASE_URL: z.string().optional(),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 chars'),
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  HOST_EMAILS: z.string().transform((val) => val.split(',').map((e) => e.trim().toLowerCase())),
  LLM_PROVIDER: z.string().default('gemini'),
  LLM_API_KEY: z.string().default('mock-key'),
  LLM_MODEL: z.string().default('gemini-3.8-flash'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  NODE_ENV: z.string().default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
