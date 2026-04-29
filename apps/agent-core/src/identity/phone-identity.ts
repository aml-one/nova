import { IdentityRepository } from "../storage/repositories/identity-repository.js";

type IdentityInput = {
  channel: "web" | "whatsapp" | "signal";
  phoneNumber?: string;
};

export class PhoneIdentityResolver {
  private readonly repository = new IdentityRepository();

  resolve(input: IdentityInput): string {
    if (input.channel === "web") {
      return "local-web-user";
    }
    if (!input.phoneNumber) {
      throw new Error(`missing phone number for ${input.channel} channel`);
    }
    const normalized = normalizePhone(input.phoneNumber);
    const existing = this.repository.findByPhone(normalized);
    if (existing) {
      this.repository.upsertChannelMapping(input.channel, normalized, existing);
      return existing;
    }
    const userId = `user-${normalized}`;
    this.repository.upsertChannelMapping(input.channel, normalized, userId);
    return userId;
  }
}

function normalizePhone(value: string): string {
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return digits;
  }
  return `+${digits}`;
}
