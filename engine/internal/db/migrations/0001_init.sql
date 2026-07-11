-- Postgres schema for the optional user/auth/context layer (internal/db).
-- Everything here is additive to the existing flat-file architecture:
-- kb.json (benchmark) and contributions.json (UGC) stay the source of truth
-- for restaurant/menu data. Postgres only adds what's genuinely relational:
-- accounts, sessions, contribution attribution, and saved trip contexts.
-- Idempotent (IF NOT EXISTS) so Migrate() is safe to run on every boot.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- End-user accounts (Tasco Maps app).
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL DEFAULT 'user', -- user | contributor | admin
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Opaque bearer sessions (token itself is never stored, only its hash).
CREATE TABLE IF NOT EXISTS sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- Contributor identity: attaches a user to a UGC contribution (identified by
-- its POI id, e.g. "ugc:1a2b3c4d", which lives in contributions.json) for
-- attribution/moderation. NULL user_id = anonymous contribution (still
-- allowed; auth is optional everywhere).
CREATE TABLE IF NOT EXISTS contribution_owners (
    contribution_id TEXT PRIMARY KEY,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Saved contexts: a user's saved trip/preference state, mirroring
-- SYSTEM_FLOW.md §2's driver preference schema (stated/ctx/learned). Selecting
-- one later injects it as CTX for a /v1/recommend call ("saved injected
-- contexts") and feeds §5.3's S_behavior factor (learned.repeat_pois /
-- learned.cuisine_affinity) in internal/rerank.
CREATE TABLE IF NOT EXISTS saved_contexts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    stated     JSONB NOT NULL DEFAULT '{}',
    ctx        JSONB NOT NULL DEFAULT '{}',
    learned    JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saved_contexts_user_id ON saved_contexts(user_id);
