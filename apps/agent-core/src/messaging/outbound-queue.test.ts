import { describe, expect, it } from "vitest";
import { OutboundQueueService } from "./outbound-queue.js";

describe("OutboundQueueService", () => {
  it("enqueues and lists ready jobs deterministically", () => {
    const queue = new OutboundQueueService();
    queue.enqueue("signal", "+123", "hello", "corr-1");
    const jobs = queue.listReady(10);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.some((job) => job.recipient === "+123")).toBe(true);
  });
});
