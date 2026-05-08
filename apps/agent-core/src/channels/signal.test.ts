import { describe, expect, it, vi } from "vitest";
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

  it("ingests inbound Signal voice note via attachment fetch + STT", async () => {
    const prevUrl = process.env.SIGNAL_API_URL;
    process.env.SIGNAL_API_URL = "http://127.0.0.1:9";
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes("/v1/attachments/voice-attach-1")) {
        return new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    try {
      const adapter = new SignalChannelAdapter(undefined, {
        transcribeInboundVoice: async () => "transcribed voice hello"
      });
      const messages = await adapter.ingestSignalEvent({
        envelope: {
          sourceNumber: "+15550001111",
          timestamp: 1_700_000_004,
          dataMessage: {
            attachments: [{ id: "voice-attach-1", contentType: "audio/ogg", voiceNote: true }]
          }
        }
      });
      expect(messages).toHaveLength(1);
      expect(messages[0]?.text).toBe("transcribed voice hello");
    } finally {
      globalThis.fetch = origFetch;
      if (prevUrl === undefined) delete process.env.SIGNAL_API_URL;
      else process.env.SIGNAL_API_URL = prevUrl;
    }
  });
});
