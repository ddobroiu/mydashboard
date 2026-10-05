import { prisma } from "@/lib/prisma";
import { addDays, dayDate, dayKey } from "@/lib/dates";
import { convert, getRates } from "@/lib/fx";
import { addAmount, currencyCount, formatAmounts, formatMoney, type Amounts } from "@/lib/metrics";
import { channelOf, simpleChannelOf } from "@/lib/tracking/sources";
import { clarityForReport } from "@/lib/clarity";
import { getAppStats, type AppStats } from "@/lib/app-stats";

// Raportul de dimineata: ieri fata de aceeasi zi de saptamana trecuta, pe proiect si total.

type Nums = { visitors: number; orders: number; revenue: number; google: number | null };

export type ReportProject = {
  id: string;
  name: string;
  currency: string;
  y: Nums;
  w: Nums;
  // in lei, pentru total
  revenueRon: number;
  revenueRonW: number;
  topSource: string | null;
  alerts: string[];
  // Microsoft Clarity, ieri: clicuri de nervi si erori JavaScript (null = fara Clarity sau fara date)
  clarity: { rageClicks: number; scriptErrors: number } | null;
};

// Cifrele din aplicatii (/api/mydashboard/stats): ultimele 24 h (h24) sau, la aplicatiile fara h24, ziua de azi
export type ReportApp = {
  name: string;
  basis: "24 h" | "azi";
  kpis: { label: string; value: string; bad: boolean }[];
};

export type DailyReport = {
  day: string;
  compareDay: string;
  dayLabel: string;
  compareLabel: string;
  projects: ReportProject[];
  // vanzarile pe moneda lor (revenue, revenueW); in lei doar pentru procent si ordine
  total: {
    visitors: number;
    visitorsW: number;
    orders: number;
    ordersW: number;
    revenue: Amounts;
    revenueW: Amounts;
    revenueRon: number;
    revenueRonW: number;
    google: number;
    googleW: number | null;
  };
  highlights: string[];
  activeAlerts: number;
  apps: ReportApp[];
};

// „fata de marțea trecută”
const LAST_WEEKDAY = ["duminica trecută", "lunea trecută", "marțea trecută", "miercurea trecută", "joia trecută", "vinerea trecută", "sâmbăta trecută"];
const WEEKDAY = ["duminică", "luni", "marți", "miercuri", "joi", "vineri", "sâmbătă"];

const n = (v: number) => Math.round(v).toLocaleString("ro-RO");

type AppKpi = AppStats["kpi"][number];
const isUnissued = (k: AppKpi) => /factur\w*\s+neemis/i.test(k.label) || /^(facturiNeemise|invoices_?missing|unissued_?invoices)$/i.test(k.key);
// Ordinea in raport: ce conteaza dimineata; restul KPI-urilor vin dupa, in ordinea aplicatiei
const PRIORITY = [/conturi noi|^users$/i, /(?<!ne)plătite|^orders$/i, /încasat|^revenue$/i, /neemis/i, /neplătit|neterminat|^unpaid$|^pending$/i, /eșuat|^email_?failed$/i];
const MAX_APP_KPIS = 6;

