import Stripe from "stripe";
import { dayKey, dayDate, addDays } from "@/lib/dates";
import type { TransactionRow } from "./types";

// project: daca e setat, doar platile cu metadata.project sau metadata.group = project (cont Stripe comun
// mai multor site-uri; ex. "3dview" sau "print" pentru tot grupul de site-uri de print).
// includeUntagged: "1" = si platile vechi, facute inainte ca site-urile sa-si puna eticheta.
export type StripeCredentials = { secretKey: string; project?: string; includeUntagged?: string };

const client = (c: StripeCredentials) => new Stripe(c.secretKey);

export async function testStripe(c: StripeCredentials) {
  await client(c).charges.list({ limit: 1 });
}

const ZERO_DECIMAL = new Set(["jpy", "krw", "vnd", "clp", "pyg", "ugx", "xaf", "xof"]);

const VISITOR_ID = /^[a-f0-9]{32}$/;

// Din Checkout Session luam:
//  - vizitatorul: linkurile de plata Stripe (buy.stripe.com) primesc de la scriptul nostru
//    client_reference_id = ID-ul vizitatorului
//  - metadata sesiunii: platile mai vechi au eticheta site-ului (source) doar pe sesiune, nu si pe plata
// Cheile vechi fara drept pe Checkout Sessions merg mai departe, doar fara legatura.
async function sessionsByPaymentIntent(c: StripeCredentials, gte: number, lt: number) {
  const map = new Map<string, { vid: string | null; meta: Record<string, string> }>();
  try {
    for await (const s of client(c).checkout.sessions.list({ created: { gte, lt }, limit: 100 })) {
      const vid = s.client_reference_id ?? s.metadata?.md_vid;
      const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
      if (pi) map.set(pi, { vid: vid && VISITOR_ID.test(vid) ? vid : null, meta: s.metadata ?? {} });
    }
  } catch (e) {
    if (!(e instanceof Stripe.errors.StripePermissionError)) throw e;
  }
  return map;
}

// "tablou.net" -> "tablou"
const siteOfDomain = (d: string) => d.toLowerCase().replace(/^www\./, "").split(".")[0] || null;

export async function fetchStripeTransactions(c: StripeCredentials, since: string, until: string): Promise<TransactionRow[]> {
  const rows: TransactionRow[] = [];
  // Marja de o zi in fiecare parte pentru fusul orar; filtram exact pe zi mai jos.
  const gte = Math.floor(dayDate(addDays(since, -1)).getTime() / 1000);
  const lt = Math.floor(dayDate(addDays(until, 2)).getTime() / 1000);
  const sessions = await sessionsByPaymentIntent(c, gte, lt);
  const wanted = c.project?.toLowerCase();

  for await (const ch of client(c).charges.list({
    created: { gte, lt },
    limit: 100,
    expand: ["data.payment_intent"],
  })) {
    if (ch.status !== "succeeded" || !ch.paid) continue;
    const occurredAt = new Date(ch.created * 1000);
    const date = dayKey(occurredAt);
    if (date < since || date > until) continue;

    const divisor = ZERO_DECIMAL.has(ch.currency) ? 1 : 100;
    const pi = typeof ch.payment_intent === "object" ? ch.payment_intent : null;
    const session = pi ? sessions.get(pi.id) : undefined;
    const meta: Record<string, string> = { ...(session?.meta ?? {}), ...(pi?.metadata ?? {}), ...ch.metadata };
    if (wanted) {
      const tagged = Boolean(meta.project || meta.group);
      const match = meta.project === wanted || meta.group === wanted;
      if (!match && (tagged || c.includeUntagged !== "1")) continue;
    }

    rows.push({
      externalId: ch.id,
      occurredAt,
      date,
      currency: ch.currency.toUpperCase(),
      amount: (ch.amount - ch.amount_refunded) / divisor,
      customer: ch.billing_details?.email ?? ch.receipt_email ?? null,
      utmSource: meta.utm_source ?? null,
      utmCampaign: meta.utm_campaign ?? null,
      clickId: meta.gclid ?? meta.fbclid ?? meta.ttclid ?? null,
      visitorId: (meta.md_vid && VISITOR_ID.test(meta.md_vid) ? meta.md_vid : null) ?? session?.vid ?? null,
      site: meta.project ?? (meta.source ? siteOfDomain(meta.source) : null),
    });
  }
  return rows;
}
