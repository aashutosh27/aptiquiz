-- 001_initial_schema.sql

CREATE TABLE IF NOT EXISTS colleges (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    google_sub VARCHAR(255) UNIQUE,
    email VARCHAR(255) UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    college_id INT REFERENCES colleges(id) ON DELETE SET NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'player',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS question_sets (
    id SERIAL PRIMARY KEY,
    host_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    set_id INT REFERENCES question_sets(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    options JSONB NOT NULL,
    correct_option_id VARCHAR(10) NOT NULL,
    topic VARCHAR(50) NOT NULL,
    difficulty VARCHAR(20) NOT NULL,
    explanation TEXT,
    source VARCHAR(20) NOT NULL DEFAULT 'manual',
    image_url TEXT,
    table_data JSONB,
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rooms (
    id SERIAL PRIMARY KEY,
    pin VARCHAR(6) UNIQUE,
    invite_token_hash VARCHAR(64) UNIQUE NOT NULL,
    host_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_set_id INT REFERENCES question_sets(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'LOBBY',
    current_question_index INT DEFAULT -1,
    question_start_time TIMESTAMPTZ,
    link_enabled BOOLEAN DEFAULT TRUE,
    locked BOOLEAN DEFAULT FALSE,
    allow_late_join BOOLEAN DEFAULT FALSE,
    require_google BOOLEAN DEFAULT TRUE,
    proctor_code_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS room_players (
    id SERIAL PRIMARY KEY,
    room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    display_name VARCHAR(100) NOT NULL,
    is_guest BOOLEAN DEFAULT FALSE,
    socket_id VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    score INT DEFAULT 0,
    warning_count INT DEFAULT 0,
    joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS answers (
    id SERIAL PRIMARY KEY,
    room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    question_id INT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    selected_option VARCHAR(10) NOT NULL,
    is_correct BOOLEAN NOT NULL,
    server_received_at TIMESTAMPTZ NOT NULL,
    adjusted_response_time INT NOT NULL,
    points_awarded INT NOT NULL,
    UNIQUE(room_id, question_id, user_id)
);

CREATE TABLE IF NOT EXISTS ai_pending_questions (
    id SERIAL PRIMARY KEY,
    host_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id INT REFERENCES rooms(id) ON DELETE CASCADE,
    set_id INT REFERENCES question_sets(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    options JSONB NOT NULL,
    correct_option_id VARCHAR(10) NOT NULL,
    topic VARCHAR(50) NOT NULL,
    difficulty VARCHAR(20) NOT NULL,
    explanation TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS warnings (
    id SERIAL PRIMARY KEY,
    room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issuer_role VARCHAR(20) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    question_number INT NOT NULL,
    revoked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS league_scores (
    id SERIAL PRIMARY KEY,
    college_id INT NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    time_frame VARCHAR(20) NOT NULL,
    period_identifier VARCHAR(20) NOT NULL,
    total_points INT DEFAULT 0,
    games_played INT DEFAULT 0,
    total_correct INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(college_id, user_id, time_frame, period_identifier)
);