// KPI-urile unei aplicatii pentru raport: fara procente si medii, fara cele cu 0/null (in afara de facturile neemise > 0)
function appForReport(name: string, s: AppStats, currency: string): ReportApp {
  const basis = s.kpi.some((k) => k.h24 !== undefined && k.h24 !== null) ? "24 h" : "azi";
  const val = (k: AppKpi) => (basis === "24 h" ? k.h24 : k.today) ?? null;
  const rank = (k: AppKpi) => {
    const i = PRIORITY.findIndex((re) => re.test(k.label) || re.test(k.key));
    return i < 0 ? PRIORITY.length : i;
  };
  const fmt = (v: number, k: AppKpi) => (k.unit === "money" ? formatMoney(v, s.currency || currency) : n(v));
  const list = s.kpi
    .map((k, i) => ({ k, i }))
    .filter(({ k }) => {
      if (isUnissued(k)) return (val(k) ?? 0) > 0 || (k.total ?? 0) > 0;
      if (k.unit === "percent" || /medi[ea]/i.test(k.label)) return false;
      const v = val(k);
      return v !== null && v !== 0;
    })
    .sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i);
  // facturile neemise intra mereu, chiar daca depasesc limita
  const picked = list.slice(0, MAX_APP_KPIS);
  const unissued = list.find(({ k }) => isUnissued(k));
  if (unissued && !picked.includes(unissued)) picked[picked.length - 1] = unissued;
  picked.sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i);
  return {
    name,
    basis,
    kpis: picked.map(({ k }) => {
      const v = val(k) ?? 0;
      if (!isUnissued(k)) return { label: k.label, value: fmt(v, k), bad: false };
      // la facturi conteaza si cele ramase din urma (total), nu doar cele din ultimele 24 h
      const total = k.total ?? v;
      return { label: k.label, value: total > v ? (v ? `${n(v)} noi, ${n(total)} în total` : `${n(total)} în total`) : n(v), bad: true };
    }),
  };
}

const unissuedCount = (s: AppStats, basis: ReportApp["basis"]) =>
  s.kpi.filter(isUnissued).reduce((m, k) => Math.max(m, k.total ?? 0, (basis === "24 h" ? k.h24 : k.today) ?? 0), 0);
const deN = (v: number, word: string) => {
  const r = Math.round(v);
  return `${n(r)}${r >= 20 && (r % 100 === 0 || r % 100 >= 20) ? " de" : ""} ${word}`;
};

