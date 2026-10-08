import type { Provider } from "@prisma/client";

// Erorile conexiunilor (Stripe, Meta, Oblio...) spuse pe intelesul proprietarului: ce s-a intamplat + ce face.
// Textul tehnic ramane doar in „Detalii tehnice”.

const NAMES: Partial<Record<Provider, string>> = {
  STRIPE: "Stripe (plățile cu cardul)",
  META: "Meta (reclamele Facebook / Instagram)",
  GOOGLE_ADS: "Google Ads",
  OBLIO: "Oblio (facturile)",
  POSTINGCLIPS: "PostingClips",
  REPLICATE: "Replicate (costul AI)",
  ORDERS_DB: "comenzile ramburs / transfer",
  CLARITY: "Microsoft Clarity",
  ANTHROPIC_ADMIN: "Anthropic (costul AI)",
  OPENAI_ADMIN: "OpenAI (costul AI)",
};

export const plainProvider = (p: Provider) => NAMES[p] ?? p;

export function plainConnectionError(provider: Provider, error: string | null | undefined): { what: string; action: string } {
  const who = plainProvider(provider);
  const m = String(error ?? "");
  if (/invalid api key|expired|401|unauthori[sz]ed|invalid.*token|token.*(invalid|expired)|session has expired|OAuthException/i.test(m)) {
    return {
      what: `Cheia de acces la ${who} nu mai merge (a expirat sau a fost schimbată).`,
      action: "Pune o cheie nouă: Setări → proiectul → Conexiuni.",
    };
  }
  if (/permission|forbidden|403|not allowed|does not have access/i.test(m)) {
    return { what: `Cheia de la ${who} nu are voie să citească datele de care avem nevoie.`, action: "Fă o cheie nouă cu dreptul de citire și pune-o în Setări → proiectul → Conexiuni." };
  }
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed|503|502|504|rate limit|429/i.test(m)) {
    return { what: `${who} nu a răspuns ultima dată când am cerut cifrele.`, action: "De obicei se rezolvă singur. Dacă ține mai mult de o zi, spune-i programatorului." };
  }
  return { what: `Nu am putut citi datele din ${who}.`, action: "Cifrele pot fi incomplete. Trimite-i programatorului detaliile tehnice." };
}
