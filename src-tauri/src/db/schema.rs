/// Migration v0: schema_version table (always applied first)
pub const CREATE_SCHEMA_VERSION: &str = "
CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
";

/// Migration v6: extend trace_log with OTel-ready span columns.
/// Existing rows get NULL for new columns — INSERT paths updated separately.
pub const V6_SCHEMA: &str = "
ALTER TABLE trace_log ADD COLUMN trace_id       TEXT;
ALTER TABLE trace_log ADD COLUMN span_id        TEXT;
ALTER TABLE trace_log ADD COLUMN parent_span_id TEXT;
ALTER TABLE trace_log ADD COLUMN operation      TEXT;
ALTER TABLE trace_log ADD COLUMN engine         TEXT;
ALTER TABLE trace_log ADD COLUMN duration_ms    INTEGER;
ALTER TABLE trace_log ADD COLUMN status         TEXT DEFAULT 'ok';
CREATE INDEX IF NOT EXISTS idx_trace_log_trace_id ON trace_log(trace_id);
";

/// Migration v5: evaluation harness tables
pub const V5_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS eval_runs (
    id               TEXT    PRIMARY KEY,
    conversation_id  TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    title            TEXT    NOT NULL,
    prompt           TEXT    NOT NULL,
    mode             TEXT,
    participants     TEXT,
    rounds           INTEGER NOT NULL DEFAULT 1,
    status           TEXT    NOT NULL DEFAULT 'pending',
    created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eval_runs_conversation_id ON eval_runs(conversation_id);

CREATE TABLE IF NOT EXISTS eval_results (
    id           TEXT    PRIMARY KEY,
    eval_run_id  TEXT    NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
    agent_name   TEXT    NOT NULL,
    engine       TEXT    NOT NULL,
    round        INTEGER NOT NULL,
    content      TEXT    NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd     REAL    NOT NULL DEFAULT 0.0,
    duration_ms  INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eval_results_run_id ON eval_results(eval_run_id);
";

/// Migration v4: add subtask_id column to artifacts for plan-artifact linking
pub const V4_SCHEMA: &str = "
ALTER TABLE artifacts ADD COLUMN subtask_id TEXT REFERENCES plan_subtasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_artifacts_subtask_id ON artifacts(subtask_id);
";

/// Migration v2: add ResumeToken columns to conversations
/// Stores per-conversation, per-engine session token for --resume support.
/// No new table — stored inline in conversations (DATA_MODEL §1.8).
pub const V2_SCHEMA: &str = "
ALTER TABLE conversations ADD COLUMN resume_token        TEXT;
ALTER TABLE conversations ADD COLUMN resume_token_engine TEXT;
";

/// Migration v3: plan state tables
/// Adds `plans` and `plan_subtasks` for per-conversation/branch planning.
pub const V3_SCHEMA: &str = "
-- plans (DATA_MODEL §plan)
CREATE TABLE IF NOT EXISTS plans (
    id               TEXT    PRIMARY KEY,
    conversation_id  TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    branch_id        TEXT    REFERENCES branches(id),
    title            TEXT    NOT NULL,
    description      TEXT,
    expected_outcome TEXT,
    status           TEXT    NOT NULL DEFAULT 'draft',
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_conversation_id ON plans(conversation_id);
CREATE INDEX IF NOT EXISTS idx_plans_branch_id       ON plans(branch_id);

-- plan_subtasks (DATA_MODEL §plan)
CREATE TABLE IF NOT EXISTS plan_subtasks (
    id         TEXT    PRIMARY KEY,
    plan_id    TEXT    NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    idx        INTEGER NOT NULL,
    title      TEXT    NOT NULL,
    details    TEXT,
    status     TEXT    NOT NULL DEFAULT 'todo',
    outcome    TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_subtasks_plan_id ON plan_subtasks(plan_id);
";

/// Migration v1: core tables
pub const V1_SCHEMA: &str = "
-- projects (DATA_MODEL §1.2)
CREATE TABLE IF NOT EXISTS projects (
    key            TEXT    PRIMARY KEY,
    name           TEXT    NOT NULL,
    path           TEXT,
    type           TEXT    NOT NULL DEFAULT 'project',
    default_engine TEXT,
    workspace_root TEXT,
    source         TEXT    NOT NULL DEFAULT 'configured',
    updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at
    ON projects(updated_at DESC);

-- conversations (DATA_MODEL §1.3)
CREATE TABLE IF NOT EXISTS conversations (
    id                   TEXT    PRIMARY KEY,
    project_key          TEXT    NOT NULL REFERENCES projects(key) ON DELETE CASCADE,
    label                TEXT    NOT NULL,
    custom_label         TEXT,
    type                 TEXT    NOT NULL DEFAULT 'main',
    mode                 TEXT    NOT NULL DEFAULT 'chat',
    parent_id            TEXT    REFERENCES conversations(id),
    source               TEXT    NOT NULL DEFAULT 'tunadish',
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    -- ConvSettings (inline)
    engine               TEXT,
    model                TEXT,
    persona              TEXT,
    trigger_mode         TEXT,
    -- Usage tracking
    total_input_tokens   INTEGER NOT NULL DEFAULT 0,
    total_output_tokens  INTEGER NOT NULL DEFAULT 0,
    total_cost_usd       REAL    NOT NULL DEFAULT 0.0
);
CREATE INDEX IF NOT EXISTS idx_conversations_project_key
    ON conversations(project_key);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
    ON conversations(updated_at DESC);

-- messages (DATA_MODEL §1.5)
CREATE TABLE IF NOT EXISTS messages (
    id               TEXT    PRIMARY KEY,
    conversation_id  TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role             TEXT    NOT NULL,
    content          TEXT    NOT NULL,
    timestamp        INTEGER NOT NULL,
    status           TEXT    NOT NULL DEFAULT 'done',
    progress_content TEXT,
    engine           TEXT,
    model            TEXT,
    persona          TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conv_timestamp
    ON messages(conversation_id, timestamp);

-- branches (DATA_MODEL §1.4)
CREATE TABLE IF NOT EXISTS branches (
    id               TEXT    PRIMARY KEY,
    conversation_id  TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    label            TEXT    NOT NULL,
    custom_label     TEXT,
    status           TEXT    NOT NULL DEFAULT 'active',
    checkpoint_id    TEXT    REFERENCES messages(id),
    parent_branch_id TEXT    REFERENCES branches(id),
    session_id       TEXT,
    git_branch       TEXT,
    created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_branches_conversation_id
    ON branches(conversation_id);
CREATE INDEX IF NOT EXISTS idx_branches_session_id
    ON branches(session_id);

-- memos (DATA_MODEL §1.10) — schema only, CRUD in later milestone
CREATE TABLE IF NOT EXISTS memos (
    id              TEXT    PRIMARY KEY,
    message_id      TEXT    NOT NULL,
    conversation_id TEXT    NOT NULL,
    project_key     TEXT    NOT NULL,
    content         TEXT    NOT NULL,
    type            TEXT    NOT NULL DEFAULT 'context',
    tags            TEXT    NOT NULL DEFAULT '[]',
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memos_project_key
    ON memos(project_key);
CREATE INDEX IF NOT EXISTS idx_memos_message_id
    ON memos(message_id);

-- artifacts (DATA_MODEL §1.9) — schema only, CRUD in later milestone
CREATE TABLE IF NOT EXISTS artifacts (
    id              TEXT    PRIMARY KEY,
    conversation_id TEXT,
    branch_id       TEXT,
    type            TEXT    NOT NULL,
    title           TEXT    NOT NULL,
    content         TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'draft',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_conversation_id
    ON artifacts(conversation_id);

-- trace_log — schema only, used for token/cost tracking in later milestone
CREATE TABLE IF NOT EXISTS trace_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT    NOT NULL,
    input_tokens    INTEGER NOT NULL DEFAULT 0,
    output_tokens   INTEGER NOT NULL DEFAULT 0,
    cost_usd        REAL    NOT NULL DEFAULT 0.0,
    recorded_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trace_log_conversation_id
    ON trace_log(conversation_id);

-- messages_fts (FTS5) — schema only, triggers to be added in later milestone
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
    USING fts5(content, content=messages, content_rowid=rowid);
";
