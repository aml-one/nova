import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { SignalChannelAdapter } from "./signal.js";

describe("SignalChannelAdapter send integration", () => {
  it("sends payload to fake signal endpoint", async () => {
    let received = "";
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      received = Buffer.concat(chunks).toString("utf8");
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to bind test server");
    }
    process.env.SIGNAL_API_URL = `http://127.0.0.1:${address.port}`;
    process.env.SIGNAL_ACCOUNT_NUMBER = "+1000000000";
    const adapter = new SignalChannelAdapter();
    await adapter.sendMessage("+12223334444", "hello");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(received.includes("+12223334444")).toBe(true);
  });
});
