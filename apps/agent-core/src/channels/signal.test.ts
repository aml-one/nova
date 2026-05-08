import { describe, expect, it } from "vitest";
import { SignalChannelAdapter } from "./signal.js";

describe("SignalChannelAdapter", () => {
  it("ingests inbound dataMessage with E.164 source", async () => {
    const adapter = new SignalChannelAdapter();
    const messages = await adapter.ingestSignalEvent({
      envelope: {
        sourceNumber: "+16314887141",
        timestamp: 1_700_000_000,
        dataMessage: { message: "Hello" }
      }
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.from).toBe("+16314887141");
    expect(messages[0]?.phoneNumber).toBe("+16314887141");
    expect(messages[0]?.text).toBe("Hello");
  });

  it("does not treat syncMessage.sentMessage as inbound DM text", async () => {
    const adapter = new SignalChannelAdapter();
    const messages = await adapter.ingestSignalEvent({
      envelope: {
        sourceNumber: "+15551234567",
        timestamp: 1_700_000_001,
        syncMessage: { sentMessage: { message: "Echo of own send" } }
      }
    });
    expect(messages).toHaveLength(0);
  });

  it("prefers dataMessage when both would exist", async () => {
    const adapter = new SignalChannelAdapter();
    const messages = await adapter.ingestSignalEvent({
      envelope: {
        sourceNumber: "+16314887141",
        timestamp: 1_700_000_002,
        dataMessage: { message: "Real inbound" },
        syncMessage: { sentMessage: { message: "Should be ignored" } }
      }
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe("Real inbound");
  });

  it("captures sealed-sender UUID, profile name, and omits phoneNumber when E.164 missing", async () => {
    const adapter = new SignalChannelAdapter();
    const uuid = "f2dfef3b-f8ec-4e92-998f-1f39d6fa5be8";
    const messages = await adapter.ingestSignalEvent({
      envelope: {
        source: uuid,
        sourceNumber: null,
        sourceUuid: uuid,
        sourceName: "nit",
        timestamp: 1_700_000_003,
        dataMessage: { message: "Hello" }
      }
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.from).toBe(uuid);
    expect(messages[0]?.phoneNumber).toBeUndefined();
    expect(messages[0]?.signalUuid).toBe(uuid);
    expect(messages[0]?.signalSourceProfileName).toBe("nit");
    expect(messages[0]?.text).toBe("Hello");
  });
});
