# AptiQuiz

AptiQuiz is a high-concurrency real-time multiplayer aptitude testing platform where up to 50 students per room race through quantitative, logical, verbal, and data interpretation questions. Designed for campus placement preparation and college hackathons, it supports live speed-decay scoring, real-time leaderboard rank movement, cheating resistance, referee proctoring, and spectator projection modes.

---

## 📌 Problem Statement
**Problem Statement 3: AptiQuiz — Aptitude practice as a live multiplayer game.**

---

## 📋 Done / Left / Plan

### ✅ What Works Now (Done)
- **Question Authoring & Per-Question Topics**: Full custom set editor supporting question text, images, option images, explanations, and per-question Category Topics (*Quantitative Aptitude*, *Logical Reasoning*, *Verbal Reasoning*, *Data Interpretation*, *General Knowledge*).
- **Room Management & Short Join Links**: 6-digit PIN codes, tokenized short join links (`/j/:pin`), QR code generation, and single referee code authorization (`proctorCode`).
- **Server-Authoritative Gameplay**: Server-controlled timers, state machine transitions, and decay scoring based on response speed and correctness.
- **Anti-Cheat & Fair Play System**: Per-player option order shuffling, answer payload masking, and an automated 3-warning disqualification system with referee reinstatement controls.
- **Proctor / Referee Panel (`#proctor:<pin>?code=<code>`)**: Dedicated dashboard for authorized non-host referees to monitor live standings and issue warnings for cheating/tab-switching.
- **Spectator Mode (`#spectator:<pin>`)**: Real-time read-only hall view for campus event projectors.
- **Final Results Analytics**: Detailed post-game performance breakdown showing student accuracy %, average response speed, full room standings, and per-topic strength progress bars.
- **AI Question Generation**: On-demand aptitude question generation via Google Gemini API with mandatory host review.
- **50-Player Load Simulation**: Verified with automated 50-bot socket stress simulation (`npm run sim:50`) and full Vitest suite passing 100%.

### ⌛ What is Left for Next Iteration (Left)
- **Team Battles Mode**: Aggregating individual student scores into 3-to-5 player team standings.
- **Daily Streak & Topic Leagues**: Persistent student daily practice streaks and multi-week college leaderboard seasons.

### 📅 Plan to Finish
1. Implement Redis Pub/Sub for cross-node Socket.IO room event routing.
2. Add PostgreSQL persistence for daily streak counters and college seasonal league points.

---

## 🏗 Architecture & Why

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

### Technical Choices & Rationale
- **Socket.IO (WebSocket)**: Chosen for low-latency (<5ms) bidirectional communication required for simultaneous countdown timers, locked answer acknowledgements, and instant leaderboard animations.
- **Server-Side Promise Queue**: Every room operates a serial event queue so answer submissions, joins, warning issues, and timer expiries execute sequentially with zero race conditions.
- **Zero-Framework Vanilla JS Frontend**: Plain HTML5, CSS3 (Tailwind CDN), and Vanilla JS ensure instant initial page loads (<50KB payload) with zero framework bundle overhead.
- **Google Gemini 3.8 Flash LLM**: Selected for high-speed, cost-effective generation of structured JSON aptitude questions with topic and difficulty classification.

---

## ✨ What We Added (Beyond the Brief)

1. **Proctor / Referee Panel & Code System**: Hosts can configure an 8-character referee code (`proctorCode`). Referees join via `#proctor:<pin>?code=<code>` to monitor cheating without gaining administrative host buttons (like starting or ending rounds).
2. **Automated 3-Warning Disqualification System**: 1st & 2nd warnings present calm in-app notifications. Upon receiving a 3rd warning, the student is **automatically disqualified**, removed from active standings, and blocked from room re-entry (with referee reinstatement capability).
3. **Per-Question Granular Category Topics**: Category topics are set per question rather than globally, enabling accurate end-of-game **Topic-Wise Strengths** progress bar analysis.
4. **Short Join Links (`/j/:pin`)**: Simplified join URLs with one-click clipboard copying and automatic route redirection.
5. **Colorblind-Safe & Accessible Design**: Colorblind-safe option shapes (Square ■, Circle ●, Triangle ▲, Diamond ◆), large text toggle mode, and audio feedback toggles.

---

## ⏱️ Network Delay & Server Referee Rules (Plain Words)

### The Server is the Referee
The server controls the clock. When a question begins, the server marks `questionStartTime` using high-precision timers (`performance.now()`). When a player submits an answer, the server calculates response duration based strictly on its own clock. Client device timestamps are completely ignored, preventing any client-side timer manipulation or clock tampering.

### Fair Treatment Under Network Delay
Students playing on mobile networks or distant Wi-Fi connections naturally experience higher latency. AptiQuiz measures each player's Round Trip Time (RTT) in the background using continuous WebSocket ping/pong signals:
- When an answer arrives, the server subtracts half of the player's latency ($\frac{\text{RTT}}{2}$, capped at a max discount of $300\text{ ms}$) from their arrival timestamp.
- A $300\text{ ms}$ grace window after the deadline accepts answers already in flight.
- **Result**: Two students who tap the correct answer at the exact same physical instant receive equal points regardless of network lag.

---

## 🧮 Scoring Formula

Points are awarded for correct answers and decay linearly with response speed:

$$\text{Points} = \text{round}\left(1000 - 500 \cdot \frac{t}{T}\right)$$

- $t$: RTT-adjusted response duration in milliseconds ($0 \le t \le T$).
- $T$: Question time limit ($15000\text{ ms}$).
- **Instant Correct Answer ($t = 0\text{ ms}$)**: $1000$ points.
- **Deadline Correct Answer ($t = 15000\text{ ms}$)**: $500$ points.
- **Wrong or Missing Answer**: $0$ points.

---

## 🚀 How to Run It

### 1. Prerequisites
- **Node.js**: v18.0+
- **PostgreSQL**: (Optional for local test mode; required for persistent database mode)

### 2. Quick Setup & Start
```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Start development server
npm dev
# Server running at http://localhost:3000
```

### 3. Demo / Test Login
- Open `http://localhost:3000`
- Click **Quick Host Login** to host a quiz room, or **Quick Student Login** to join as a player (no OAuth required for local test mode).
- **Live Deployed URL**: `https://aptiquiz-dhg5.onrender.com`

### 4. Running Tests & 50-Player Load Simulation
```bash
# Run all 36 Vitest unit and integration tests
npm test

# Run 50-player single room simulation stress test
npm run sim:50
```

---

## 🤖 Tools & AI Used

- **Core Libraries**: `express`, `socket.io`, `zod`, `pino`, `pg`, `vitest`.
- **AI Model**: Google Gemini 3.8 Flash (`gemini-3.8-flash`) via official `@google/genai` SDK for generating quantitative, logical, verbal, and data interpretation questions.
- **AI Transparency**: AI-generated questions enter an explicit **Pending AI Review Screen** (`screen-ai-review`) marked with a clear notice: *"AI-generated, please verify the answer before adding to room."* No AI question reaches live play without human confirmation.

---

## 👥 Who It Is For & Why They Return

- **Target Audience**: College placement cells, student aptitude clubs, competitive exam aspirants (CAT, GATE, GRE, Banking), and campus recruitment drives.
- **Why They Come Back**:
  1. High-energy live competition replacing static PDF practice sets.
  2. Instant rank movement indicators (climbed ▲, dropped ▼) that make speed practice fun.
  3. Actionable **Topic-Wise Strengths** analytics revealing exact subject areas needing improvement.

---

## 📝 License
MIT License. Built for high-concurrency educational quizzes.
