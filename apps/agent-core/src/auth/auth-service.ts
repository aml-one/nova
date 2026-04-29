import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { AuthRepository } from "../storage/repositories/auth-repository.js";

type AuthUser = {
  id: string;
  email: string;
};

export class AuthService {
  private readonly repo = new AuthRepository();

  hasAdmin(): boolean {
    return this.repo.hasAnyUser();
  }

  setupAdmin(email: string, password: string): AuthUser {
    if (this.repo.hasAnyUser()) {
      throw new Error("admin already configured");
    }
    const normalizedEmail = normalizeEmail(email);
    validatePassword(password);
    const salt = randomBytes(16).toString("hex");
    const passwordHash = this.hashPassword(password, salt);
    const id = randomUUID();
    this.repo.createUser({ id, email: normalizedEmail, passwordHash, salt });
    return { id, email: normalizedEmail };
  }

  createUser(email: string, password: string): AuthUser {
    const normalizedEmail = normalizeEmail(email);
    validatePassword(password);
    if (this.repo.getUserByEmail(normalizedEmail)) {
      throw new Error("email already exists");
    }
    const salt = randomBytes(16).toString("hex");
    const passwordHash = this.hashPassword(password, salt);
    const id = randomUUID();
    this.repo.createUser({ id, email: normalizedEmail, passwordHash, salt });
    return { id, email: normalizedEmail };
  }

  listUsers(): Array<{ id: string; email: string; createdAt: string }> {
    return this.repo.listUsers();
  }

  login(email: string, password: string): { token: string; user: AuthUser; expiresAt: string } {
    const normalizedEmail = normalizeEmail(email);
    const user = this.repo.getUserByEmail(normalizedEmail);
    if (!user) {
      throw new Error("invalid credentials");
    }
    const hash = this.hashPassword(password, user.salt);
    if (!constantTimeEqual(hash, user.passwordHash)) {
      throw new Error("invalid credentials");
    }
    this.repo.purgeExpiredSessions();
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    this.repo.createSession({ token, userId: user.id, expiresAt });
    return {
      token,
      expiresAt,
      user: { id: user.id, email: user.email }
    };
  }

  verifySession(token: string | undefined): AuthUser | undefined {
    if (!token) {
      return undefined;
    }
    this.repo.purgeExpiredSessions();
    const session = this.repo.getSession(token);
    if (!session) {
      return undefined;
    }
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      this.repo.deleteSession(token);
      return undefined;
    }
    const user = this.repo.getUserById(session.userId);
    if (!user) {
      this.repo.deleteSession(token);
      return undefined;
    }
    return { id: user.id, email: user.email };
  }

  logout(token: string | undefined): void {
    if (!token) {
      return;
    }
    this.repo.deleteSession(token);
  }

  private hashPassword(password: string, salt: string): string {
    return scryptSync(password, salt, 64).toString("hex");
  }
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) {
    throw new Error("invalid email");
  }
  return normalized;
}

function validatePassword(password: string): void {
  if (password.length < 8) {
    throw new Error("password must be at least 8 characters");
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
