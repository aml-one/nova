/**
 * Must stay in sync with `userMessageTargetsNovaIdentityBio` in
 * `apps/agent-core/src/orchestrator/task-orchestrator.ts`.
 *
 * Web chat uses buffered `/api/chat` for these turns so agent-core can run the
 * non-stream identity repair pass (streaming skips that repair).
 */
export function shouldUseNovaIdentityBufferedChat(userVisibleMessage: string): boolean {
  const slice = userVisibleMessage.trim().slice(0, 400);
  return /\b(tell me (something )?about yourself|tell me about you\b|something about yourself|who are you|what are you|describe yourself|introduce yourself)\b/i.test(
    slice
  );
}
