import { describe, expect, it } from "vitest";
import { WhatsAppChannelAdapter } from "./whatsapp.js";

describe("WhatsAppChannelAdapter", () => {
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
});
