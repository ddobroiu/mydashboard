import crypto from "crypto";
import { clipIdFromName, matchesProject } from "./meta";
import type { AdSpendRow } from "./types";

// Google Ads nu e citit de noi (API-ul cere developer token aprobat de Google):
// un script rulat in contul de reclame (Instrumente → Scripturi) ne trimite singur
// cheltuiala pe campanie pe zi, la /api/ingest/google-ads. Cheia scriptului e
// „<connectionId>.<secret>”; secretul sta criptat in conexiune.
// project: cont comun mai multor proiecte; doar campaniile cu „[project]” in nume.
export type GoogleAdsCredentials = { scriptSecret: string; project?: string };

export const newScriptSecret = () => crypto.randomBytes(24).toString("base64url");

export function parseScriptKey(key: unknown) {
  if (typeof key !== "string") return null;
  const [connectionId, secret] = key.split(".");
  return connectionId && secret ? { connectionId, secret } : null;
}

export function secretMatches(expected: string, given: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type PushedRow = {
  date?: unknown;
  campaignId?: unknown;
  campaignName?: unknown;
  spend?: unknown;
  impressions?: unknown;
  clicks?: unknown;
  conversions?: unknown;
  conversionValue?: unknown;
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Randurile trimise de script, validate si filtrate pe proiect
export function toAdSpendRows(rows: PushedRow[], currency: string, project?: string): AdSpendRow[] {
  return rows
    .filter((r) => typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.campaignId != null)
    .map((r) => ({
      date: r.date as string,
      campaignId: String(r.campaignId),
      campaignName: String(r.campaignName ?? r.campaignId),
      clipId: clipIdFromName(String(r.campaignName ?? "")),
      currency,
      spend: n(r.spend),
      impressions: Math.round(n(r.impressions)),
      clicks: Math.round(n(r.clicks)),
      conversions: n(r.conversions),
      conversionValue: n(r.conversionValue),
    }))
    .filter((r) => matchesProject(r.campaignName, project));
}

// Scriptul lipit in Google Ads → Instrumente → Actiuni in bloc → Scripturi.
// Trimite ultimele 30 de zile la fiecare rulare (Google recalculeaza costurile cateva zile).
export function googleAdsScript(endpoint: string, key: string) {
  return `// mydashboard: trimite cheltuiala pe campanie pe zi. Programeaza-l „Din ora in ora”.
var ENDPOINT = '${endpoint}';
var KEY = '${key}';
var DAYS = 30;

function main() {
  var account = AdsApp.currentAccount();
  var tz = account.getTimeZone();
  var day = function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };
  var until = day(new Date());
  var since = day(new Date(Date.now() - (DAYS - 1) * 86400000));

  var it = AdsApp.search(
    'SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.impressions, ' +
    'metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign ' +
    "WHERE segments.date BETWEEN '" + since + "' AND '" + until + "'"
  );
  var rows = [];
  while (it.hasNext()) {
    var r = it.next();
    rows.push({
      date: r.segments.date,
      campaignId: String(r.campaign.id),
      campaignName: r.campaign.name,
      spend: Number(r.metrics.costMicros || 0) / 1e6,
      impressions: Number(r.metrics.impressions || 0),
      clicks: Number(r.metrics.clicks || 0),
      conversions: Number(r.metrics.conversions || 0),
      conversionValue: Number(r.metrics.conversionsValue || 0)
    });
  }

  var res = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      key: KEY,
      customerId: account.getCustomerId(),
      accountName: account.getName(),
      currency: account.getCurrencyCode(),
      since: since,
      until: until,
      rows: rows
    })
  });
  Logger.log(res.getResponseCode() + ' ' + res.getContentText());
  if (res.getResponseCode() !== 200) throw new Error('mydashboard: ' + res.getContentText());
}
`;
}
