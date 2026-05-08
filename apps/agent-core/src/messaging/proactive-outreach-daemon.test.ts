import { describe, expect, it } from "vitest";
import { ProactiveOutreachDaemon } from "./proactive-outreach-daemon.js";
import { SettingsService } from "../settings/settings-service.js";
import { PeopleRepository } from "../storage/repositories/people-repository.js";
import { PersonIdentitiesRepository } from "../storage/repositories/person-identities-repository.js";
import { PersonChannelStateRepository } from "../storage/repositories/person-channel-state-repository.js";
import { getDatabase } from "../storage/sqlite.js";

describe("ProactiveOutreachDaemon", () => {
  it("never sends when unreplied outbound count is >= 10", async () => {
    // Keep this test isolated from prior runs that may have inserted people/identities.
    const db = getDatabase();
    db.exec("DELETE FROM person_channel_state;");
    db.exec("DELETE FROM person_identities;");
    db.exec("DELETE FROM person_profile_events;");
    db.exec("DELETE FROM person_field_locks;");
    db.exec("DELETE FROM people;");

    const settings = new SettingsService();
    settings.updatePartial({ messagingAccess: { ...(settings.get().messagingAccess ?? {}), denyUnknownNumbers: false } as any });

    const people = new PeopleRepository();
    const identities = new PersonIdentitiesRepository();
    const state = new PersonChannelStateRepository();

    const personId = `person-test-${Math.random().toString(36).slice(2, 8)}`;
    people.upsert({
      id: personId,
      displayName: "TestPerson",
      rating: 80,
      interestScore: 0.9,
      rudenessScore: 0,
      preferredChannel: "signal",
      topics: [],
      optedOut: false,
      blocked: false
    });
    identities.upsertIdentity(personId, "phone_e164", "+15551230000");
    state.upsert({
      personId,
      channel: "signal",
      unrepliedOutboundCount: 10
    });

    let enqueued = 0;
    const daemon = new ProactiveOutreachDaemon({
      settings,
      orchestrator: {
        isBusy: () => false,
        getLastActivityAt: () => Date.now() - 60 * 60_000
      } as any,
      dispatcher: {
        enqueue: () => {
          enqueued += 1;
        }
      } as any
    });

    await (daemon as any).tick();
    expect(enqueued).toBe(0);

    const updated = state.get(personId, "signal");
    expect(updated?.cooldownUntilMs).toBeTypeOf("number");
    expect((updated?.cooldownUntilMs ?? 0) > Date.now()).toBe(true);
  });
});

