"use client";

import { useMemo, useState, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Options as RehypeSanitizeSchema } from "rehype-sanitize";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "./ui/button";

const NOVA_TONE_CLASS = /^(?:nova-chat-tone-muted|nova-chat-tone-strong|nova-chat-tone-soft|nova-chat-tone-heading)$/;

const chatMarkdownSanitizeSchema: RehypeSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    span: [["className", NOVA_TONE_CLASS]]
  }
};

/** rehype plugin tuple; typed loosely because `unified` is not a direct dependency of this package */
const chatRehypePlugins = [rehypeRaw, [rehypeSanitize, chatMarkdownSanitizeSchema]] as unknown[];

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
  /** When set (assistant bubbles), enables seed-based tone spans from sanitized HTML */
  toneSeed?: ChatMarkdownToneSeed;
};

export function ChatMarkdown({ content, toneSeed }: ChatMarkdownProps) {
  const markdown = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={chatRehypePlugins as ComponentProps<typeof ReactMarkdown>["rehypePlugins"]}
        components={{
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
        }}
      >
        {content}
      </ReactMarkdown>
    ),
    [content]
  );

  if (!toneSeed) {
    return markdown;
  }

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
      {markdown}
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
