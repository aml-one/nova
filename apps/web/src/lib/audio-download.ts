/** Extension from Content-Type for Orpheus / speak-audio responses. */
export function extensionFromAudioMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("opus")) return "opus";
  if (m.includes("flac")) return "flac";
  if (m.includes("pcm")) return "pcm";
  return "bin";
}

export function triggerBlobDownload(blob: Blob, mime: string, filenameBase: string): void {
  const ext = extensionFromAudioMime(mime);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameBase}.${ext}`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
}
