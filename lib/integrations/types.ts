import type { Provider } from "@prisma/client";

export type AdSpendRow = {
  date: string;
  campaignId: string;
  campaignName: string;
  currency: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
};

export type TransactionRow = {
  externalId: string;
  occurredAt: Date;
  date: string;
  currency: string;
  amount: number;
  customer: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  clickId: string | null;
  visitorId: string | null;
  site?: string | null;
};

export type SocialPostRow = {
  externalId: string;
  status: string;
  platform: string;
  account: string;
  campaignName: string;
  caption: string | null;
  url: string | null;
  error: string | null;
  scheduledAt: Date;
  publishedAt: Date | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
  metricsAt: Date | null;
};

export type ProviderInfo = {
  provider: Provider;
  name: string;
  kind: "ads" | "revenue" | "social" | "costs";
  available: boolean;
  externalIdLabel?: string;
  externalIdHint?: string;
  // type: secret (implicit, camp ascuns), text sau checkbox (optional, "1" cand e bifat)
  fields: { key: string; label: string; hint?: string; type?: "secret" | "text" | "checkbox" }[];
};

export const PROVIDERS: ProviderInfo[] = [
  {
    provider: "STRIPE",
    name: "Stripe",
    kind: "revenue",
    available: true,
    fields: [
      {
        key: "secretKey",
        label: "Restricted key (rk_live_...)",
        hint: "Stripe → Developers → API keys → Create restricted key, doar Read pe Charges, PaymentIntents și Checkout Sessions",
      },
      {
        key: "project",
        label: "Eticheta proiectului în Stripe (opțional)",
        type: "text",
        hint: "Când un cont Stripe e folosit de mai multe site-uri: eticheta pusă de site pe plăți (ex. 3dview), sau grupul (ex. print, pentru toate site-urile de print). Gol = toate plățile contului.",
      },
      {
        key: "includeUntagged",
        label: "Include și plățile vechi fără etichetă",
        type: "checkbox",
        hint: "Plățile făcute înainte ca site-urile să-și pună eticheta. Bifează doar la proiectul căruia îi aparțin (ex. print).",
      },
    ],
  },
  {
    provider: "META",
    name: "Meta Ads",
    kind: "ads",
    available: true,
    externalIdLabel: "Ad account ID",
    externalIdHint: "act_1234567890 (în Ads Manager, lângă numele contului)",
    fields: [
      {
        key: "accessToken",
        label: "System User access token",
        hint: "Business Settings → System users → Generate token, cu permisiunea ads_read",
      },
    ],
  },
  {
    provider: "POSTINGCLIPS",
    name: "PostingClips",
    kind: "social",
    available: true,
    fields: [
      {
        key: "apiKey",
        label: "Cheie API (pc_live_...)",
        hint: "PostingClips → Conturi → Chei API → Creează cheie. Poți limita cheia la brandul acestui proiect.",
      },
    ],
  },
  {
    provider: "REPLICATE",
    name: "Replicate (cost AI)",
    kind: "costs",
    available: true,
    fields: [
      { key: "apiToken", label: "API token (r8_...)", hint: "replicate.com → Account settings → API tokens" },
      {
        key: "models",
        label: "Modelele acestui proiect (opțional)",
        type: "text",
        hint: "Ex. firtoz/trellis, tencent/hunyuan3d-2mv, black-forest-labs/flux-1.1-pro. Gol = toate rulările contului. Completează dacă același cont Replicate e folosit și de alte proiecte.",
      },
    ],
  },
  { provider: "GOOGLE_ADS", name: "Google Ads", kind: "ads", available: false, fields: [] },
  { provider: "TIKTOK", name: "TikTok Ads", kind: "ads", available: false, fields: [] },
  {
    provider: "OBLIO",
    name: "Oblio",
    kind: "revenue",
    available: true,
    externalIdLabel: "CIF firmă",
    externalIdHint: "CIF-ul firmei din Oblio, fără RO (același la toate proiectele firmei)",
    fields: [
      { key: "email", label: "Email cont Oblio", type: "text" },
      { key: "apiSecret", label: "Cheie API Oblio", hint: "Oblio → Setări → Date cont → API secret" },
      {
        key: "series",
        label: "Seria de facturare a proiectului",
        type: "text",
        hint: "Ex. 3DV. Fiecare proiect are seria lui, ca să vezi facturile pe proiect (Oblio → Setări → Serii documente).",
      },
      {
        key: "asRevenue",
        label: "Adaugă facturile la încasări",
        type: "checkbox",
        hint: "Doar dacă proiectul NU are Stripe conectat (ramburs, transfer); altfel banii s-ar număra de două ori.",
      },
    ],
  },
];

export const providerName = (p: Provider) =>
  p === "MANUAL" ? "Cheltuieli manuale" : (PROVIDERS.find((x) => x.provider === p)?.name ?? p);
