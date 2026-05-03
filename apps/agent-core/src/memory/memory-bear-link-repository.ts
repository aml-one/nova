import { getDatabase } from "../storage/sqlite.js";

export type MemoryBearUserLink = {
  novaUserId: string;
  endUserId: string;
  memoryConfigId: string;
};

export class MemoryBearLinkRepository {
  get(novaUserId: string): MemoryBearUserLink | undefined {
    const row = getDatabase()
      .prepare(
        "SELECT nova_user_id, end_user_id, memory_config_id FROM memorybear_user_link WHERE nova_user_id = ? LIMIT 1"
      )
      .get(novaUserId) as { nova_user_id?: string; end_user_id?: string; memory_config_id?: string } | undefined;
    if (!row?.nova_user_id || !row.end_user_id || !row.memory_config_id) {
      return undefined;
    }
    return {
      novaUserId: row.nova_user_id,
      endUserId: row.end_user_id,
      memoryConfigId: row.memory_config_id
    };
  }

  upsert(link: MemoryBearUserLink): void {
    getDatabase()
      .prepare(
        `
        INSERT INTO memorybear_user_link (nova_user_id, end_user_id, memory_config_id, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(nova_user_id) DO UPDATE SET
          end_user_id = excluded.end_user_id,
          memory_config_id = excluded.memory_config_id,
          updated_at = CURRENT_TIMESTAMP
        `
      )
      .run(link.novaUserId, link.endUserId, link.memoryConfigId);
  }
}
