import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, cert, getApps, applicationDefault } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { getDatabase } from "../storage/sqlite.js";

type PushEvent = {
  type: "approval.pending" | "security.alert" | "update.available" | "custom";
  title: string;
  body: string;
  entityId?: string;
  severity?: "low" | "medium" | "high";
};

export class MobilePushService {
  private enabled = false;

  constructor() {
    this.enabled = this.tryInitialize();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async sendToAll(event: PushEvent): Promise<{ attempted: number; sent: number; failed: number }> {
    if (!this.enabled) {
      return { attempted: 0, sent: 0, failed: 0 };
    }
    const rows = getDatabase()
      .prepare("SELECT token FROM mobile_push_registrations ORDER BY datetime(updated_at) DESC")
      .all() as Array<{ token?: string }>;
    const tokens = rows.map((row) => row.token?.trim() ?? "").filter(Boolean);
    if (tokens.length === 0) return { attempted: 0, sent: 0, failed: 0 };
    let sent = 0;
    let failed = 0;
    const messaging = getMessaging();
    for (const token of tokens) {
      try {
        await messaging.send({
          token,
          notification: { title: event.title, body: event.body },
          data: {
            type: event.type,
            entityId: event.entityId ?? "",
            severity: event.severity ?? "medium",
            createdAt: new Date().toISOString()
          }
        });
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    return { attempted: tokens.length, sent, failed };
  }

  private tryInitialize(): boolean {
    if (getApps().length > 0) return true;
    const keyPath = resolve(
      process.cwd(),
      process.env.NOVA_FIREBASE_ADMIN_CREDENTIALS_PATH ?? "../api_keys/nova-b006d-firebase-adminsdk-fbsvc-0ce6fed47a.json"
    );
    try {
      if (existsSync(keyPath)) {
        const raw = readFileSync(keyPath, "utf8");
        const parsed = JSON.parse(raw) as {
          project_id: string;
          client_email: string;
          private_key: string;
        };
        initializeApp({
          credential: cert({
            projectId: parsed.project_id,
            clientEmail: parsed.client_email,
            privateKey: parsed.private_key
          })
        });
        return true;
      }
      initializeApp({ credential: applicationDefault() });
      return true;
    } catch {
      return false;
    }
  }
}
