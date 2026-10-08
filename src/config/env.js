import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3000').transform((val) => parseInt(val, 10)),
  DATABASE_URL: z.string().optional(),
  SESSION_SECRET: z.string().default('super-secret-key-change-in-production-32chars'),
  GOOGLE_CLIENT_ID: z.string().default('test-google-client-id.apps.googleusercontent.com'),
  HOST_EMAILS: z
    .string()
    .default('admin@college.edu,host@college.edu,prof@college.edu,test_host@college.edu')
    .transform((val) => val.split(',').map((e) => e.trim().toLowerCase())),
  LLM_PROVIDER: z.string().default('gemini'),
  LLM_API_KEY: z.string().default('mock-key'),
  LLM_MODEL: z.string().default('gemini-3.8-flash'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  NODE_ENV: z.string().default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
