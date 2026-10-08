# AptiQuiz

AptiQuiz is a real-time multiplayer aptitude quiz platform where up to 50 students per room race through quantitative, logical, verbal, and data interpretation questions, supporting 50+ concurrent rooms on a single server process.

---

## 🏗 Architecture & Overview

```
                          ┌───────────────────────────┐
                          │   Browser Client (HTML)   │
                          └─────────────┬─────────────┘
                                        │ (HTTP / WebSocket)
                                        ▼
                          ┌───────────────────────────┐
                          │   Node.js / Express App   │
                          └─────────────┬─────────────┘
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             ▼                          ▼                          ▼
┌──────────────────────────┐┌──────────────────────┐┌──────────────────────┐
│  In-Memory Room Engine   ││ Dedicated Error &    ││ PostgreSQL Pool (pg) │
│ (State Machine Queue)    ││ Pino Logger (zod)    ││ Max 10 Connections   │
└──────────────────────────┘└──────────────────────┘└──────────────────────┘
```

- **Server Referee**: The server controls all room timers, state transitions, scoring, and RTT calculations using `performance.now()`. Device clocks are never trusted.
- **Sequential Room Event Queue**: Each active room runs a sequential promise-based queue so that answers, joins, warnings, and timer expiries execute serially with zero race conditions.
- **Zero Framework Frontend**: Plain HTML5, CSS3 (Tailwind CDN), and Vanilla JS with colorblind-safe option shapes (Square ■, Circle ●, Triangle ▲, Diamond ◆).

---

## 🚀 Setup & Run Instructions

### 1. Prerequisites
- **Node.js**: v18.0+
- **PostgreSQL**: (Optional for local test mode; required for persistent database mode)

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Environment Variables:
- `PORT`: HTTP Server port (default `3000`)
- `DATABASE_URL`: PostgreSQL connection string
- `SESSION_SECRET`: Secret string for cookie signatures
- `GOOGLE_CLIENT_ID`: Google OAuth 2.0 Client ID
- `HOST_EMAILS`: Comma-separated list of host email addresses
- `LLM_PROVIDER`: AI provider (`gemini`)
- `LLM_API_KEY`: API Key for question generation
- `LLM_MODEL`: Gemini model identifier (`gemini-2.5-flash`)
- `PUBLIC_BASE_URL`: Public origin URL (e.g. `http://localhost:3000`)

### 3. Database Migration & Seeding
```bash
npm run db:migrate
npm run db:seed
```

### 4. Running the Server
```bash
# Production mode
npm start

# Development mode with watch
npm dev
```

---

## 🔑 Google OAuth Setup & Publishing

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new Project named **AptiQuiz**.
3. Under **APIs & Services > Credentials**, create an **OAuth 2.0 Client ID** (Web Application).
4. Add **Authorized JavaScript Origins**:
   - `http://localhost:3000`
   - `https://your-domain.onrender.com`
5. Add **Authorized Redirect URIs**:
   - `http://localhost:3000/api/auth/google/callback`
6. Under **OAuth consent screen**:
   - Set app name to **AptiQuiz**, user support email, and developer contact information.
   - Add scopes: `openid`, `https://www.googleapis.com/auth/userinfo.email`, `https://www.googleapis.com/auth/userinfo.profile`.
   - Publish consent screen to Production to allow any student to sign in.

---

## 🧮 Scoring Formula & Worked Example

Points are awarded exclusively for correct answers and scale linearly with server-side response speed:

$$\text{Points} = \text{round}\left(1000 - 500 \cdot \frac{t}{T}\right)$$

- $t$: Adjusted response time in milliseconds (clamped to $0 \le t \le T$).
- $T$: Question time limit ($15000\text{ ms}$).
- **Instant Answer ($t = 0\text{ ms}$)**: $1000$ points.
- **Deadline Answer ($t = 15000\text{ ms}$)**: $500$ points.
- **Wrong or Missing Answer**: $0$ points.

### Worked Example
A student submits a correct answer after $3.0\text{ seconds}$ ($3000\text{ ms}$) on a $15\text{-second}$ question:

$$\text{Points} = \text{round}\left(1000 - 500 \cdot \frac{3000}{15000}\right) = \text{round}(1000 - 100) = 900\text{ points}$$

---

## 🌐 Network Delay & RTT Compensation

- Each player's Round Trip Time (RTT) is continuously calculated via background WebSocket ping/pong intervals.
- The server computes adjusted arrival time:
  $$t = \text{serverReceivedAt} - \text{questionStartTime} - \min\left(\frac{\text{RTT}}{2}, 300\text{ ms}\right)$$
