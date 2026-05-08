import { getDatabase } from "../sqlite.js";

export type AppUserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt?: string;
};

export type AppSessionRecord = {
  token: string;
  userId: string;
  expiresAt: string;
};

export class AuthRepository {
  getUserByEmail(email: string): AppUserRecord | undefined {
    const db = getDatabase();
    const row = db
      .prepare("SELECT id, email, password_hash, salt FROM app_users WHERE email = ? LIMIT 1")
      .get(email.toLowerCase()) as
      | { id?: string; email?: string; password_hash?: string; salt?: string }
      | undefined;
    if (!row?.id || !row.email || !row.password_hash || !row.salt) {
      return undefined;
    }
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      salt: row.salt
    };
  }

  hasAnyUser(): boolean {
    const db = getDatabase();
    const row = db.prepare("SELECT COUNT(*) as count FROM app_users").get() as { count?: number } | undefined;
    return Number(row?.count ?? 0) > 0;
  }

  createUser(user: AppUserRecord): void {
    const db = getDatabase();
    db.prepare("INSERT INTO app_users (id, email, password_hash, salt) VALUES (?, ?, ?, ?)").run(
      user.id,
      user.email.toLowerCase(),
      user.passwordHash,
      user.salt
    );
  }

  getUserById(userId: string): AppUserRecord | undefined {
    const db = getDatabase();
    const row = db.prepare("SELECT id, email, password_hash, salt FROM app_users WHERE id = ? LIMIT 1").get(userId) as
      | { id?: string; email?: string; password_hash?: string; salt?: string }
      | undefined;
    if (!row?.id || !row.email || !row.password_hash || !row.salt) {
      return undefined;
    }
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      salt: row.salt
    };
  }

  listUsers(): Array<{ id: string; email: string; createdAt: string }> {
    const db = getDatabase();
    const rows = db
      .prepare("SELECT id, email, created_at FROM app_users ORDER BY datetime(created_at) ASC")
      .all() as Array<{ id?: string; email?: string; created_at?: string }>;
    return rows
      .filter((row) => row.id && row.email)
      .map((row) => ({
        id: row.id as string,
        email: row.email as string,
        createdAt: row.created_at ?? ""
      }));
  }

  getFirstUserId(): string | undefined {
    const db = getDatabase();
    const row = db
      .prepare("SELECT id FROM app_users ORDER BY datetime(created_at) ASC LIMIT 1")
      .get() as { id?: string } | undefined;
    return row?.id;
  }

  createSession(session: AppSessionRecord): void {
    const db = getDatabase();
    db.prepare("INSERT INTO app_sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
      session.token,
      session.userId,
      session.expiresAt
    );
  }

  getSession(token: string): AppSessionRecord | undefined {
    const db = getDatabase();
    const row = db
      .prepare("SELECT token, user_id, expires_at FROM app_sessions WHERE token = ? LIMIT 1")
      .get(token) as { token?: string; user_id?: string; expires_at?: string } | undefined;
    if (!row?.token || !row.user_id || !row.expires_at) {
      return undefined;
    }
    return { token: row.token, userId: row.user_id, expiresAt: row.expires_at };
  }

  deleteSession(token: string): void {
    const db = getDatabase();
    db.prepare("DELETE FROM app_sessions WHERE token = ?").run(token);
  }

  purgeExpiredSessions(): void {
    const db = getDatabase();
    db.prepare("DELETE FROM app_sessions WHERE expires_at <= datetime('now')").run();
  }
}
