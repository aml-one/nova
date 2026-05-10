export const CHAT_TTS_CHUNK_TARGET_CHARS = 190;
export const CHAT_TTS_CHUNK_MIN_CHARS = 120;

export function stripMarkdownForTts(raw: string): string {
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
  visible = visible.replace(/\r\n?/g, "\n");
  visible = visible.replace(/[\uFEFF\u200B-\u200D]/g, "");
  visible = visible.replace(/[\u2013\u2014]/g, ", ");
  visible = visible.replace(/[#*_>`]+/g, " ");

  const lines = visible
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length > 1) {
    visible = lines
      .map((line) => {
        const isBullet = /^[-*•]\s+/.test(line);
        const isOrdered = /^\d+[\.\)]\s+/.test(line);
        const isLettered = /^[A-Za-z][\)]\s+/.test(line);
        const isListLike = isBullet || isOrdered || isLettered;
        let cleanedLine = line;
        if (isBullet) {
          cleanedLine = line.replace(/^[-*•]\s+/, "");
        }
        if (isListLike && !/[.!?…:;]$/.test(cleanedLine)) {
          cleanedLine = `${cleanedLine}.`;
        }
        return cleanedLine;
      })
      .join(" ");
  }

  visible = visible.replace(/\s+/g, " ").trim();
  return visible.slice(0, 8000);
}

export function splitTextForTts(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  if (text.length <= CHAT_TTS_CHUNK_TARGET_CHARS + 24) return [text];

  const sentenceLike = text.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g) ?? [text];
  const parts: string[] = [];
  let buffer = "";

  const pushBuffer = (): void => {
    const v = buffer.trim();
    if (v) parts.push(v);
    buffer = "";
  };

  for (const rawPiece of sentenceLike) {
    const piece = rawPiece.trim();
    if (!piece) continue;
    if (!buffer) {
      buffer = piece;
      continue;
    }
    const joined = `${buffer} ${piece}`;
    if (joined.length <= CHAT_TTS_CHUNK_TARGET_CHARS) {
      buffer = joined;
      continue;
    }
    if (buffer.length >= CHAT_TTS_CHUNK_MIN_CHARS) {
      pushBuffer();
      buffer = piece;
    } else {
      buffer = joined;
      if (buffer.length >= CHAT_TTS_CHUNK_TARGET_CHARS + 80) {
        pushBuffer();
      }
    }
  }
  pushBuffer();

  if (parts.length <= 1) return [text];

  const merged: string[] = [];
  for (const part of parts) {
    if (!merged.length) {
      merged.push(part);
      continue;
    }
    const prev = merged[merged.length - 1]!;
    if (prev.length < CHAT_TTS_CHUNK_MIN_CHARS) {
      merged[merged.length - 1] = `${prev} ${part}`;
    } else {
      merged.push(part);
    }
  }
  return merged;
}
