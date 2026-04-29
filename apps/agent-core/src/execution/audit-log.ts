type AuditRecord = {
  at: string;
  runId: string;
  actor: string;
  action: string;
  data?: Record<string, string>;
};

export class ExecutionAuditLog {
  private readonly records: AuditRecord[] = [];

  append(record: Omit<AuditRecord, "at">): void {
    this.records.push({
      at: new Date().toISOString(),
      ...record
    });
  }

  all(): AuditRecord[] {
    return [...this.records];
  }

  forRun(runId: string): AuditRecord[] {
    return this.records.filter((record) => record.runId === runId);
  }
}
