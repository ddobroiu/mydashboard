import { NextResponse } from "next/server";
import { isBot } from "@/lib/tracking/sources";
import { parseHit, recordHit } from "@/lib/tracking/collect";

export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

// Primeste vizitele de la scriptul t.js (sendBeacon, text/plain, fara preflight).
export async function POST(req: Request) {
  const ua = req.headers.get("user-agent") ?? "";
  if (!isBot(ua)) {
    try {
      const hit = parseHit(JSON.parse(await req.text()));
      if (hit) await recordHit(hit, ua);
    } catch (e) {
      console.error("[track]", e instanceof Error ? e.message : e);
    }
  }
  // Mereu 204: scriptul nu are ce face cu o eroare, iar site-ul nu trebuie sa sufere
  return new NextResponse(null, { status: 204, headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
