import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppChannelAdapter } from "./whatsapp.js";

describe("WhatsAppChannelAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WHATSAPP_TOKEN;
  });

  it("parses text messages from webhook payload", async () => {
    const adapter = new WhatsAppChannelAdapter();
    const messages = await adapter.ingestWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: "+123", type: "text", text: { body: "hello" } }]
              }
            }
          ]
        }
      ]
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe("hello");
  });

  it("downloads Cloud audio and runs STT callback", async () => {
    process.env.WHATSAPP_TOKEN = "test-token";
    const transcribe = vi.fn(async (_bytes: Buffer, _mime?: string) => "transcribed hello");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const u = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (u.includes("/v22.0/MEDIA42")) {
          return new Response(JSON.stringify({ url: "https://example.test/bin", mime_type: "audio/ogg" }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        if (u === "https://example.test/bin") {
          return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${u}`);
      })
    );

    const adapter = new WhatsAppChannelAdapter(undefined, { transcribeInboundVoice: transcribe });
    const messages = await adapter.ingestWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: "15551234567", type: "audio", audio: { id: "MEDIA42" } }]
              }
            }
          ]
        }
      ]
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe("transcribed hello");
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0]?.[0]).toBeInstanceOf(Buffer);
    expect(transcribe.mock.calls[0]?.[1]).toBe("audio/ogg");
  });
});
