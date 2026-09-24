import { Pool } from "pg";
import { dayKey } from "@/lib/dates";
import type { TransactionRow } from "./types";

// Comenzi platite altfel decat cu cardul (ramburs, transfer bancar), citite direct din baza de date
// a magazinului, cu un utilizator doar de citire. Platile cu cardul vin din Stripe, deci aici
// se iau doar celelalte metode, ca nimic sa nu se numere de doua ori.
export type OrdersDbCredentials = {
  connectionString: string;
  // Metodele de plata incluse, separate prin virgula (implicit: Ramburs, OP)
  methods?: string;
  currency?: string;
};

const methodsOf = (c: OrdersDbCredentials) =>
  (c.methods || "Ramburs, OP").split(",").map((m) => m.trim()).filter(Boolean);

// "tablou.net" -> "tablou", ca eticheta pusa de site pe platile Stripe
const siteOf = (source: string | null) => (source ? source.toLowerCase().replace(/^www\./, "").split(".")[0] : null);

async function query<T>(c: OrdersDbCredentials, sql: string, params: unknown[]): Promise<T[]> {
  const pool = new Pool({ connectionString: c.connectionString, max: 1 });
  try {
    return (await pool.query(sql, params)).rows as T[];
  } finally {
    await pool.end();
  }
}

export async function testOrdersDb(c: OrdersDbCredentials) {
  const rows = await query<{ n: string }>(
    c,
    `select count(*) as n from "Order" where "paymentMethod" = any($1) and "canceledAt" is null`,
    [methodsOf(c)],
  );
  return { count: Number(rows[0]?.n ?? 0) };
}

export async function fetchDbOrders(c: OrdersDbCredentials, since: string, until: string): Promise<TransactionRow[]> {
  const rows = await query<{ orderNo: number; createdAt: Date; totalAmount: string; source: string | null; email: string | null }>(
    c,
    `select "orderNo", "createdAt", "totalAmount", source, "shippingAddress"->>'email' as email
       from "Order"
      where "paymentMethod" = any($1) and "canceledAt" is null and status not in ('canceled', 'cancelled')
        and "createdAt" >= $2::date - 1 and "createdAt" < $3::date + 2`,
    [methodsOf(c), since, until],
  );
  return rows
    .map((r) => {
      const occurredAt = new Date(r.createdAt);
      return {
        externalId: `order-${r.orderNo}`,
        occurredAt,
        date: dayKey(occurredAt),
        currency: (c.currency || "RON").toUpperCase(),
        amount: Number(r.totalAmount),
        customer: r.email,
        utmSource: null,
        utmCampaign: null,
        clickId: null,
        visitorId: null,
        site: siteOf(r.source),
      };
    })
    .filter((r) => r.date >= since && r.date <= until);
}
