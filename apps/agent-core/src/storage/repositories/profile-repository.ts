import { getDatabase } from "../sqlite.js";
import type { UserProfile } from "../../identity/user-profile-store.js";

export class ProfileRepository {
  get(userId: string): UserProfile | undefined {
    const db = getDatabase();
    const row = db
      .prepare(
        "SELECT user_id, preferred_name, preferred_style, preferred_persona_id FROM user_profiles WHERE user_id = ? LIMIT 1"
      )
      .get(userId) as
      | {
          user_id?: string;
          preferred_name?: string | null;
          preferred_style?: string | null;
          preferred_persona_id?: string | null;
        }
      | undefined;
    if (!row?.user_id) {
      return undefined;
    }
    return {
      userId: row.user_id,
      preferredName: row.preferred_name ?? undefined,
      preferredStyle: row.preferred_style ?? undefined,
      preferredPersonaId: row.preferred_persona_id ?? undefined
    };
  }

  upsert(profile: UserProfile): void {
    const db = getDatabase();
    db.prepare(
      `
      INSERT INTO user_profiles (user_id, preferred_name, preferred_style, preferred_persona_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        preferred_name = excluded.preferred_name,
        preferred_style = excluded.preferred_style,
        preferred_persona_id = excluded.preferred_persona_id
      `
    ).run(profile.userId, profile.preferredName ?? null, profile.preferredStyle ?? null, profile.preferredPersonaId ?? null);
  }
}