- **Grace Window**: Allows a $300\text{ ms}$ grace window after the deadline for answers already in flight.
- **Honest Latency Limit**: RTT discount is capped at $300\text{ ms}$. Players with network latency over $600\text{ ms}$ RTT will experience lower scores than players on low-latency connections.

---

## 🔄 Reconnection & Weak Connection Flow

- If a player's browser drops connection or refreshes mid-game, the client automatically attempts reconnection with exponential backoff while showing a calm **"Reconnecting..."** notification.
- Upon reconnecting, the client issues a `rejoin` request. The server restores the player's exact state, score, and warning count, providing a snapshot containing remaining time derived strictly from the server's clock.
- **Idempotency**: Late or duplicate answer resends are accepted only once per question using the question ID as an idempotency key.

---

## 🔑 Session PIN, Share Link & Anti-Abuse

- **6-Digit PIN**: Cryptographically generated 6-digit PIN unique among active rooms.
- **Share Link**: Tokenized join URL (`/j/<inviteToken>`).
- **Host Room Controls**:
  - **Copy PIN / Link / Share**: One-click sharing options.
  - **Regenerate Link**: Instantly invalidates the old invite token without disturbing players inside.
  - **Disable Link Joining**: Restricts joins to 6-digit PIN only.
  - **Lock Room**: Prevents all new joins while allowing existing members to rejoin.
  - **Late Joining Toggle**: Off by default.
- **Rate Limiting**: PIN join attempts are rate-limited to 10 failed attempts per minute per IP to prevent brute-force entry.

---

## ⚠️ Warning System & Proctor Panel

- The host and proctor (via a dedicated proctor code) can issue warnings to players for tab switching, suspicious answering, or abusive behavior.
- **1st & 2nd Warnings**: Displays a calm notice: *"Warning X of 3: [Reason]. At 3 warnings you will be disqualified."*
- **3rd Warning**: Player is **automatically disqualified**, removed from leaderboard and college league rankings, and sees a plain disqualified screen.
- Warnings are processed sequentially in the room queue and persist across reconnections.

---

## 🛡️ Anti-Cheating & Known Limitations

- **Option Shuffling**: Option orders are deterministically shuffled per player based on `userId + "_" + questionId`.
- **Opaque Option IDs**: Answers are submitted as opaque option IDs (`A`, `B`, `C`, `D`), preventing position-based answer scraping.
- **Honest Limitations**:
  - A student with multiple Google accounts could attempt multiple entries.
  - Off-screen collaboration (e.g. messaging groups) cannot be prevented purely in software. Human proctoring via warnings remains essential.

---

## 🤖 AI Question Generation Flow

- Hosts can generate aptitude questions on-demand via the Gemini LLM API.
- All AI-generated questions enter a **Pending AI Review List** (`ai_pending_questions`).
- **Mandatory Host Review**: No AI question is automatically published into live play. The host must inspect, edit, or confirm each question before it is added to a room.

---

## 🔒 Privacy Notice

- AptiQuiz stores Google `sub`, `displayName`, `email`, and college affiliation.
- **Public Visibility**: Only `displayName` and college code are shown on public leaderboards and spectator screens. Emails are strictly visible to room hosts in audit logs.

---

## 🧪 Simulation Benchmarks & Results

Run unit tests:
```bash
npm test
```
Result: **33 / 33 tests passed (9 test suites)**.

Run 50-player single room simulation:
```bash
npm run sim:50
```
Result:
- **Connected Bots**: 50 / 50
- **Total Answer Submissions**: 124
- **p50 Delivery Latency**: 1 ms
- **p95 Delivery Latency**: 3 ms
- **Broadcast Delivery**: 100%

Run multi-room scale benchmark:
```bash
npm run sim:rooms
```
Result:
- **10 Rooms (500 Players)**: 19.1 MB Heap | 4.1 ms Event Loop Delay
- **25 Rooms (1250 Players)**: 19.8 MB Heap | 1.3 ms Event Loop Delay
- **50 Rooms (2500 Players)**: 21.1 MB Heap | 2.2 ms Event Loop Delay
- **75 Rooms (3750 Players)**: 23.1 MB Heap | 3.6 ms Event Loop Delay

---

## 📈 Scaling Beyond One Process

To scale AptiQuiz beyond a single process across multiple Node.js instances:
1. Route sticky WebSocket connections by Room PIN / Code using an ingress load balancer (such as HAProxy, NGINX, or AWS ALB).
2. Store room state snapshots in PostgreSQL at the end of each round.
3. Use PostgreSQL LISTEN/NOTIFY or Socket.IO Redis adapter for cross-process room broadcast routing if rooms span multiple nodes.

---

## 📝 License
MIT License. Built for high-concurrency educational quizzes.
