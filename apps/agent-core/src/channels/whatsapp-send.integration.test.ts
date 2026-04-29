import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { WhatsAppChannelAdapter } from "./whatsapp.js";

describe("WhatsAppChannelAdapter send integration", () => {
  it("sends payload to fake whatsapp endpoint", async () => {
    let received = "";
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      received = Buffer.concat(chunks).toString("utf8");
      res.statusCode = 200;
      res.end(JSON.stringify({ messages: [] }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to bind test server");
    }
    process.env.WHATSAPP_API_BASE_URL = `http://127.0.0.1:${address.port}`;
    process.env.WHATSAPP_PHONE_NUMBER_ID = "111";
    process.env.WHATSAPP_TOKEN = "token";
    const adapter = new WhatsAppChannelAdapter();
    await adapter.sendMessage("+1555000111", "hello");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(received.includes("+1555000111")).toBe(true);
  });
});
