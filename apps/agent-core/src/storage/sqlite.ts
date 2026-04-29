import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

let database: DatabaseSync | undefined;
const LATEST_SCHEMA_VERSION = 9;

export function getDatabase(): DatabaseSync {
  if (database) {
    return database;
  }
  const filePath = resolve(process.cwd(), "data", "state", "nova.db");
  mkdirSync(dirname(filePath), { recursive: true });
  database = new DatabaseSync(filePath);
  runMigrations(database);
  return database;
}

function runMigrations(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL;");
  const row = db.prepare("PRAGMA user_version;").get() as { user_version?: number } | undefined;
  let currentVersion = row?.user_version ?? 0;

  const migrations: Array<() => void> = [
    () => {
      db.exec(`
    CREATE TABLE IF NOT EXISTS identity_map (
      channel TEXT NOT NULL,
      phone TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (channel, phone)
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      preferred_name TEXT,
      preferred_style TEXT,
      preferred_persona_id TEXT
    );

    CREATE TABLE IF NOT EXISTS short_term_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS long_term_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS run_history (
      run_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      input_text TEXT NOT NULL,
      output_text TEXT,
      success INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    },
    () => {
      db.exec(`
    ALTER TABLE run_history ADD COLUMN correlation_id TEXT;
    ALTER TABLE run_history ADD COLUMN latency_ms INTEGER DEFAULT 0;
    ALTER TABLE run_history ADD COLUMN provider TEXT;
    ALTER TABLE run_history ADD COLUMN token_in_count INTEGER DEFAULT 0;
    ALTER TABLE run_history ADD COLUMN token_out_count INTEGER DEFAULT 0;
    ALTER TABLE run_history ADD COLUMN tool_timings_ms TEXT;

    CREATE TABLE IF NOT EXISTS outbound_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      recipient TEXT NOT NULL,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT,
      correlation_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS dead_letter_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      recipient TEXT NOT NULL,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      error TEXT,
      correlation_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    },
    () => {
      db.exec(`
    CREATE TABLE IF NOT EXISTS skill_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id TEXT NOT NULL,
      correlation_id TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
      status TEXT NOT NULL,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      cron_expr TEXT NOT NULL,
      task_payload TEXT NOT NULL,
      next_run_at DATETIME NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      risk_level TEXT NOT NULL,
      command TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    },
    () => {
      db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS camera_events (
      id TEXT PRIMARY KEY,
      camera_id TEXT NOT NULL,
      label TEXT NOT NULL,
      color TEXT,
      plate TEXT,
      capture_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS persona_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      persona_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    },
    () => {
      db.exec(`
    CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    },
    () => {
      db.exec(`
    CREATE TABLE IF NOT EXISTS security_events (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      actor TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    },
    () => {
      db.exec(`
    CREATE TABLE IF NOT EXISTS emotion_state (
      user_id TEXT PRIMARY KEY,
      valence REAL NOT NULL,
      arousal REAL NOT NULL,
      label TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    },
    () => {
      db.exec(`
    CREATE TABLE IF NOT EXISTS emotion_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source TEXT NOT NULL,
      trigger TEXT NOT NULL,
      valence REAL NOT NULL,
      arousal REAL NOT NULL,
      label TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    },
    () => {
      db.exec(`
    CREATE TABLE IF NOT EXISTS identity_backup_runs (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      branch TEXT,
      snapshot_path TEXT,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    }
  ];

  while (currentVersion < LATEST_SCHEMA_VERSION) {
    const migration = migrations[currentVersion];
    if (migration) {
      migration();
    }
    currentVersion += 1;
    db.exec(`PRAGMA user_version = ${currentVersion};`);
  }
}

export function resetDatabaseHandleForTests(): void {
  database = undefined;
}
