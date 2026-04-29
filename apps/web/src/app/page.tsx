/* eslint-disable react/no-unescaped-entities */
"use client";

import { DragEvent, FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type ChatMedia = {
  url: string;
  kind: "image" | "video";
  posterUrl?: string;
};

type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  medias?: ChatMedia[];
};

type PendingUpload = {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  uploaded?: ChatMedia;
};

type LightboxState = {
  medias: ChatMedia[];
  index: number;
};

export default function HomePage() {
  const [message, setMessage] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [draggedUploadId, setDraggedUploadId] = useState<string | null>(null);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || loading) {
      return;
    }
    const uploadedMedias = await uploadAllPending();
    const inlineUrl = imageUrl.trim() || undefined;
    const allUserMedia: ChatMedia[] = [
      ...uploadedMedias,
      ...(inlineUrl ? [{ url: inlineUrl, kind: inferMediaKind(inlineUrl) ?? "image" }] : [])
    ];
    const firstVisionUrl = allUserMedia.find((item) => item.kind === "image" || item.kind === "video")?.url;
    setTurns((prev) => [
      ...prev,
      {
        role: "user",
        text: trimmed,
        medias: allUserMedia
      }
    ]);
    setMessage("");
    setPendingUploads([]);
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          phoneNumber: phoneNumber.trim() || undefined,
          imageUrl: firstVisionUrl
        })
      });
      const data = (await response.json()) as { reply?: string; error?: string };
      if (!response.ok) {
        setTurns((prev) => [...prev, { role: "assistant", text: `Error: ${data.error ?? "Request failed"}` }]);
        return;
      }
      const reply = data.reply ?? "";
      const mediaFromReply = extractMediaUrls(reply);
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          text: reply,
          medias: mediaFromReply
        }
      ]);
    } catch (error) {
      setTurns((prev) => [
        ...prev,
        { role: "assistant", text: `Error: ${error instanceof Error ? error.message : "Unknown error"}` }
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function uploadAllPending(): Promise<ChatMedia[]> {
    const medias: ChatMedia[] = [];
    for (const item of pendingUploads) {
      if (item.status === "done" && item.uploaded) {
        medias.push(item.uploaded);
        continue;
      }
      const uploaded = await uploadOneFile(item.id, item.file);
      if (uploaded) {
        medias.push(uploaded);
      }
    }
    return medias;
  }

  async function uploadOneFile(uploadId: string, file: File): Promise<ChatMedia | undefined> {
    setPendingUploads((prev) =>
      prev.map((item) => (item.id === uploadId ? { ...item, status: "uploading", progress: 1 } : item))
    );
    const base64 = await fileToBase64(file);
    const uploaded = await uploadSelectedFileWithProgress(file.name, base64, (progress) => {
      setPendingUploads((prev) =>
        prev.map((item) => (item.id === uploadId ? { ...item, progress, status: "uploading" } : item))
      );
    });
    if (!uploaded) {
      setPendingUploads((prev) =>
        prev.map((item) => (item.id === uploadId ? { ...item, status: "error", progress: 0 } : item))
      );
      return undefined;
    }
    setPendingUploads((prev) =>
      prev.map((item) =>
        item.id === uploadId ? { ...item, status: "done", progress: 100, uploaded } : item
      )
    );
    return uploaded;
  }

  function addFiles(files: FileList | File[]): void {
    const list = Array.from(files);
    const mapped = list.map<PendingUpload>((file) => ({
      id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      progress: 0,
      status: "pending"
    }));
    setPendingUploads((prev) => [...prev, ...mapped]);
  }

  function removePendingUpload(id: string): void {
    setPendingUploads((prev) => prev.filter((item) => item.id !== id));
    setSelectedUploadId((prev) => (prev === id ? null : prev));
  }

  function movePendingUpload(id: string, direction: -1 | 1): void {
    setPendingUploads((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      if (index < 0) return prev;
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  }

  function movePendingUploadToTarget(sourceId: string, targetId: string): void {
    if (sourceId === targetId) {
      return;
    }
    setPendingUploads((prev) => {
      const sourceIndex = prev.findIndex((item) => item.id === sourceId);
      const targetIndex = prev.findIndex((item) => item.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) {
        return prev;
      }
      const copy = [...prev];
      const [sourceItem] = copy.splice(sourceIndex, 1);
      copy.splice(targetIndex, 0, sourceItem);
      return copy;
    });
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files?.length) {
      addFiles(event.dataTransfer.files);
    }
  }

  const hasUploads = useMemo(() => pendingUploads.length > 0, [pendingUploads.length]);

  useEffect(() => {
    if (!lightbox) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightbox(null);
        return;
      }
      if (event.key === "ArrowLeft") {
        setLightbox((prev) =>
          prev ? { ...prev, index: Math.max(0, prev.index - 1) } : prev
        );
        return;
      }
      if (event.key === "ArrowRight") {
        setLightbox((prev) =>
          prev ? { ...prev, index: Math.min(prev.medias.length - 1, prev.index + 1) } : prev
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightbox]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!selectedUploadId || loading || lightbox) {
        return;
      }
      const selected = pendingUploads.find((item) => item.id === selectedUploadId);
      if (!selected || selected.status === "uploading") {
        return;
      }
      if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        movePendingUpload(selectedUploadId, -1);
        return;
      }
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        movePendingUpload(selectedUploadId, 1);
        return;
      }
      if (event.key === "Delete") {
        event.preventDefault();
        removePendingUpload(selectedUploadId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedUploadId, loading, lightbox, pendingUploads]);

  return (
    <main style={{ fontFamily: "sans-serif", margin: "2rem auto", maxWidth: 760 }}>
      <h1>Nova Agent Platform</h1>
      <p>Local-first agent control surface for chat, channels, and autonomous tasks.</p>
      <ul>
        <li>Channels: web, WhatsApp, Signal</li>
        <li>Models: Ollama, LM Studio, Copilot-compatible</li>
        <li>Use /run &lt;command&gt; to execute shell commands</li>
        <li>
          <Link href="/dashboard">Open dashboard</Link>
        </li>
        <li>
          <Link href="/settings">Open settings</Link>
        </li>
        <li>
          <Link href="/learning">Open learning timeline</Link>
        </li>
        <li>
          <Link href="/emotion">Open emotion timeline</Link>
        </li>
        <li>
          <Link href="/security">Open Security Center</Link>
        </li>
      </ul>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <input
          value={phoneNumber}
          onChange={(event) => setPhoneNumber(event.target.value)}
          placeholder="Optional phone number (for identity simulation)"
          style={{ padding: 8 }}
        />
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Ask Nova to do something..."
          rows={4}
          style={{ padding: 8 }}
        />
        <input
          value={imageUrl}
          onChange={(event) => setImageUrl(event.target.value)}
          placeholder="Optional image URL for automatic vision analysis"
          style={{ padding: 8 }}
        />
        <input
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={(event) => addFiles(event.target.files ?? [])}
          style={{ padding: 8 }}
        />
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          style={{
            border: "2px dashed #999",
            borderRadius: 8,
            padding: 12,
            background: dragOver ? "#eef5ff" : "#fafafa"
          }}
        >
          Drop images/videos here for multi-file upload
        </div>
        {hasUploads ? (
          <section style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 12, color: "#555" }}>
              Tip: drag cards to reorder, or select a card then use <code>Alt+Up</code>/<code>Alt+Down</code>. Press{" "}
              <code>Delete</code> to remove selected.
            </div>
            {pendingUploads.map((item, index) => (
              <div
                key={item.id}
                draggable={item.status !== "uploading" && !loading}
                tabIndex={0}
                onClick={() => setSelectedUploadId(item.id)}
                onFocus={() => setSelectedUploadId(item.id)}
                onDragStart={() => setDraggedUploadId(item.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedUploadId) {
                    movePendingUploadToTarget(draggedUploadId, item.id);
                  }
                  setDraggedUploadId(null);
                }}
                onDragEnd={() => setDraggedUploadId(null)}
                style={{
                  border: selectedUploadId === item.id ? "2px solid #2b7cff" : "1px solid #ddd",
                  borderRadius: 8,
                  padding: 8,
                  background: draggedUploadId === item.id ? "#f0f7ff" : "#fff"
                }}
              >
                <div style={{ fontSize: 13, marginBottom: 6, display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span>
                    {item.file.name} ({Math.ceil(item.file.size / 1024)} KB) - {item.status}
                  </span>
                  <span style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => movePendingUpload(item.id, -1)}
                      disabled={index === 0 || item.status === "uploading" || loading}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      onClick={() => movePendingUpload(item.id, 1)}
                      disabled={index === pendingUploads.length - 1 || item.status === "uploading" || loading}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      onClick={() => removePendingUpload(item.id)}
                      disabled={item.status === "uploading" || loading}
                    >
                      Remove
                    </button>
                  </span>
                </div>
                <div style={{ height: 8, background: "#eee", borderRadius: 4, overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${item.progress}%`,
                      height: "100%",
                      background: item.status === "error" ? "#d9534f" : "#2b7cff"
                    }}
                  />
                </div>
              </div>
            ))}
          </section>
        ) : null}
        <button type="submit" disabled={loading} style={{ padding: "8px 12px" }}>
          {loading ? "Sending..." : "Send"}
        </button>
      </form>
      <section style={{ marginTop: 20 }}>
        {turns.map((turn, index) => (
          <article
            key={`${turn.role}-${index}`}
            style={{
              background: turn.role === "user" ? "#eef5ff" : "#f6f6f6",
              borderRadius: 8,
              padding: 10,
              marginBottom: 10
            }}
          >
            <strong>{turn.role === "user" ? "You" : "Nova"}:</strong> {turn.text}
            {turn.medias?.length ? (
              <MediaGallery
                medias={turn.medias}
                onOpen={(index) => setLightbox({ medias: turn.medias ?? [], index })}
              />
            ) : null}
          </article>
        ))}
      </section>
      {lightbox ? (
        <Lightbox
          media={lightbox.medias[lightbox.index]}
          hasPrev={lightbox.index > 0}
          hasNext={lightbox.index < lightbox.medias.length - 1}
          onClose={() => setLightbox(null)}
          onPrev={() =>
            setLightbox((prev) =>
              prev ? { ...prev, index: Math.max(0, prev.index - 1) } : prev
            )
          }
          onNext={() =>
            setLightbox((prev) =>
              prev ? { ...prev, index: Math.min(prev.medias.length - 1, prev.index + 1) } : prev
            )
          }
        />
      ) : null}
    </main>
  );
}

function MediaGallery({
  medias,
  onOpen
}: {
  medias: ChatMedia[];
  onOpen: (index: number) => void;
}) {
  return (
    <div
      style={{
        marginTop: 10,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        gap: 8
      }}
    >
      {medias.map((media, index) => (
        <button
          key={`${media.url}-${index}`}
          type="button"
          onClick={() => onOpen(index)}
          style={{
            border: "1px solid #ddd",
            borderRadius: 8,
            overflow: "hidden",
            padding: 0,
            background: "#fff",
            cursor: "pointer"
          }}
        >
          {media.kind === "image" ? (
            <img src={media.url} alt="chat media" style={{ width: "100%", height: 120, objectFit: "cover" }} />
          ) : media.posterUrl ? (
            <img src={media.posterUrl} alt="video poster" style={{ width: "100%", height: 120, objectFit: "cover" }} />
          ) : (
            <video
              src={media.url}
              style={{ width: "100%", height: 120, objectFit: "cover", background: "#000" }}
              muted
            />
          )}
        </button>
      ))}
    </div>
  );
}

function Lightbox({
  media,
  hasPrev,
  hasNext,
  onClose,
  onPrev,
  onNext
}: {
  media?: ChatMedia;
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (!media) {
    return null;
  }
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{ maxWidth: "90vw", maxHeight: "90vh", display: "grid", gap: 10 }}
      >
        {media.kind === "image" ? (
          <img src={media.url} alt="lightbox media" style={{ maxWidth: "90vw", maxHeight: "80vh", objectFit: "contain" }} />
        ) : (
          <video
            src={media.url}
            poster={media.posterUrl}
            controls
            autoPlay
            style={{ maxWidth: "90vw", maxHeight: "80vh", objectFit: "contain", background: "#000" }}
          />
        )}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 12px" }}>
            Close
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onPrev} disabled={!hasPrev} style={{ padding: "8px 12px" }}>
              Prev
            </button>
            <button type="button" onClick={onNext} disabled={!hasNext} style={{ padding: "8px 12px" }}>
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      const base64 = raw.includes(",") ? raw.split(",")[1] : raw;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function extractMediaUrls(text: string): ChatMedia[] {
  const matches = text.match(/https?:\/\/\S+/g) ?? [];
  return matches
    .map((url) => {
      const kind = inferMediaKind(url);
      if (!kind) return undefined;
      return { url, kind };
    })
    .filter((item): item is ChatMedia => Boolean(item));
}

function inferMediaKind(url?: string): "image" | "video" | undefined {
  if (!url) return undefined;
  const lower = url.toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/.test(lower) || lower.includes("/view?filename=")) {
    return "image";
  }
  if (/\.(mp4|webm|mov|m4v)(\?|$)/.test(lower)) {
    return "video";
  }
  return undefined;
}

async function uploadSelectedFileWithProgress(
  filename: string,
  base64: string,
  onProgress: (percent: number) => void
): Promise<ChatMedia | undefined> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media/upload");
    xhr.setRequestHeader("content-type", "application/json");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.max(1, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onerror = () => resolve(undefined);
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        resolve(undefined);
        return;
      }
      try {
        const payload = JSON.parse(xhr.responseText) as {
          url?: string;
          posterUrl?: string;
          kind?: "image" | "video" | "other";
        };
        const url = payload.url;
        const inferred = payload.kind === "video" || payload.kind === "image" ? payload.kind : inferMediaKind(url);
        if (!url || !inferred) {
          resolve(undefined);
          return;
        }
        resolve({
          url,
          kind: inferred,
          posterUrl: payload.posterUrl
        });
      } catch {
        resolve(undefined);
      }
    };
    xhr.send(JSON.stringify({ filename, base64 }));
  });
}
