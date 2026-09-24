import { trackerScript } from "@/lib/tracking/script";

export const dynamic = "force-dynamic";

// Scriptul de tracking pus pe site-uri (vezi lib/tracking/script.ts).
export function GET() {
  const base = (process.env.AUTH_URL || "https://mydashboard.ro").replace(/\/+$/, "");
  return new Response(trackerScript(`${base}/api/t`), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}
