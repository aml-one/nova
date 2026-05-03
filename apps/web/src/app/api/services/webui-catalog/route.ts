import { NextResponse } from "next/server";
import { mergeServiceWebUiCatalog } from "../../../../lib/service-webui-catalog";

/**
 * Catalog of TCP ports that expose HTTP UIs on the **same machine** as Nova.
 * Override with env `NOVA_SERVICE_WEBUIS_JSON` on the Next.js server, e.g.
 * `[{"port":5005,"title":"Metrics","description":"…","basePath":"/"},{"port":7860,"title":"Gradio"}]`
 */
export async function GET() {
  const catalog = mergeServiceWebUiCatalog(process.env.NOVA_SERVICE_WEBUIS_JSON);
  return NextResponse.json({ catalog });
}
