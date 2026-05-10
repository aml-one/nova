import type { AuthService } from "../auth/auth-service.js";
import type { PersonIdentitiesRepository } from "../storage/repositories/person-identities-repository.js";

/** True if this person row is the primary WebUI admin (first app user), via `web_user_id` identity. */
export function isPrimaryAdminPerson(
  personId: string,
  identities: PersonIdentitiesRepository,
  auth: AuthService
): boolean {
  const adminAppUserId = auth.getPrimaryAdminUserId()?.trim().toLowerCase();
  if (!adminAppUserId) return false;
  const rows = identities.listIdentitiesForPerson(personId);
  return rows.some((r) => r.kind === "web_user_id" && r.value.trim().toLowerCase() === adminAppUserId);
}
