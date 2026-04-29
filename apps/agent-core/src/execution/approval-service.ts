import { randomUUID } from "node:crypto";
import { getDatabase } from "../storage/sqlite.js";

export class ApprovalService {
  request(command: string, riskLevel: "low" | "medium" | "high"): string {
    const id = randomUUID();
    const db = getDatabase();
    db.prepare("INSERT INTO approvals (id, risk_level, command, status) VALUES (?, ?, ?, 'pending')").run(
      id,
      riskLevel,
      command
    );
    return id;
  }

  isApproved(id: string): boolean {
    const db = getDatabase();
    const row = db.prepare("SELECT status FROM approvals WHERE id = ? LIMIT 1").get(id) as { status?: string } | undefined;
    return row?.status === "approved";
  }
}
