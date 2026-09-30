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
  einvoiceCode: number | null;
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
  einvoiceStatus?: { text?: string; code?: number | string } | null;
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

// Oblio da acelasi token cat e valabil (1 ora), deci unul cerut in ultimele secunde expira imediat:
// la 401 cerem altul dupa o scurta pauza si reincercam o singura data
const isExpired = (status: number, body: { statusMessage?: string }) => status !== 200 && /expired/i.test(body.statusMessage ?? "");

async function list(c: OblioCredentials, params: Record<string, string>): Promise<OblioInvoice[]> {
  let auth = await token(c);
  const out: OblioInvoice[] = [];
  for (let offset = 0; offset < 20000; offset += 100) {
    const q = new URLSearchParams({ ...params, limitPerPage: "100", offset: String(offset), orderBy: "issueDate", orderDir: "ASC" });
    const get = () => fetch(`${BASE}/docs/invoice/list?${q}`, { headers: { authorization: `Bearer ${auth}` }, cache: "no-store" });
    let res = await get();
    let body = await res.json().catch(() => ({}));
    if (isExpired(res.status, body)) {
      await new Promise((r) => setTimeout(r, 5000));
      auth = await token(c);
      res = await get();
      body = await res.json().catch(() => ({}));
    }
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
  const rows = await list(c, { cif, seriesName: c.series, issuedAfter: since, issuedBefore: until, draft: "0", canceled: "-1", withEinvoiceStatus: "1" });
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
    einvoiceCode: r.einvoiceStatus?.code === undefined || r.einvoiceStatus?.code === null ? null : Number(r.einvoiceStatus.code),
  }));
}

// Trimite o factura in SPV (e-Factura) prin Oblio. Raspunsul are text + cod (vezi einvoiceCode).
export async function sendOblioEinvoice(c: OblioCredentials, cif: string, series: string, number: string) {
  const auth = await token(c);
  const res = await fetch(`${BASE}/docs/einvoice`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
    body: JSON.stringify({ cif, seriesName: series, number }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { status?: number; statusMessage?: string; data?: { text?: string; code?: number | string } };
  if (!res.ok || (body.status && body.status !== 200)) {
    throw new Error(body.statusMessage || `Oblio a raspuns ${res.status}`);
  }
  return { text: body.data?.text ?? "Trimisa", code: body.data?.code === undefined ? 0 : Number(body.data.code) };
}
