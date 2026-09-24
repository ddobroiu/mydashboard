// De unde vine o vizita: din parametrii UTM, din codul de click al reclamei
// (gclid/fbclid/ttclid) sau din site-ul de pe care a venit (referrer).
// Aceleasi reguli ca Google Analytics, ca cifrele sa fie comparabile.

export type Attribution = {
  source: string;
  medium: string;
  campaign: string | null;
  content: string | null;
  term: string | null;
  clickType: string | null;
  referrerHost: string | null;
};

const SEARCH: Record<string, string> = {
  google: "google",
  bing: "bing",
  "duckduckgo.com": "duckduckgo",
  "yahoo.com": "yahoo",
  "yandex": "yandex",
  "ecosia.org": "ecosia",
  "search.brave.com": "brave",
};

const SOCIAL: Record<string, string> = {
  "facebook.com": "facebook",
  "fb.com": "facebook",
  "fb.me": "facebook",
  "messenger.com": "facebook",
  "instagram.com": "instagram",
  "tiktok.com": "tiktok",
  "youtube.com": "youtube",
  "youtu.be": "youtube",
  "linkedin.com": "linkedin",
  "lnkd.in": "linkedin",
  "t.co": "twitter",
  "twitter.com": "twitter",
  "x.com": "twitter",
  "pinterest.com": "pinterest",
  "reddit.com": "reddit",
  "threads.net": "threads",
  "snapchat.com": "snapchat",
  "bsky.app": "bluesky",
  "whatsapp.com": "whatsapp",
  "wa.me": "whatsapp",
  "t.me": "telegram",
};

// Procesatorii de plati: cine se intoarce de la ei nu e o vizita noua
export const PAYMENT_HOSTS = [
  "stripe.com",
  "paypal.com",
  "netopia-payments.com",
  "mobilpay.ro",
  "euplatesc.ro",
  "payu.ro",
  "revolut.com",
  "klarna.com",
];

const PAID_MEDIUMS = new Set(["cpc", "ppc", "paid", "paidsocial", "paid_social", "paid-social", "ads", "cpm", "display"]);

function matchHost(host: string, table: Record<string, string>): string | null {
  for (const [key, name] of Object.entries(table)) {
    if (key.includes(".")) {
      if (host === key || host.endsWith(`.${key}`)) return name;
    } else if (host.split(".").includes(key)) {
      return name;
    }
  }
  return null;
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

const clean = (v: string | null, max = 150) => (v ? v.trim().slice(0, max) || null : null);

export function attribute(pageUrl: string, referrer: string | null): Attribution {
  let params = new URLSearchParams();
  try {
    params = new URL(pageUrl).searchParams;
  } catch {}
  const refHost = hostOf(referrer);
  const pageHost = hostOf(pageUrl);
  const referrerHost = refHost && refHost !== pageHost ? refHost : null;

  const clickType = params.get("gclid") || params.get("gbraid") || params.get("wbraid")
    ? "gclid"
    : params.get("fbclid")
      ? "fbclid"
      : params.get("ttclid")
        ? "ttclid"
        : null;

  const base = {
    campaign: clean(params.get("utm_campaign")),
    content: clean(params.get("utm_content")),
    term: clean(params.get("utm_term")),
    clickType,
    referrerHost,
  };

  const utmSource = clean(params.get("utm_source"), 80)?.toLowerCase();
  if (utmSource) {
    return { ...base, source: utmSource, medium: clean(params.get("utm_medium"), 80)?.toLowerCase() ?? "(not set)" };
  }
  if (clickType === "gclid") return { ...base, source: "google", medium: "cpc" };
  if (clickType === "ttclid") return { ...base, source: "tiktok", medium: "cpc" };

  if (referrerHost) {
    const search = matchHost(referrerHost, SEARCH);
    if (search) return { ...base, source: search, medium: "organic" };
    const social = matchHost(referrerHost, SOCIAL);
    if (social) return { ...base, source: social, medium: "social" };
    return { ...base, source: referrerHost, medium: "referral" };
  }
  // fbclid fara referrer (aplicatia Facebook/Instagram nu trimite mereu referrer)
  if (clickType === "fbclid") return { ...base, source: "facebook", medium: "social" };
  return { ...base, source: "(direct)", medium: "(none)" };
}

// Canalul, pentru raportul pe scurt: unde se duc banii si ce aduce fiecare.
export type Channel =
  | "Meta Ads"
  | "Google Ads"
  | "TikTok Ads"
  | "Alte reclame"
  | "Social organic"
  | "Căutare organică"
  | "Email"
  | "Alte site-uri"
  | "Direct";

const META_SOURCES = new Set(["facebook", "instagram", "fb", "ig", "meta", "messenger", "msg", "an", "audience_network"]);

export function channelOf(source: string, medium: string, clickType: string | null): Channel {
  const paid = PAID_MEDIUMS.has(medium) || clickType === "gclid" || clickType === "ttclid";
  if (paid) {
    if (META_SOURCES.has(source)) return "Meta Ads";
    if (source === "google" || source === "youtube" || clickType === "gclid") return "Google Ads";
    if (source === "tiktok" || clickType === "ttclid") return "TikTok Ads";
    return "Alte reclame";
  }
  if (medium === "email" || medium === "newsletter") return "Email";
  if (medium === "organic") return "Căutare organică";
  if (medium === "social" || medium === "social-organic" || Object.values(SOCIAL).includes(source) || META_SOURCES.has(source)) {
    return "Social organic";
  }
  if (source === "(direct)") return "Direct";
  return "Alte site-uri";
}

export function deviceOf(ua: string): string {
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return "tabletă";
  if (/Mobi|iPhone|iPod|Android|BlackBerry|Opera Mini|IEMobile/i.test(ua)) return "mobil";
  return "desktop";
}

export const isBot = (ua: string) =>
  !ua || /bot|crawler|spider|crawling|headless|lighthouse|preview|facebookexternalhit|slurp|bingpreview|monitor|curl|wget|python|axios|node-fetch/i.test(ua);
