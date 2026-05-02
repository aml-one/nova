"use client";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Pastel blocks for nested JSON (generic fallback). */
export function PastelJsonTree({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const shells = [
    "border-sky-400/25 bg-sky-500/[0.11]",
    "border-violet-400/25 bg-violet-500/[0.11]",
    "border-amber-400/25 bg-amber-500/[0.11]"
  ] as const;
  const shell = shells[depth % shells.length];

  if (value === null) {
    return <span className="text-xs text-muted">null</span>;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span className="break-all font-mono text-[11px] text-foreground/90">{JSON.stringify(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="font-mono text-[11px] text-muted">[]</span>;
    }
    return (
      <ul className={`space-y-1.5 rounded-lg border p-2 ${shell}`}>
        {value.map((item, index) => (
          <li key={index} className="flex gap-2">
            <span className="w-6 shrink-0 text-[10px] text-muted">{index}</span>
            <div className="min-w-0 flex-1">
              <PastelJsonTree value={item} depth={depth + 1} />
            </div>
          </li>
        ))}
      </ul>
    );
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return <span className="font-mono text-[11px] text-muted">{"{}"}</span>;
    }
    return (
      <div className={`space-y-1.5 rounded-lg border p-2 ${shell}`}>
        {keys.map((key) => (
          <div key={key} className="grid gap-1 sm:grid-cols-[minmax(7rem,32%)_1fr] sm:items-start">
            <span className="break-words text-[11px] font-semibold text-muted">{key}</span>
            <PastelJsonTree value={value[key]} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-xs text-muted">unknown</span>;
}

function BoolPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        ok
          ? "border-emerald-400/35 bg-emerald-400/15 text-emerald-200"
          : "border-rose-400/35 bg-rose-400/12 text-rose-200"
      }`}
    >
      {label}: {ok ? "yes" : "no"}
    </span>
  );
}

function LaneCard({ name, lane }: { name: string; lane: Record<string, unknown> | undefined }) {
  if (!lane) return null;
  const configured = Boolean(lane.configured);
  const model = String(lane.model ?? "—");
  const baseUrl = String(lane.baseUrl ?? "—");
  const hasApiKey = lane.hasApiKey !== undefined ? Boolean(lane.hasApiKey) : undefined;
  return (
    <div
      className={`rounded-lg border p-2 text-xs ${
        configured ? "border-teal-400/30 bg-teal-500/[0.10]" : "border-slate-500/30 bg-slate-500/[0.08]"
      }`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-semibold capitalize text-foreground/95">{name}</span>
        <BoolPill ok={configured} label="configured" />
      </div>
      <div className="space-y-0.5 text-[11px] text-muted">
        <div>
          <span className="text-foreground/70">model:</span> <span className="font-mono text-foreground/85">{model}</span>
        </div>
        <div>
          <span className="text-foreground/70">base:</span> <span className="font-mono text-foreground/85">{baseUrl}</span>
        </div>
        {hasApiKey !== undefined ? (
          <div>
            <span className="text-foreground/70">API key:</span> <BoolPill ok={hasApiKey} label="set" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Rich readout for GET /api/debug/vision and GET /api/debug/chat-routing payloads. */
export function DebugRoutingHumanView({ payload }: { payload: Record<string, unknown> }) {
  const debug = payload.debug;
  if (!isRecord(debug)) {
    return <PastelJsonTree value={payload} depth={0} />;
  }

  const vision = isRecord(debug.vision) ? debug.vision : undefined;
  const chat = isRecord(debug.chat) ? debug.chat : undefined;
  const explain = isRecord(debug.explain) ? debug.explain : undefined;

  const lanes = isRecord(vision?.lanes) ? (vision!.lanes as Record<string, unknown>) : undefined;
  const cloudConfigured = lanes?.cloud && isRecord(lanes.cloud) ? Boolean((lanes.cloud as Record<string, unknown>).configured) : false;

  const priority = Array.isArray(vision?.visionProviderPriority)
    ? (vision!.visionProviderPriority as string[])
    : [];

  return (
    <div className="space-y-3">
      {typeof payload.correlationId === "string" ? (
        <div className="inline-flex rounded-full border border-fuchsia-400/25 bg-fuchsia-500/10 px-2.5 py-1 text-[10px] text-fuchsia-100/90">
          correlation: <span className="ml-1 font-mono">{payload.correlationId}</span>
        </div>
      ) : null}

      <section className="rounded-lg border border-cyan-400/25 bg-cyan-500/[0.09] p-3 text-xs leading-relaxed text-cyan-50/95">
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-cyan-100/90">How to read this</h3>
        <ul className="list-inside list-disc space-y-1 text-[11px] text-cyan-50/85">
          <li>
            <strong className="text-cyan-100">Vision</strong> (image understanding) follows{" "}
            <strong className="text-cyan-100">Settings → Vision</strong> and the{" "}
            <strong className="text-cyan-100">lanes</strong> below.{" "}
            <strong className="text-cyan-100">Copilot / OpenAI cloud is only used for vision</strong> when the{" "}
            <strong className="text-cyan-100">cloud</strong> lane is configured (base URL + model + API key).
          </li>
          <li>
            <strong className="text-cyan-100">Chat</strong> (the final assistant reply) can still show{" "}
            <strong className="text-cyan-100">provider: copilot</strong> in run history if{" "}
            <strong className="text-cyan-100">local-first chat</strong> fell through after Ollama/LM Studio errors — that is{" "}
            <strong className="text-cyan-100">not</strong> the same as “vision used Copilot.”
          </li>
          <li>
            If <strong className="text-cyan-100">cloud.configured</strong> is <strong className="text-cyan-100">no</strong> here, vision is{" "}
            <strong className="text-cyan-100">not</strong> using OpenAI/Copilot cloud; check Ollama vision errors in{" "}
            <strong className="text-cyan-100">Thoughts</strong> (look for <span className="font-mono">Vision analyze outcome</span>).
          </li>
        </ul>
      </section>

      {explain ? (
        <section className="rounded-lg border border-sky-400/25 bg-sky-500/[0.10] p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-sky-100/90">Explain</h3>
          <div className="space-y-2 text-[11px] leading-relaxed text-sky-50/90">
            {Object.entries(explain).map(([k, v]) => (
              <p key={k}>
                <span className="font-semibold text-sky-100/95">{k}: </span>
                {String(v)}
              </p>
            ))}
          </div>
        </section>
      ) : null}

      {vision ? (
        <section className="rounded-lg border border-violet-400/25 bg-violet-500/[0.10] p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-violet-100/90">Vision routing</h3>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {priority.map((lane, i) => (
              <span
                key={`${lane}-${i}`}
                className="rounded-full border border-violet-300/30 bg-violet-400/15 px-2 py-0.5 text-[10px] font-medium text-violet-100"
              >
                {i + 1}. {lane}
              </span>
            ))}
          </div>
          <div className="mb-2 flex flex-wrap gap-2 text-[11px]">
            <BoolPill ok={Boolean(vision.hasConfiguredProvider)} label="Any lane configured" />
            {typeof vision.swapLocalModelsForVision === "boolean" ? (
              <BoolPill ok={vision.swapLocalModelsForVision} label="Unload chat for vision swap" />
            ) : null}
          </div>
          {lanes ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <LaneCard name="ollama" lane={lanes.ollama as Record<string, unknown> | undefined} />
              <LaneCard name="lmstudio" lane={lanes.lmstudio as Record<string, unknown> | undefined} />
              <LaneCard name="cloud" lane={lanes.cloud as Record<string, unknown> | undefined} />
            </div>
          ) : null}
          {!cloudConfigured ? (
            <p className="mt-2 text-[11px] text-violet-100/80">
              Cloud vision is <strong>off</strong> in this snapshot — Copilot is <strong>not</strong> acting as the vision API here.
            </p>
          ) : null}
        </section>
      ) : null}

      {chat ? (
        <section className="rounded-lg border border-amber-400/25 bg-amber-500/[0.10] p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-100/90">Chat routing</h3>
          <div className="grid gap-2 text-[11px] text-amber-50/90 sm:grid-cols-2">
            <div className="rounded-md border border-amber-300/20 bg-amber-400/10 p-2">
              <div className="text-[10px] font-semibold uppercase text-amber-100/80">Settings active</div>
              <div className="font-mono text-foreground/90">{String(chat.settingsActiveProvider ?? "—")}</div>
            </div>
            <div className="rounded-md border border-amber-300/20 bg-amber-400/10 p-2">
              <div className="text-[10px] font-semibold uppercase text-amber-100/80">Router active</div>
              <div className="font-mono text-foreground/90">{String(chat.modelRouterActiveProvider ?? "—")}</div>
            </div>
            {isRecord(chat.defaultModelsByProvider) ? (
              <div className="sm:col-span-2 rounded-md border border-amber-300/20 bg-amber-400/10 p-2">
                <div className="mb-1 text-[10px] font-semibold uppercase text-amber-100/80">Default chat models</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(chat.defaultModelsByProvider as Record<string, unknown>).map(([k, v]) => (
                    <span
                      key={k}
                      className="rounded-full border border-amber-300/25 bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] text-amber-50"
                    >
                      {k}: {String(v || "—")}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {Array.isArray(chat.localFirstTryOrder) ? (
              <div className="sm:col-span-2 rounded-md border border-amber-300/20 bg-amber-400/10 p-2">
                <div className="mb-1 text-[10px] font-semibold uppercase text-amber-100/80">Local-first try order (with image)</div>
                <div className="flex flex-wrap gap-1.5">
                  {(chat.localFirstTryOrder as string[]).map((name, i) => (
                    <span
                      key={`${name}-${i}`}
                      className="rounded-full border border-amber-300/30 bg-amber-400/15 px-2 py-0.5 text-[10px] font-medium text-amber-50"
                    >
                      {i + 1}. {name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {typeof chat.visionBaseUrlHint === "string" ? (
              <div className="sm:col-span-2 rounded-md border border-amber-300/20 bg-amber-400/10 p-2 text-[11px] leading-relaxed text-amber-50/90">
                <span className="font-semibold text-amber-100">Vision base URL: </span>
                {chat.visionBaseUrlHint}
              </div>
            ) : null}
            {isRecord(chat.integrationSkipsProvider) ? (
              <div className="sm:col-span-2 rounded-md border border-amber-300/20 bg-amber-400/10 p-2">
                <div className="mb-1 text-[10px] font-semibold uppercase text-amber-100/80">Integration layer (skips provider)</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(chat.integrationSkipsProvider as Record<string, unknown>).map(([k, v]) => (
                    <BoolPill key={k} ok={!Boolean(v)} label={`${k} allowed`} />
                  ))}
                </div>
              </div>
            ) : null}
            {isRecord(chat.settingsDisabledFlags) ? (
              <div className="sm:col-span-2 rounded-md border border-amber-300/20 bg-amber-400/10 p-2">
                <div className="mb-1 text-[10px] font-semibold uppercase text-amber-100/80">Settings → Models (disabled)</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(chat.settingsDisabledFlags as Record<string, unknown>).map(([k, v]) => (
                    <BoolPill key={k} ok={!Boolean(v)} label={`${k} enabled`} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function EndpointResultBody({
  header,
  parsed,
  rawPretty
}: {
  header: string;
  parsed: unknown | null;
  rawPretty: string;
}) {
  if (parsed === null) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-foreground/90">{header}</div>
        <div className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-2 py-2 text-[11px] leading-relaxed text-amber-50/90">
          Response body is <strong className="text-amber-100">not JSON</strong>. Use <strong className="text-amber-100">Raw JSON</strong> below for the
          exact text.
        </div>
        <details className="group rounded-lg border border-slate-500/25 bg-slate-500/[0.06]">
          <summary className="cursor-pointer list-none px-2 py-2 text-[11px] font-semibold text-muted marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2">
              <span className="rounded border border-slate-400/30 bg-slate-400/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-200/90">
                Raw body
              </span>
              <span className="text-muted/80 group-open:hidden">(collapsed)</span>
              <span className="hidden text-muted/80 group-open:inline">(expanded)</span>
            </span>
          </summary>
          <pre className="max-h-[38vh] overflow-auto border-t border-slate-500/20 p-2 font-mono text-[10px] leading-relaxed text-foreground/85">
            {rawPretty}
          </pre>
        </details>
      </div>
    );
  }

  const isDebugPayload = isRecord(parsed) && "debug" in parsed;

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-foreground/90">{header}</div>
      {isDebugPayload ? <DebugRoutingHumanView payload={parsed as Record<string, unknown>} /> : <PastelJsonTree value={parsed} depth={0} />}
      <details className="group rounded-lg border border-slate-500/25 bg-slate-500/[0.06]">
        <summary className="cursor-pointer list-none px-2 py-2 text-[11px] font-semibold text-muted marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2">
            <span className="rounded border border-slate-400/30 bg-slate-400/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-200/90">
              Raw JSON
            </span>
            <span className="text-muted/80 group-open:hidden">(collapsed)</span>
            <span className="hidden text-muted/80 group-open:inline">(expanded)</span>
          </span>
        </summary>
        <pre className="max-h-[38vh] overflow-auto border-t border-slate-500/20 p-2 font-mono text-[10px] leading-relaxed text-foreground/85">
          {rawPretty}
        </pre>
      </details>
    </div>
  );
}
