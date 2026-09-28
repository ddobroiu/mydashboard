import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { raiseAlert, resolveAlert } from "@/lib/alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Site-urile de print nu sunt proiecte in mydashboard (sunt urmarite in shopprint), dar le verificam si pe ele
const EXTRA = ["www.shopprint.ro", "www.tablou.net", "www.homeprint.ro", "www.adbanner.ro", "www.euprint.ro", "www.prynt.ro", "www.anuntul.info"];

async function check(host: string): Promise<{ ok: boolean; detail: string }> {
  let detail = "nu se poate conecta";
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(`https://${host}/`, {
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "mydashboard-health/1.0" },
      });
      if (res.status < 500) return { ok: true, detail: String(res.status) };
      detail = `răspunde cu eroarea ${res.status}`;
    } catch (e) {
      detail = e instanceof Error && e.name === "TimeoutError" ? "nu răspunde în 15 secunde" : "nu se poate conecta";
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { ok: false, detail };
}

// Apelat din cron la 5 minute. Un site e anuntat picat abia dupa 2 runde consecutive esuate (~10 minute).
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const projects = await prisma.project.findMany({ where: { domain: { not: null } }, select: { name: true, domain: true } });
  const sites = [
    ...projects.map((p) => ({ name: p.name, host: String(p.domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "") })),
    ...EXTRA.map((h) => ({ name: h.replace(/^www\./, ""), host: h })),
  ];
  const results = await Promise.all(sites.map(async (s) => ({ ...s, ...(await check(s.host)) })));
  for (const r of results) {
    const key = `down:${r.host}`;
    if (r.ok) {
      await resolveAlert(key, `${r.host} funcționează din nou.`);
      continue;
    }
    const prev = await prisma.alertState.findUnique({ where: { key } });
    if (!prev?.active) {
      // prima runda esuata: o notam; anuntam doar daca pica si la urmatoarea
      await prisma.alertState.upsert({
        where: { key },
        create: { key, kind: "down", project: r.name, message: r.detail, active: true, failures: 1 },
        update: { active: true, failures: 1, message: r.detail },
      });
      continue;
    }
    await raiseAlert({ key, kind: "down", project: r.name, message: `https://${r.host} ${r.detail}.` });
  }
  return NextResponse.json({ checked: results.length, down: results.filter((r) => !r.ok).map((r) => r.host) });
}
