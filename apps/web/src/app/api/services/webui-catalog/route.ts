import { NextResponse } from "next/server";
import { mergeServiceWebUiCatalog } from "../../../../lib/service-webui-catalog";

/**
 * Catalog of embedded service UIs: same-origin Nova paths (`sameOriginPath`) and/or TCP ports on the Nova host.
 * Override with env `NOVA_SERVICE_WEBUIS_JSON` on the Next.js server, e.g.
 * `[{"sameOriginPath":"/memory","title":"Memory","description":"…"},{"port":5005,"title":"Metrics","description":"…","basePath":"/"}]`
 */
export async function GET() {
  const catalog = mergeServiceWebUiCatalog(process.env.NOVA_SERVICE_WEBUIS_JSON);
  return NextResponse.json({ catalog });
}
