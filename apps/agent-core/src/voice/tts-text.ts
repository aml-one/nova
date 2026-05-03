/**
 * Normalize assistant/chat markdown for speech synthesis (same rules as web chat read-aloud).
 */
export function prepareChatTextForSpeech(raw: string, maxChars = 8000): string {
  let visible = raw;
  for (const pattern of [
    /<thinking>([\s\S]*?)<\/thinking>/gi,
    /<reasoning>([\s\S]*?)<\/reasoning>/gi,
    /<think>([\s\S]*?)<\/redacted_thinking>/gi
  ]) {
    visible = visible.replace(pattern, () => "");
  }
  visible = visible.trim();
  visible = visible.replace(/```[\s\S]*?```/g, " ");
  visible = visible.replace(/\[nova:[^\]]+\]([\s\S]*?)\[\/nova\]/gi, "$1");
  visible = visible.replace(/\[\/nova\]/gi, " ");
  visible = visible.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  visible = visible.replace(/[\uFEFF\u200B-\u200D]/g, "");
  visible = visible.replace(/[\u2013\u2014]/g, ", ");
  visible = visible.replace(/[#*_>`]+/g, " ");
  visible = visible.replace(/\s+/g, " ").trim();
  return visible.slice(0, maxChars);
}
