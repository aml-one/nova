import { getDatabase } from "../sqlite.js";

export class IdentityRepository {
  findByPhone(phone: string): string | undefined {
    const db = getDatabase();
    const row = db.prepare("SELECT user_id FROM identity_map WHERE phone = ? LIMIT 1").get(phone) as
      | { user_id?: string }
      | undefined;
    return row?.user_id;
  }

  upsertChannelMapping(channel: string, phone: string, userId: string): void {
    const db = getDatabase();
    db.prepare("INSERT OR REPLACE INTO identity_map (channel, phone, user_id) VALUES (?, ?, ?)").run(
      channel,
      phone,
      userId
    );
  }

  deleteAllMappingsForUserId(userId: string): void {
    const db = getDatabase();
    db.prepare("DELETE FROM identity_map WHERE user_id = ?").run(userId);
  }
}
