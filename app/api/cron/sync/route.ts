import { NextResponse } from "next/server";
import { syncAll } from "@/lib/sync";
import { syncAiAccountsDue } from "@/lib/ai-accounts";
import { purgeOldTracking } from "@/lib/tracking/collect";
import { checkElevenLabsAlerts } from "@/lib/elevenlabs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Apelat de GitHub Actions (.github/workflows/sync.yml) de cateva ori pe zi.
// Re-sincronizeaza ultimele 3 zile, ca sa prinda corecturile tarzii ale platformelor.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const days = Math.min(Number(new URL(req.url).searchParams.get("days")) || 3, 90);
  const results = await syncAll(days);
  // Costul AI din conturile Anthropic / OpenAI: o singura citire pe zi (restul rularilor il sar)
  const ai = await syncAiAccountsDue().catch((e) => [{ ok: false as const, error: e instanceof Error ? e.message : String(e) }]);
  // ElevenLabs (vocea din PostingClips): consumul de caractere si alertele 80% / 95% / 100% / cheie refuzata.
  // Doar citire (gratuit); fara ELEVENLABS_API_KEY nu face nimic. O eroare aici nu opreste raspunsul.
  const voice = await checkElevenLabsAlerts().catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
  // Tine promisiunea de pastrare din nota de confidentialitate; o eroare aici nu opreste raspunsul
  await purgeOldTracking().catch((e) => console.error("[purge]", e instanceof Error ? e.message : e));
  const failed = [...results, ...ai].filter((r) => !r.ok);
  return NextResponse.json({ synced: results.length, failed: failed.length, results, ai, voice }, { status: failed.length ? 207 : 200 });
}
