"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "../../components/ui/card";
import type { ServiceWebUiEntry } from "../../lib/service-webui-catalog";

export default function ServicesWebUiPage() {
  const [catalog, setCatalog] = useState<ServiceWebUiEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<{ protocol: string; hostname: string } | null>(null);

  useEffect(() => {
    setOrigin({
      protocol: window.location.protocol,
      hostname: window.location.hostname
    });
    void (async () => {
      try {
        const response = await fetch("/api/services/webui-catalog");
        const data = (await response.json()) as { catalog?: ServiceWebUiEntry[] };
        if (!response.ok) throw new Error("catalog request failed");
        setCatalog(Array.isArray(data.catalog) ? data.catalog : []);
      } catch {
        setLoadError("Could not load service catalog.");
      }
    })();
  }, []);

  const frames = useMemo(() => {
    if (!origin) return [];
    const { protocol, hostname } = origin;
    return catalog.map((svc) => {
      const path = svc.basePath ?? "/";
      const url = `${protocol}//${hostname}:${svc.port}${path}`;
      return { svc, url };
    });
  }, [catalog, origin]);

  const httpsEmbeddingHttp = origin?.protocol === "https:";

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <h1 className="text-2xl font-semibold">Service Web UIs</h1>
        <p className="text-sm text-muted">
          Embedded dashboards run on other TCP ports on the <strong className="text-foreground">same computer</strong> as Nova.
          Frames use your browser&apos;s current host (<strong className="text-foreground">not</strong> <code className="rounded bg-surface2 px-1">127.0.0.1</code>), so opening Nova as{" "}
          <code className="rounded bg-surface2 px-1">http://192.168.x.x:3000</code> loads{" "}
          <code className="rounded bg-surface2 px-1">http://192.168.x.x:5005</code> automatically for each listed port.
        </p>
        <ul className="list-inside list-disc text-xs text-muted">
          <li>Each service must listen on <code className="rounded bg-surface2 px-0.5">0.0.0.0</code> (or your LAN IP), not only loopback, if clients are remote.</li>
          <li>Open the firewall on those ports on the Nova host.</li>
          <li>
            Extend this list with env{" "}
            <code className="rounded bg-surface2 px-0.5">NOVA_SERVICE_WEBUIS_JSON</code> on the Next.js server (JSON array of{" "}
            <code className="rounded bg-surface2 px-0.5">port</code>, <code className="rounded bg-surface2 px-0.5">title</code>,{" "}
            <code className="rounded bg-surface2 px-0.5">description</code>, <code className="rounded bg-surface2 px-0.5">basePath</code>).
          </li>
          <li>
            If a frame stays blank, the upstream app may send{" "}
            <code className="rounded bg-surface2 px-0.5">X-Frame-Options: DENY</code> — open in a new tab instead.
          </li>
        </ul>
        {httpsEmbeddingHttp ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-xs text-amber-950 dark:text-amber-100">
            You are on HTTPS; embedding plain HTTP services may be blocked by the browser (mixed content). Use HTTP for Nova or put services behind HTTPS / same-origin proxy.
          </p>
        ) : null}
      </Card>

      {loadError ? (
        <Card className="border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-900 dark:text-rose-100">{loadError}</Card>
      ) : null}

      {!origin ? (
        <Card className="p-4 text-sm text-muted">Preparing…</Card>
      ) : catalog.length === 0 ? (
        <Card className="p-4 text-sm text-muted">No services in catalog.</Card>
      ) : (
        frames.map(({ svc, url }) => (
          <Card key={svc.id} className="space-y-2 overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{svc.title}</h2>
                <p className="text-xs text-muted">{svc.description}</p>
                <p className="mt-1 font-mono text-[11px] text-foreground/90">{url}</p>
              </div>
              <Link
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-ui border border-blue-500/70 bg-pastelBlue px-2.5 py-1.5 text-xs font-medium text-slate-900 shadow-sm hover:brightness-95 dark:text-slate-900"
              >
                Open in new tab
              </Link>
            </div>
            <div className="relative min-h-[420px] w-full rounded-xl border bg-black/10 dark:bg-black/30">
              <iframe
                title={svc.title}
                src={url}
                className="h-[min(72vh,900px)] w-full rounded-xl bg-white dark:bg-slate-950"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
