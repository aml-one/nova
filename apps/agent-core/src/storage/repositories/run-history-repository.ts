import { getDatabase } from "../sqlite.js";

export type RunTelemetry = {
  runId: string;
  userId: string;
  channel: "web" | "whatsapp" | "signal";
  inputText: string;
  outputText?: string;
  success: boolean;
  correlationId?: string;
  latencyMs?: number;
  provider?: string;
  modelName?: string;
  tokenInCount?: number;
  tokenOutCount?: number;
  firstTokenMs?: number;
  tokensPerSecond?: number;
  costUsd?: number;
  toolTimingsMs?: Record<string, number>;
};

export class RunHistoryRepository {
  save(telemetry: RunTelemetry): void {
    const db = getDatabase();
    db.prepare(
      `
      INSERT OR REPLACE INTO run_history (
        run_id, user_id, channel, input_text, output_text, success,
        correlation_id, latency_ms, provider, model_name, token_in_count, token_out_count, first_token_ms, tokens_per_second, cost_usd, tool_timings_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      telemetry.runId,
      telemetry.userId,
      telemetry.channel,
      telemetry.inputText,
      telemetry.outputText ?? null,
      telemetry.success ? 1 : 0,
      telemetry.correlationId ?? null,
      telemetry.latencyMs ?? 0,
      telemetry.provider ?? null,
      telemetry.modelName ?? null,
      telemetry.tokenInCount ?? 0,
      telemetry.tokenOutCount ?? 0,
      telemetry.firstTokenMs ?? null,
      telemetry.tokensPerSecond ?? null,
      telemetry.costUsd ?? null,
      telemetry.toolTimingsMs ? JSON.stringify(telemetry.toolTimingsMs) : null
    );
  }
}
