import type { AdSpendRow } from "./types";

// project: cont de reclame comun mai multor proiecte; doar campaniile cu „[project]” in nume
export type MetaCredentials = { accessToken: string; project?: string };

// Campaniile care promoveaza un clip PostingClips au in nume „clip:<videoId>”
// (le pune butonul „Fă reclamă”; se poate scrie si de mana in Ads Manager).
export function clipIdFromName(name: string) {
  return name.match(/clip:([a-z0-9]{8,})/i)?.[1] ?? null;
}

export function matchesProject(name: string, project?: string) {
  const tag = project?.trim().toLowerCase();
  return !tag || name.toLowerCase().includes(`[${tag}]`);
}

const VERSION = process.env.META_API_VERSION || "v23.0";
const BASE = `https://graph.facebook.com/${VERSION}`;

// Un singur tip de achizitie, ca sa nu numaram de doua ori (omni_purchase le include pe celelalte).
const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];

type ActionStat = { action_type: string; value: string };
type InsightRow = {
  date_start: string;
  campaign_id: string;
  campaign_name: string;
  account_currency: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: ActionStat[];
  action_values?: ActionStat[];
};

async function graph<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json();
  if (!res.ok || body.error) {
    throw new Error(`Meta API: ${body.error?.message ?? res.statusText}`);
  }
  return body as T;
}

export function normalizeAccountId(id: string) {
  const clean = id.trim();
  return clean.startsWith("act_") ? clean : `act_${clean}`;
}

function pickPurchase(stats?: ActionStat[]) {
  if (!stats) return 0;
  for (const type of PURCHASE_TYPES) {
    const hit = stats.find((s) => s.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

export async function testMeta(c: MetaCredentials, accountId: string) {
  const params = new URLSearchParams({ fields: "name,currency,account_status", access_token: c.accessToken });
  return graph<{ name: string; currency: string; account_status: number }>(
    `${BASE}/${normalizeAccountId(accountId)}?${params}`,
  );
}

export async function fetchMetaSpend(c: MetaCredentials, accountId: string, since: string, until: string): Promise<AdSpendRow[]> {
  const params = new URLSearchParams({
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "campaign_id,campaign_name,account_currency,spend,impressions,clicks,actions,action_values",
    limit: "500",
    access_token: c.accessToken,
  });

  const rows: AdSpendRow[] = [];
  let url: string | undefined = `${BASE}/${normalizeAccountId(accountId)}/insights?${params}`;
  while (url) {
    const page: { data: InsightRow[]; paging?: { next?: string } } = await graph(url);
    for (const r of page.data) {
      if (!matchesProject(r.campaign_name, c.project)) continue;
      rows.push({
        date: r.date_start,
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        clipId: clipIdFromName(r.campaign_name),
        currency: r.account_currency,
        spend: Number(r.spend ?? 0),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        conversions: pickPurchase(r.actions),
        conversionValue: pickPurchase(r.action_values),
      });
    }
    url = page.paging?.next;
  }
  return rows;
}
