type JobStatus = "running" | "completed" | "failed" | "cancelled";

export class JobSupervisor {
  private readonly jobs = new Map<string, JobStatus>();

  markRunning(jobId: string): void {
    this.jobs.set(jobId, "running");
  }

  markDone(jobId: string, ok: boolean): void {
    this.jobs.set(jobId, ok ? "completed" : "failed");
  }

  cancel(jobId: string): void {
    this.jobs.set(jobId, "cancelled");
  }

  get(jobId: string): JobStatus | undefined {
    return this.jobs.get(jobId);
  }

  snapshot(): Record<string, JobStatus> {
    return Object.fromEntries(this.jobs.entries());
  }
}
