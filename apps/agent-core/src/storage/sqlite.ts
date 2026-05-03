import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NOVA_PRIMARY_EMOTION_USER_ID } from "../identity/nova-emotion-user.js";

let database: DatabaseSync | undefined;
const LATEST_SCHEMA_VERSION = 18;

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
    },
    () => {
      db.exec(`
    CREATE TABLE IF NOT EXISTS update_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      current_version TEXT,
      target_version TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    },
    () => {
      db.exec(`
    CREATE TABLE IF NOT EXISTS thought_events (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    },
    () => {
      db.exec(`
    ALTER TABLE run_history ADD COLUMN model_name TEXT;
    ALTER TABLE run_history ADD COLUMN first_token_ms INTEGER;
    ALTER TABLE run_history ADD COLUMN tokens_per_second REAL;
  `);
    },
    () => {
      db.exec(`
    CREATE TABLE IF NOT EXISTS memory_cards (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rollout_checkpoints (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workflow_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_config TEXT NOT NULL,
      action_type TEXT NOT NULL,
      action_config TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    },
    () => {
      db.exec(`
    ALTER TABLE run_history ADD COLUMN cost_usd REAL;

    CREATE TABLE IF NOT EXISTS chat_replay_branches (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      source_run_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_replay_messages (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    },
    () => {
      db.exec(`
    CREATE TABLE IF NOT EXISTS model_benchmark_runs (
      id TEXT PRIMARY KEY,
      suite_name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      quality_score REAL NOT NULL DEFAULT 0,
      speed_score REAL NOT NULL DEFAULT 0,
      cost_score REAL NOT NULL DEFAULT 0,
      composite_score REAL NOT NULL DEFAULT 0,
      suggested_default INTEGER NOT NULL DEFAULT 0,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS prompt_ab_tests (
      id TEXT PRIMARY KEY,
      suite_name TEXT NOT NULL,
      prompt_a TEXT NOT NULL,
      prompt_b TEXT NOT NULL,
      winner TEXT,
      score_a REAL NOT NULL DEFAULT 0,
      score_b REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS memory_confidence_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id INTEGER NOT NULL,
      reliability REAL NOT NULL DEFAULT 0.5,
      freshness REAL NOT NULL DEFAULT 0.5,
      confidence REAL NOT NULL DEFAULT 0.5,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS policy_rule_defs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pattern TEXT NOT NULL,
      action TEXT NOT NULL,
      reason_template TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS policy_rule_tests (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      input_command TEXT NOT NULL,
      expected_action TEXT NOT NULL,
      actual_action TEXT NOT NULL,
      pass INTEGER NOT NULL DEFAULT 0,
      explanation TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversation_quality_grades (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      helpfulness REAL NOT NULL DEFAULT 0,
      correctness REAL NOT NULL DEFAULT 0,
      tone REAL NOT NULL DEFAULT 0,
      safety REAL NOT NULL DEFAULT 0,
      overall REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS persona_schedules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel TEXT,
      start_hour INTEGER NOT NULL,
      end_hour INTEGER NOT NULL,
      style TEXT NOT NULL,
      mood_label TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rag_citations (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      snippet TEXT NOT NULL,
      score REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS incident_timeline_events (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cost_anomalies (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      baseline_cost REAL NOT NULL,
      observed_cost REAL NOT NULL,
      multiplier REAL NOT NULL,
      action_taken TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workflow_run_traces (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL,
      trace TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS camera_watchlists (
      id TEXT PRIMARY KEY,
      label TEXT,
      color TEXT,
      plate TEXT,
      object_type TEXT,
      escalation_action TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS website_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      subdomain TEXT NOT NULL,
      local_path TEXT NOT NULL,
      remote_www_root TEXT NOT NULL,
      remote_subfolder TEXT NOT NULL,
      semantic_plan TEXT NOT NULL,
      last_deployed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS website_deployments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    },
    () => {
      db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_push_registrations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      token TEXT NOT NULL,
      app_version TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_push_token_unique
      ON mobile_push_registrations(token);
  `);
    },
    () => {
      db.exec(`
    CREATE TABLE IF NOT EXISTS memorybear_user_link (
      nova_user_id TEXT PRIMARY KEY,
      end_user_id TEXT NOT NULL,
      memory_config_id TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    },
    () => {
      db.prepare(`DELETE FROM emotion_events WHERE user_id != ?`).run(NOVA_PRIMARY_EMOTION_USER_ID);
      db.prepare(`DELETE FROM emotion_state WHERE user_id != ?`).run(NOVA_PRIMARY_EMOTION_USER_ID);
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
