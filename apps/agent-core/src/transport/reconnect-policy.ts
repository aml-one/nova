export function nextReconnectDelayMs(attempt: number, baseMs = 1000, maxMs = 20000): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const delay = baseMs * Math.pow(2, safeAttempt);
  return Math.min(maxMs, delay);
}

export function shouldResetBackoff(connectedForMs: number): boolean {
  return connectedForMs >= 30000;
}
