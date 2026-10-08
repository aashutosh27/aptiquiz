import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { expressErrorHandler, AppError, logger } from './utils/errorModule.js';
import { config } from './config/env.js';
import { verifyGoogleIdToken } from './services/authService.js';
import { roomManager } from './socket/roomEngine.js';
import { sampleQuestions } from '../db/seed.js';
import { generateQuestionsWithAi } from './services/llmService.js';
import { aiGenerateRequestSchema } from './utils/validators.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(config.SESSION_SECRET));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    activeRooms: roomManager.roomsById.size,
  });
});

// Helper for test sessions in dev/test mode
app.post('/api/auth/test-session', (req, res) => {
  const { userId, displayName, email, role } = req.body;
  const user = {
    id: userId || Math.floor(Math.random() * 10000) + 100,
    googleSub: `test_sub_${userId}`,
    displayName: displayName || `Bot_${userId}`,
    email: email || `bot_${userId}@test.com`,
    role: role || 'player',
  };

  res.cookie('apti_session', JSON.stringify(user), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 86400000,
  });

  res.json({ success: true, user });
});

// Google Authentication Route
app.post('/api/auth/google', async (req, res, next) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      throw new AppError('VALIDATION_ERROR', 'Google idToken is required.');
    }

    const userPayload = await verifyGoogleIdToken(idToken);
    
    // In production, sync with PostgreSQL users table
    const user = {
      id: Math.floor(Math.random() * 900000) + 100000,
      googleSub: userPayload.googleSub,
      displayName: userPayload.displayName,
      email: userPayload.email,
      role: userPayload.role,
    };

    res.cookie('apti_session', JSON.stringify(user), {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 86400000,
    });

    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
});

app.get('/api/auth/me', (req, res) => {
  const cookie = req.cookies?.apti_session;
  if (!cookie) {
    return res.status(401).json({ code: 'SESSION_EXPIRED', message: 'Not authenticated' });
  }
  try {
    const user = JSON.parse(cookie);
    res.json({ user });
  } catch (e) {
    res.status(401).json({ code: 'SESSION_EXPIRED', message: 'Invalid session' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('apti_session');
  res.json({ success: true });
});

// Question Sets & AI Endpoints
app.get('/api/questions/sample', (req, res) => {
  res.json({ questions: sampleQuestions });
});

app.post('/api/questions/ai-generate', async (req, res) => {
  const errorId = `ERR-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  try {
    const parsed = aiGenerateRequestSchema.parse(req.body);
    const cookie = req.cookies?.apti_session;
    const user = cookie ? JSON.parse(cookie) : { id: 1, role: 'host' };

    const questions = await generateQuestionsWithAi({
      hostId: user.id,
      topic: parsed.topic,
      category: parsed.category,
      difficulty: parsed.difficulty,
      count: parsed.count,
    });

    res.json({ success: true, questions });
  } catch (err) {
    logger.error({ errorId, err: err.message, stack: err.stack }, 'AI Question Generation Failed');

    if (err.name === 'ZodError') {
      const msg = err.errors?.map((e) => e.message).join(', ') || 'Invalid request parameters.';
      return res.status(400).json({ success: false, errorId, message: `${msg} (Ref: ${errorId})` });
    }

    if (err.code === 'RATE_LIMITED' || err.isOperational) {
      return res.status(429).json({ success: false, errorId, message: `${err.message} (Ref: ${errorId})` });
    }

    res.status(500).json({
      success: false,
      errorId,
      message: `We couldn't generate AI questions right now. Please try again or type questions manually. (Ref: ${errorId})`,
    });
  }
});

// Create Room Endpoint
app.post('/api/rooms', (req, res, next) => {
  try {
    const cookie = req.cookies?.apti_session;
    const user = cookie ? JSON.parse(cookie) : { id: 1, role: 'host' };
    const { questions, settings, questionDurationMs, proctorCode } = req.body;

    const rawQuestions = questions && Array.isArray(questions) && questions.length > 0 ? questions : sampleQuestions.slice(0, 10);
    const qList = rawQuestions.map((q, idx) => ({
      ...q,
      id: q.id !== undefined && q.id !== null ? Number(q.id) : idx + 1,
    }));
    const roomSettings = { ...(settings || {}), proctorCode: proctorCode || settings?.proctorCode };
    const room = roomManager.createRoom(user.id, qList, roomSettings);

    if (questionDurationMs) {
      room.questionDurationMs = Number(questionDurationMs);
    }

    res.json({
      success: true,
      room: {
        id: room.id,
        pin: room.pin,
        inviteToken: room.inviteToken,
        joinUrl: `${config.PUBLIC_BASE_URL}/j/${room.inviteToken}`,
        proctorCode: room.proctorCode,
        settings: room.settings,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Serve Index HTML for Join Links & Single Page App Routes
app.get(['/j/:token', '/join/:token', '/j', '/join'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve index.html for all non-API frontend routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global 404 Catch-All Handler for API
app.use((req, res, next) => {
  res.status(404).json({
    code: 'ROOM_NOT_FOUND',
    message: 'The requested resource or page was not found.',
  });
});

// Central Express Error Handler
app.use(expressErrorHandler);

export default app;
