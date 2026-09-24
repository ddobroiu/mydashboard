import { dayDate } from "@/lib/dates";

// Oblio: email-ul contului + cheia API (Setari → Date cont), CIF-ul firmei si
// seria de facturare a proiectului. Acelasi cont poate fi conectat la mai
// multe proiecte, fiecare cu seria lui.
export type OblioCredentials = {
  email: string;
  apiSecret: string;
  // Seria de facturare a proiectului (ex. 3DV)
  series: string;
  // "1" = facturile intra si la incasari (doar pentru proiecte fara Stripe)
  asRevenue?: string;
};

export type InvoiceRow = {
  externalId: string;
  series: string;
  number: string;
  issueDate: Date;
  dueDate: Date | null;
  total: number;
  currency: string;
  canceled: boolean;
  clientName: string | null;
  clientCif: string | null;
  clientEmail: string | null;
  link: string | null;
  einvoiceStatus: string | null;
};

const BASE = "https://www.oblio.eu/api";

type OblioInvoice = {
  id: string | number;
  seriesName: string;
  number: string | number;
  issueDate: string;
  dueDate?: string | null;
  total: string | number;
  currency?: string;
  draft?: string | number;
  canceled?: string | number;
  link?: string;
  einvoiceStatus?: { text?: string } | null;
  client?: { name?: string; cif?: string; email?: string } | null;
};

async function token(c: OblioCredentials): Promise<string> {
  const res = await fetch(`${BASE}/authorize/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.email, client_secret: c.apiSecret }),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Oblio: autentificare esuata (${body.statusMessage ?? res.statusText}). Verifica emailul si cheia API.`);
  }
  return body.access_token as string;
}

async function list(c: OblioCredentials, params: Record<string, string>): Promise<OblioInvoice[]> {
  const auth = await token(c);
  const out: OblioInvoice[] = [];
  for (let offset = 0; offset < 20000; offset += 100) {
    const q = new URLSearchParams({ ...params, limitPerPage: "100", offset: String(offset), orderBy: "issueDate", orderDir: "ASC" });
    const res = await fetch(`${BASE}/docs/invoice/list?${q}`, { headers: { authorization: `Bearer ${auth}` }, cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Oblio: ${body.statusMessage ?? res.statusText}`);
    const page: OblioInvoice[] = Array.isArray(body.data) ? body.data : [];
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

// Verifica datele si intoarce cate facturi are seria in ultimul an (pentru eticheta conexiunii)
export async function testOblio(c: OblioCredentials, cif: string) {
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const rows = await list(c, { cif, seriesName: c.series, issuedAfter: since, draft: "0" });
  return { count: rows.length };
}

export async function fetchOblioInvoices(c: OblioCredentials, cif: string, since: string, until: string): Promise<InvoiceRow[]> {
  const rows = await list(c, { cif, seriesName: c.series, issuedAfter: since, issuedBefore: until, draft: "0", canceled: "-1" });
  return rows.map((r) => ({
    externalId: String(r.id),
    series: r.seriesName,
    number: String(r.number),
    issueDate: dayDate(r.issueDate.slice(0, 10)),
    dueDate: r.dueDate ? dayDate(r.dueDate.slice(0, 10)) : null,
    total: Number(r.total) || 0,
    currency: (r.currency || "RON").toUpperCase(),
    canceled: String(r.canceled) === "1",
    clientName: r.client?.name || null,
    clientCif: r.client?.cif || null,
    clientEmail: r.client?.email || null,
    link: r.link || null,
    einvoiceStatus: r.einvoiceStatus?.text || null,
  }));
}
