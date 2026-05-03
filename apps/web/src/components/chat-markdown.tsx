"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "../lib/cn";
import { Button } from "./ui/button";

const NOVA_TONES = new Set(["muted", "strong", "soft", "heading"]);
export type NovaChatTone = "muted" | "strong" | "soft" | "heading";

export type ChatMarkdownToneSeed = {
  /** Resolved assistant text color (hex), after readability adjustment */
  textColor: string;
  /** Bubble or surface background used to blend muted tones */
  bubbleBackground: string;
  /** UI theme: drives whether "strong" mixes toward black vs white */
  variant: "light" | "dark";
};

type ChatMarkdownProps = {
  content: string;
  /** When set (assistant bubbles), enables seed-based tone wrappers from `[nova:tone]…[/nova]` */
  toneSeed?: ChatMarkdownToneSeed;
};

type RenderUnit =
  | { kind: "md"; text: string }
  | { kind: "fence"; text: string }
  | { kind: "tone"; tone: NovaChatTone; text: string };

/**
 * Hide Orpheus stage cues in chat text while preserving them in the raw turn text
 * (raw text is still used by read-aloud synthesis, traces, and debugging views).
 */
function stripOrpheusCueTagsForDisplay(source: string): string {
  const names = "laugh|sigh|chuckle|cough|sniffle|groan|gasp";
  return source
    .replace(new RegExp(`<(?:${names})\\b[^>]*>`, "gi"), "")
    /** `<chuckle Cleo…` without `>` — strip cue prefix so chat stays readable */
    .replace(new RegExp(`<(?:${names})\\b\\s+(?=[^\\s>])`, "gi"), "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Legacy HTML from earlier prompts → bracket syntax (only whitelisted classes). */
function normalizeLegacyNovaSpans(source: string): string {
  return source.replace(
    /<span\s+class="nova-chat-tone-(muted|strong|soft|heading)"\s*>([\s\S]*?)<\/span>/gi,
    (_full, tone: string, inner: string) => `[nova:${String(tone).toLowerCase()}]${inner}[/nova]`
  );
}

type FencePiece = { kind: "prose"; text: string } | { kind: "fence"; text: string };

function splitPreservingCodeFences(source: string): FencePiece[] {
  const out: FencePiece[] = [];
  let i = 0;
  while (i < source.length) {
    const start = source.indexOf("```", i);
    if (start === -1) {
      if (i < source.length) out.push({ kind: "prose", text: source.slice(i) });
      break;
    }
    if (start > i) {
      out.push({ kind: "prose", text: source.slice(i, start) });
    }
    const end = source.indexOf("```", start + 3);
    if (end === -1) {
      out.push({ kind: "prose", text: source.slice(start) });
      break;
    }
    out.push({ kind: "fence", text: source.slice(start, end + 3) });
    i = end + 3;
  }
  if (out.length === 0 && source.length > 0) {
    out.push({ kind: "prose", text: source });
  }
  return out;
}

function splitTonesInProse(segment: string): Array<{ kind: "md"; text: string } | { kind: "tone"; tone: NovaChatTone; text: string }> {
  const re = /\[nova:(muted|strong|soft|heading)\]([\s\S]*?)\[\/nova\]/g;
  const parts: Array<{ kind: "md"; text: string } | { kind: "tone"; tone: NovaChatTone; text: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    if (m.index > last) {
      parts.push({ kind: "md", text: segment.slice(last, m.index) });
    }
    const tone = m[1].toLowerCase() as NovaChatTone;
    if (NOVA_TONES.has(tone)) {
      parts.push({ kind: "tone", tone, text: m[2] });
    } else {
      parts.push({ kind: "md", text: m[0] });
    }
    last = m.index + m[0].length;
  }
  if (last < segment.length) {
    parts.push({ kind: "md", text: segment.slice(last) });
  }
  if (parts.length === 0 && segment.length > 0) {
    parts.push({ kind: "md", text: segment });
  }
  return parts;
}

function buildRenderUnits(source: string): RenderUnit[] {
  const normalized = normalizeLegacyNovaSpans(source);
  const units: RenderUnit[] = [];
  for (const piece of splitPreservingCodeFences(normalized)) {
    if (piece.kind === "fence") {
      units.push({ kind: "fence", text: piece.text });
      continue;
    }
    for (const chunk of splitTonesInProse(piece.text)) {
      if (chunk.kind === "md" && chunk.text.length === 0) continue;
      units.push(chunk.kind === "md" ? { kind: "md", text: chunk.text } : { kind: "tone", tone: chunk.tone, text: chunk.text });
    }
  }
  if (units.length === 0) {
    units.push({ kind: "md", text: source });
  }
  return units;
}

const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal pl-5">{children}</ol>,
  a: ({ href, children }) => (
    <a href={href} className="underline" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className || "");
    const language = match?.[1] ?? "text";
    const raw = reactNodeToPlainText(children).replace(/\n$/, "");
    if (!match) {
      return (
        <code className="rounded-ui border bg-surface2 px-1 py-0.5 font-mono text-[0.85em]" {...props}>
          {children}
        </code>
      );
    }
    return <CodeBlock code={raw} language={language} />;
  }
};

export function ChatMarkdown({ content, toneSeed }: ChatMarkdownProps) {
  const displayContent = useMemo(() => stripOrpheusCueTagsForDisplay(content), [content]);

  if (!toneSeed) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {displayContent}
      </ReactMarkdown>
    );
  }

  const units = useMemo(() => buildRenderUnits(displayContent), [displayContent]);

  const body = (
    <>
      {units.map((u, idx) => {
        if (u.kind === "tone") {
          return (
            <span key={idx} className={cn(`nova-chat-tone-${u.tone}`, "contents")}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {u.text}
              </ReactMarkdown>
            </span>
          );
        }
        if (u.text.length === 0) {
          return null;
        }
        return (
          <ReactMarkdown key={idx} remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {u.text}
          </ReactMarkdown>
        );
      })}
    </>
  );

  return (
    <div
      className="nova-chat-markdown-tones"
      data-nova-tone-variant={toneSeed.variant}
      style={
        {
          ["--nova-chat-text" as string]: toneSeed.textColor,
          ["--nova-chat-bg" as string]: toneSeed.bubbleBackground
        } as CSSProperties
      }
    >
      {body}
    </div>
  );
}

function reactNodeToPlainText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactNodeToPlainText).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return reactNodeToPlainText(props?.children);
  }
  return "";
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy(): Promise<void> {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = code;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        ok = document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-ui border">
      <div className="flex items-center justify-between border-b bg-surface2 px-2 py-1 text-xs">
        <span className="uppercase text-muted">{language}</span>
        <Button
          type="button"
          tone="blue"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void onCopy();
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{ margin: 0, borderRadius: 0, padding: "12px", fontSize: "0.85rem" }}
        wrapLongLines
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