export async function buildDailyReport(today = dayKey(new Date())): Promise<DailyReport> {
  const day = addDays(today, -1);
  const compareDay = addDays(day, -7);
  const weekday = dayDate(day).getUTCDay();
  const rates = await getRates();

  const projects = await prisma.project.findMany({ select: { id: true, name: true, currency: true, domain: true }, orderBy: { name: "asc" } });
  const ids = projects.map((p) => p.id);
  const days = [dayDate(day), dayDate(compareDay)];
  const where = { projectId: { in: ids }, date: { in: days } };

  // Statisticile din aplicatii, in paralel (8 secunde maxim fiecare); fara endpoint sau cu eroare = sarim proiectul
  const appStatsP = Promise.all(projects.map((p) => getAppStats(p.name, p.domain).catch(() => null)));
  const [visitors, tx, sources, gsc, alerts, clarity] = await Promise.all([
    prisma.trackSession.groupBy({ by: ["projectId", "date", "visitorId"], where }),
    prisma.transaction.groupBy({ by: ["projectId", "date", "currency"], where: { ...where, amount: { gt: 0 } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.trackSession.groupBy({ by: ["projectId", "source", "medium", "clickType"], where: { projectId: { in: ids }, date: dayDate(day) }, _count: { _all: true } }),
    prisma.gscDaily.findMany({ where, select: { projectId: true, date: true, clicks: true } }),
    prisma.alertState.findMany({ where: { active: true }, select: { project: true, message: true, kind: true } }),
    clarityForReport(ids, day),
  ]);
  // Rambursarile (sume negative) scad din vanzari
  const refunds = await prisma.transaction.groupBy({ by: ["projectId", "date", "currency"], where: { ...where, amount: { lt: 0 } }, _sum: { amount: true } });

  const isY = (d: Date) => d.getTime() === days[0].getTime();
  const empty = (): Nums => ({ visitors: 0, orders: 0, revenue: 0, google: null });
  const rows = new Map<string, ReportProject>(
    projects.map((p) => [
      p.id,
      { id: p.id, name: p.name, currency: p.currency, y: empty(), w: empty(), revenueRon: 0, revenueRonW: 0, topSource: null, alerts: [], clarity: null },
    ]),
  );

  for (const v of visitors) {
    const r = rows.get(v.projectId)!;
    (isY(v.date) ? r.y : r.w).visitors += 1;
  }
  const money = [
    ...tx.map((t) => ({ ...t, count: t._count._all })),
    ...refunds.map((t) => ({ ...t, count: 0 })),
  ];
  const revenueBy: Amounts = {};
  const revenueByW: Amounts = {};
  for (const t of money) {
    const r = rows.get(t.projectId)!;
    const amount = Number(t._sum.amount ?? 0);
    const nums = isY(t.date) ? r.y : r.w;
    nums.revenue += convert(rates, amount, t.currency, r.currency);
    nums.orders += t.count;
    if (isY(t.date)) r.revenueRon += convert(rates, amount, t.currency, "RON");
    else r.revenueRonW += convert(rates, amount, t.currency, "RON");
    addAmount(isY(t.date) ? revenueBy : revenueByW, t.currency, amount);
  }
  for (const g of gsc) {
    const r = rows.get(g.projectId)!;
    const nums = isY(g.date) ? r.y : r.w;
    nums.google = (nums.google ?? 0) + g.clicks;
  }
  // Sursa principala de ieri: canalul cu cele mai multe vizite
  const bySource = new Map<string, Map<string, number>>();
  for (const s of sources) {
    const ch = simpleChannelOf(channelOf(s.source, s.medium, s.clickType), s.source);
    const m = bySource.get(s.projectId) ?? new Map<string, number>();
    m.set(ch, (m.get(ch) ?? 0) + s._count._all);
    bySource.set(s.projectId, m);
  }
  for (const [pid, m] of bySource) {
    const top = [...m].sort((a, b) => b[1] - a[1])[0];
    if (top) rows.get(pid)!.topSource = top[0];
  }
  const byName = new Map(projects.map((p) => [p.name.toLowerCase(), p.id]));
  for (const a of alerts) {
    const pid = a.project ? byName.get(a.project.toLowerCase().replace(/\.(ro|com|ai|net|info)$/, "")) ?? byName.get(a.project.toLowerCase()) : undefined;
    if (pid) rows.get(pid)!.alerts.push(a.message);
  }

  for (const [pid, c] of clarity) rows.get(pid)!.clarity = { rageClicks: c.rageClicks, scriptErrors: c.scriptErrors };

  const list = [...rows.values()];
  const sum = (f: (r: ReportProject) => number) => list.reduce((s, r) => s + f(r), 0);
  const total = {
    visitors: sum((r) => r.y.visitors),
    visitorsW: sum((r) => r.w.visitors),
    orders: sum((r) => r.y.orders),
    ordersW: sum((r) => r.w.orders),
    revenue: revenueBy,
    revenueW: revenueByW,
    revenueRon: sum((r) => r.revenueRon),
    revenueRonW: sum((r) => r.revenueRonW),
    google: sum((r) => r.y.google ?? 0),
    // null = Google nu avea inca date in ziua de comparat (site-uri noi in Search Console)
    googleW: list.some((r) => r.w.google !== null) ? sum((r) => r.w.google ?? 0) : null,
  };

  // Cele mai mari 3 schimbari, in propozitii. Doar la volume care conteaza, ca sa nu fie zgomot.
  const vs = LAST_WEEKDAY[weekday];
  type H = { score: number; text: string };
  const hs: H[] = [];
  const change = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev : cur > 0 ? 1 : 0);
  const more = (c: number, p: number, what: string) =>
    p === 0 ? `față de 0 ${vs}` : `cu ${Math.round(Math.abs(change(c, p)) * 100)}% ${c > p ? "mai mulți" : "mai puțini"} ${what}decât ${vs} (${n(p)})`;
  for (const r of list) {
    const v = r.y.visitors,
      vw = r.w.visitors;
    if (Math.max(v, vw) >= 10 && Math.abs(v - vw) >= 5 && Math.abs(change(v, vw)) >= 0.3) {
      hs.push({ score: Math.abs(v - vw), text: `${r.name}: ${deN(v, "vizitatori")} ieri, ${more(v, vw, "")}.` });
    }
    const rv = r.revenueRon,
      rw = r.revenueRonW;
    if (Math.abs(rv - rw) >= 50) {
      const txt =
        rv > rw
          ? `${r.name}: vânzări de ${formatMoney(r.y.revenue, r.currency)} ieri (${deN(r.y.orders, r.y.orders === 1 ? "plată" : "plăți")}), față de ${formatMoney(r.w.revenue, r.currency)} ${vs}.`
          : `${r.name}: vânzările au scăzut la ${formatMoney(r.y.revenue, r.currency)} ieri, față de ${formatMoney(r.w.revenue, r.currency)} ${vs}.`;
      hs.push({ score: Math.abs(rv - rw) / 5, text: txt });
    }
    const g = r.y.google,
      gw = r.w.google;
    if (g !== null && gw !== null && Math.max(g, gw) >= 5 && Math.abs(g - gw) >= 3 && Math.abs(change(g, gw)) >= 0.3) {
      hs.push({
        score: Math.abs(g - gw) * 1.5,
        text: `${r.name}: ${deN(g, g === 1 ? "clic" : "clicuri")} din Google ieri, ${g > gw ? "mai multe" : "mai puține"} decât ${vs} (${n(gw)}).`,
      });
    }
  }
  // Clarity: salt de erori JavaScript sau de clicuri de nervi fata de media ultimelor 7 zile
  for (const r of list) {
    const c = clarity.get(r.id);
    if (!c) continue;
    const spike = (cur: number, avg: number | null, min: number) => cur >= min && (avg === null || cur >= Math.max(2 * avg, avg + min));
    if (spike(c.scriptErrors, c.avgErrors, 10)) {
      hs.push({
        score: c.scriptErrors,
        text: `${r.name}: ${deN(c.scriptErrors, c.scriptErrors === 1 ? "eroare" : "erori")} JavaScript la vizitatori ieri${c.avgErrors !== null ? ` (de obicei ~${n(c.avgErrors)} pe zi)` : ""}. Vezi în Clarity ce pagină le dă.`,
      });
    }
    if (spike(c.rageClicks, c.avgRage, 5)) {
      hs.push({
        score: c.rageClicks,
        text: `${r.name}: ${deN(c.rageClicks, c.rageClicks === 1 ? "clic" : "clicuri")} de nervi ieri${c.avgRage !== null ? ` (de obicei ~${n(c.avgRage)} pe zi)` : ""}: ceva nu răspunde cum se așteaptă oamenii.`,
      });
    }
  }
  // Din aplicatii: facturile neemise intra mereu primele in „Ce s-a schimbat”
  const appResults = await appStatsP;
  const apps: ReportApp[] = [];
  const invoiceHs: string[] = [];
  projects.forEach((p, i) => {
    const res = appResults[i];
    if (!res?.ok) return;
    const app = appForReport(p.name, res.stats, p.currency);
    apps.push(app);
    const missing = unissuedCount(res.stats, app.basis);
    if (missing > 0) invoiceHs.push(`${p.name}: ${missing === 1 ? "1 factură neemisă" : `${deN(missing, "facturi neemise")}`}.`);
  });
  const highlights = [...invoiceHs, ...hs.sort((a, b) => b.score - a.score).slice(0, 3).map((h) => h.text)];

  const label = (d: string) =>
    `${WEEKDAY[dayDate(d).getUTCDay()]}, ${new Date(`${d}T12:00:00Z`).toLocaleDateString("ro-RO", { day: "numeric", month: "long", timeZone: "UTC" })}`;

  return {
    day,
    compareDay,
    dayLabel: label(day),
    compareLabel: label(compareDay),
    projects: list.sort((a, b) => b.revenueRon - a.revenueRon || b.y.visitors - a.y.visitors || a.name.localeCompare(b.name)),
    total,
    highlights,
    activeAlerts: alerts.length,
    apps,
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

function arrow(cur: number, prev: number) {
  if (cur === prev) return `<span style="color:#7c7b76">=</span>`;
  if (prev === 0) return `<span style="color:#0f7b3f">nou</span>`;
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  const up = cur > prev;
  return `<span style="color:${up ? "#0f7b3f" : "#c0362f"}">${up ? "▲" : "▼"} ${Math.abs(pct)}%</span>`;
}

// „Din aplicații – ultimele 24 h”: cateva cifre pe aplicatie, facturile neemise cu rosu
function appsBlock(apps: ReportApp[]): string {
  if (!apps.length) return "";
  const row = (a: ReportApp) => {
    const body = a.kpis
      .map((k) =>
        k.bad ? `<span style="color:#c0362f;font-weight:700">⚠ ${esc(k.label)}: ${esc(k.value)}</span>` : `${esc(k.label)}: <b>${esc(k.value)}</b>`,
      )
      .join("<br>");
    return `<tr><td style="padding:8px 0;border-top:1px solid #e4e3de">
      <div style="font-size:14px;font-weight:700">${esc(a.name)}${a.basis === "azi" ? ` <span style="font-weight:400;font-size:12px;color:#7c7b76">(azi, de la miezul nopții)</span>` : ""}</div>
      <div style="font-size:14px;line-height:1.6;color:#0b0b0b">${body}</div>
    </td></tr>`;
  };
  const busy = apps.filter((a) => a.kpis.length);
  const idle = apps.filter((a) => !a.kpis.length);
  return `<h2 style="font-size:15px;margin:0">Din aplicații – ultimele 24 h</h2>
  ${busy.length ? `<table role="presentation" style="width:100%;border-collapse:collapse">${busy.map(row).join("")}</table>` : ""}
  ${idle.length ? `<p style="font-size:13px;color:#7c7b76;margin:6px 0 0">Nimic nou în aplicațiile: ${idle.map((a) => esc(a.name)).join(", ")}.</p>` : ""}
  <div style="height:14px"></div>`;
}

// E-mail scurt, pe o coloana (se citeste bine pe telefon)
export function renderDailyReport(r: DailyReport, siteUrl = "https://mydashboard.ro"): string {
  const t = r.total;
  const big = (label: string, value: string, a: string, size = 22) =>
    `<td style="padding:8px 6px;vertical-align:top;width:33%"><div style="font-size:12px;color:#52514e">${label}</div><div style="font-size:${size}px;font-weight:700;color:#0b0b0b">${value}</div><div style="font-size:12px">${a}</div></td>`;
  // fiecare moneda pe randul ei (lei, apoi euro), ca sa incapa pe telefon
  const sales = formatAmounts(t.revenue, false)
    .split(/ (?=[+−] )/)
    .map(esc)
    .join("<br>");

  const active = r.projects.filter((p) => p.y.visitors || p.w.visitors || p.y.orders || p.w.orders || p.y.google || p.alerts.length);
  const quiet = r.projects.filter((p) => !active.includes(p));

  const projectBlock = (p: ReportProject) => {
    const bits = [
      `<b>${n(p.y.visitors)}</b> ${p.y.visitors === 1 ? "vizitator" : "vizitatori"} ${arrow(p.y.visitors, p.w.visitors)}`,
      `<b>${n(p.y.orders)}</b> ${p.y.orders === 1 ? "vânzare" : "vânzări"}${p.y.revenue ? ` · <b>${esc(formatMoney(p.y.revenue, p.currency))}</b>` : ""} ${arrow(p.y.revenue, p.w.revenue)}`,
      p.y.google !== null ? `<b>${n(p.y.google)}</b> ${p.y.google === 1 ? "clic" : "clicuri"} din Google ${p.w.google !== null ? arrow(p.y.google, p.w.google) : ""}` : null,
      p.topSource ? `vin mai ales din: ${esc(p.topSource)}` : null,
      p.clarity && (p.clarity.rageClicks || p.clarity.scriptErrors)
        ? `Clarity: ${n(p.clarity.rageClicks)} clicuri de nervi · ${n(p.clarity.scriptErrors)} erori JavaScript`
        : null,
    ].filter(Boolean);
    const alerts = p.alerts.length
      ? `<div style="margin-top:4px;font-size:13px;color:#c0362f">⚠ ${p.alerts.length === 1 ? "1 alertă" : `${p.alerts.length} alerte`}: ${esc(p.alerts[0].slice(0, 140))}</div>`
      : "";
    return `<tr><td style="padding:10px 0;border-top:1px solid #e4e3de">
      <div style="font-size:15px;font-weight:700;margin-bottom:2px">${esc(p.name)}</div>
      <div style="font-size:14px;line-height:1.6;color:#0b0b0b">${bits.join("<br>")}</div>${alerts}
    </td></tr>`;
  };

  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f6f4">
<div style="max-width:560px;margin:0 auto;padding:16px;font-family:Arial,Helvetica,sans-serif;color:#0b0b0b">
  <div style="font-size:13px;color:#7c7b76">Raportul de dimineață</div>
  <h1 style="margin:2px 0 4px;font-size:20px">Ieri, ${esc(r.dayLabel)}</h1>
  <div style="font-size:13px;color:#52514e;margin-bottom:12px">Comparat cu ${esc(r.compareLabel)}</div>

  <table role="presentation" style="width:100%;border-collapse:collapse;background:#fcfcfb;border:1px solid #e4e3de;border-radius:10px">
    <tr>${big("Vânzări", sales, arrow(t.revenueRon, t.revenueRonW), currencyCount(t.revenue) > 1 ? 17 : 22)}${big("Vizitatori", n(t.visitors), arrow(t.visitors, t.visitorsW))}${big("Clicuri Google", n(t.google), t.googleW === null ? "" : arrow(t.google, t.googleW))}</tr>
  </table>
  <div style="font-size:12px;color:#7c7b76;margin:4px 0 14px">${deN(t.orders, t.orders === 1 ? "plată" : "plăți")} · toate proiectele, fiecare sumă în moneda ei${r.activeAlerts ? ` · <a href="${siteUrl}/dashboard/alerte" style="color:#c0362f">${r.activeAlerts === 1 ? "1 alertă activă" : `${r.activeAlerts} alerte active`}</a>` : ""}</div>

  <h2 style="font-size:15px;margin:0 0 6px">Ce s-a schimbat</h2>
  ${
    r.highlights.length
      ? `<ol style="margin:0 0 14px;padding-left:20px;font-size:14px;line-height:1.5">${r.highlights.map((h) => `<li style="margin-bottom:4px">${esc(h)}</li>`).join("")}</ol>`
      : `<p style="margin:0 0 14px;font-size:14px;color:#52514e">Nicio schimbare mare față de ${esc(r.compareLabel)}.</p>`
  }

  ${appsBlock(r.apps)}

  <h2 style="font-size:15px;margin:0">Pe proiect</h2>
  <table role="presentation" style="width:100%;border-collapse:collapse">${active.map(projectBlock).join("")}</table>
  ${quiet.length ? `<p style="font-size:13px;color:#7c7b76;margin:8px 0 0">Fără vizite și vânzări ieri: ${quiet.map((p) => esc(p.name)).join(", ")}.</p>` : ""}

  <p style="margin:18px 0 0"><a href="${siteUrl}/dashboard" style="display:inline-block;background:#2a78d6;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px">Deschide mydashboard</a></p>
  <p style="font-size:11px;color:#7c7b76;margin-top:14px">Clicurile din Google de ieri pot crește puțin până se finalizează datele (1–2 zile). Vizitatorii vin din tracking-ul propriu.</p>
</div></body></html>`;
}

export function reportSubject(r: DailyReport) {
  const t = r.total;
  return `Ieri: ${formatAmounts(t.revenue, false)} din ${deN(t.orders, t.orders === 1 ? "vânzare" : "vânzări")}, ${deN(t.visitors, t.visitors === 1 ? "vizitator" : "vizitatori")}`;
}
