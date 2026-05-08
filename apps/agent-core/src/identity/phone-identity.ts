import { randomUUID } from "node:crypto";
import { IdentityRepository } from "../storage/repositories/identity-repository.js";
import { PeopleRepository } from "../storage/repositories/people-repository.js";
import { PersonIdentitiesRepository } from "../storage/repositories/person-identities-repository.js";

type IdentityInput = {
  channel: "web" | "whatsapp" | "signal";
  phoneNumber?: string;
  webUserId?: string;
  signalUuid?: string;
};

export class PhoneIdentityResolver {
  private readonly repository = new IdentityRepository();
  private readonly people = new PeopleRepository();
  private readonly identities = new PersonIdentitiesRepository();

  /**
   * Resolve an existing person id only — no new `people` rows or identity rows.
   * Used to enforce blocklist before ingest side effects.
   */
  tryResolveExisting(input: IdentityInput): string | undefined {
    if (input.channel === "web") {
      const webUserId = input.webUserId?.trim();
      if (!webUserId) return undefined;
      return this.identities.findPersonIdByIdentity("web_user_id", webUserId);
    }
    const normalizedPhone = input.phoneNumber ? normalizePhone(input.phoneNumber) : undefined;
    if (input.channel === "signal") {
      const normalizedUuid = normalizeSignalUuid(input.signalUuid);
      if (normalizedUuid) {
        const byUuid = this.identities.findPersonIdByIdentity("signal_uuid", normalizedUuid);
        if (byUuid) return byUuid;
        return this.repository.findByPhone(normalizedUuid);
      }
    }
    if (!normalizedPhone) return undefined;
    const existingByPersonIdentity =
      this.identities.findPersonIdByIdentity(input.channel === "whatsapp" ? "whatsapp_phone_e164" : "phone_e164", normalizedPhone) ??
      this.identities.findPersonIdByIdentity("phone_e164", normalizedPhone);
    if (existingByPersonIdentity) return existingByPersonIdentity;
    return this.repository.findByPhone(normalizedPhone);
  }

  resolve(input: IdentityInput): string {
    if (input.channel === "web") {
      const webUserId = input.webUserId?.trim();
      if (webUserId) {
        const existingPersonId = this.identities.findPersonIdByIdentity("web_user_id", webUserId);
        if (existingPersonId) {
          return existingPersonId;
        }
        const personId = randomUUID();
        this.people.upsert({
          id: personId,
          rating: 50,
          interestScore: 0.5,
          rudenessScore: 0,
          topics: [],
          optedOut: false,
          blocked: false
        });
        this.identities.upsertIdentity(personId, "web_user_id", webUserId);
        return personId;
      }
      return "local-web-user";
    }
    const normalizedPhone = input.phoneNumber ? normalizePhone(input.phoneNumber) : undefined;
    if (input.channel === "signal") {
      const normalizedUuid = normalizeSignalUuid(input.signalUuid);
      if (normalizedUuid) {
        const existingPersonId = this.identities.findPersonIdByIdentity("signal_uuid", normalizedUuid);
        if (existingPersonId) {
          // Best-effort keep the phone alias linked too (helps later when Signal hides phone).
          if (normalizedPhone) this.identities.upsertIdentity(existingPersonId, "phone_e164", normalizedPhone);
          return existingPersonId;
        }
        // Sealed sender / hidden E.164: first message may carry only UUID. Mint (or recover) a person and map
        // identity_map.phone to the UUID string so later lookups stay stable until phone_e164 is known.
        const legacyUserId = this.repository.findByPhone(normalizedUuid);
        if (legacyUserId) {
          this.identities.upsertIdentity(legacyUserId, "signal_uuid", normalizedUuid);
          if (normalizedPhone) {
            this.identities.upsertIdentity(legacyUserId, "phone_e164", normalizedPhone);
            this.repository.upsertChannelMapping("signal", normalizedPhone, legacyUserId);
          }
          this.repository.upsertChannelMapping("signal", normalizedUuid, legacyUserId);
          return legacyUserId;
        }
        const personId = `person-${randomUUID()}`;
        this.people.upsert({
          id: personId,
          rating: 50,
          interestScore: 0.5,
          rudenessScore: 0,
          topics: [],
          optedOut: false,
          blocked: false
        });
        this.identities.upsertIdentity(personId, "signal_uuid", normalizedUuid);
        if (normalizedPhone) {
          this.identities.upsertIdentity(personId, "phone_e164", normalizedPhone);
          this.repository.upsertChannelMapping("signal", normalizedPhone, personId);
        }
        this.repository.upsertChannelMapping("signal", normalizedUuid, personId);
        return personId;
      }
    }
    if (!normalizedPhone) {
      throw new Error(`missing phone number for ${input.channel} channel`);
    }

    const existingByPersonIdentity =
      this.identities.findPersonIdByIdentity(input.channel === "whatsapp" ? "whatsapp_phone_e164" : "phone_e164", normalizedPhone) ??
      this.identities.findPersonIdByIdentity("phone_e164", normalizedPhone);
    if (existingByPersonIdentity) {
      this.repository.upsertChannelMapping(input.channel, normalizedPhone, existingByPersonIdentity);
      // For Signal, also attach UUID when present so sealed-sender still resolves later.
      if (input.channel === "signal") {
        const normalizedUuid = normalizeSignalUuid(input.signalUuid);
        if (normalizedUuid) this.identities.upsertIdentity(existingByPersonIdentity, "signal_uuid", normalizedUuid);
      }
      return existingByPersonIdentity;
    }

    // Back-compat: preserve existing phone-based "user-+E164" identifiers if present.
    const existingLegacy = this.repository.findByPhone(normalizedPhone);
    if (existingLegacy) {
      this.repository.upsertChannelMapping(input.channel, normalizedPhone, existingLegacy);
      // Ensure a person row exists so the People UI can manage it.
      if (!this.people.getById(existingLegacy)) {
        this.people.upsert({
          id: existingLegacy,
          rating: 50,
          interestScore: 0.5,
          rudenessScore: 0,
          topics: [],
          optedOut: false,
          blocked: false
        });
      }
      this.identities.upsertIdentity(existingLegacy, "phone_e164", normalizedPhone);
      if (input.channel === "whatsapp") this.identities.upsertIdentity(existingLegacy, "whatsapp_phone_e164", normalizedPhone);
      if (input.channel === "signal") {
        const normalizedUuid = normalizeSignalUuid(input.signalUuid);
        if (normalizedUuid) this.identities.upsertIdentity(existingLegacy, "signal_uuid", normalizedUuid);
      }
      return existingLegacy;
    }
    const personId = `person-${randomUUID()}`;
    this.people.upsert({
      id: personId,
      rating: 50,
      interestScore: 0.5,
      rudenessScore: 0,
      topics: [],
      optedOut: false,
      blocked: false
    });
    this.identities.upsertIdentity(personId, "phone_e164", normalizedPhone);
    if (input.channel === "whatsapp") this.identities.upsertIdentity(personId, "whatsapp_phone_e164", normalizedPhone);
    if (input.channel === "signal") {
      const normalizedUuid = normalizeSignalUuid(input.signalUuid);
      if (normalizedUuid) this.identities.upsertIdentity(personId, "signal_uuid", normalizedUuid);
    }
    this.repository.upsertChannelMapping(input.channel, normalizedPhone, personId);
    return personId;
  }
}

function normalizePhone(value: string): string {
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return digits;
  }
  return `+${digits}`;
}

function normalizeSignalUuid(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  // signal-cli uses UUIDs; we keep a light validation to avoid garbage keys.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(lower)) return undefined;
  return lower;
}
