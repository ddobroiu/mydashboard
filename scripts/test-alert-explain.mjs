// Testele pentru explicatiile alertelor (lib/alert-explain.ts), fara baza de date si fara AI.
//   npm test    (= node --test scripts/test-alert-explain.mjs; Node 22.18+ citeste .ts direct)
import { test } from "node:test";
import assert from "node:assert/strict";
import { alertSubject, explainAlert, explanationLines, isLocalDevAlert, scrubSecrets } from "../lib/alert-explain.ts";

const show = (project, e) =>
  `${alertSubject(project, e)}${e.local ? " — test local, ignorat" : ""}\n` + explanationLines(e).map(([k, v]) => `  ${k}: ${v}`).join("\n");

const CASES = [
  {
    project: "BazaDate",
    message: "oferte: jobul orar a eșuat: permission denied for table bz_contact_google — rulează `node scripts/remote-db.mjs grants`",
    check: (e) => {
      assert.equal(e.source, "reguli");
      assert.equal(e.severity, "Important");
      assert.match(e.what, /drepturile de acces/);
      assert.match(e.customers, /^Nu/);
      assert.match(e.action, /Programatorul/);
      assert.ok(!e.local);
    },
  },
  {
    project: "PostingClips",
    message:
      "GET /[locale]/dashboard/billing/invoices (render): Cannot read properties of undefined (reading 'findUnique') [digest 361496628] at InvoicesPage (C:\\Users\\dev\\postingclips\\.next\\dev\\server\\app\\page.js:12:3)",
    check: (e, p) => {
      assert.equal(e.title, "pagina de facturi nu se deschide");
      assert.equal(alertSubject(p, e), "PostingClips: pagina de facturi nu se deschide (Important)");
      assert.match(e.what, /nu se mai potrivesc/);
      assert.equal(e.local, true); // C:\Users\ + .next\dev = calculatorul programatorului
    },
  },
  {
    project: "Tiparementale",
    message:
      "GET /ghiduri/[slug]/opengraph-image (route): ENOENT: no such file or directory, open '/app/assets/fonts/PlusJakartaSans-SemiBold.ttf' at async Object.openSync",
    check: (e) => {
      assert.equal(e.severity, "Mic");
      assert.match(e.customers, /Facebook/);
      assert.match(e.title, /ghid/);
      assert.ok(!e.local);
    },
  },
  {
    project: "BazaDate",
    message:
      "GET /judet/[judet] (render): Invalid `prisma.$queryRawUnsafe()` invocation: Raw query failed. Code: `53100`. Message: `could not resize shared memory segment \"/PostgreSQL.123\" to 1048576 bytes: No space left on device`",
    check: (e) => {
      assert.equal(e.severity, "Urgent");
      assert.match(e.what, /memorie temporară/);
      assert.match(e.customers, /paginile de județ/);
    },
  },
];

for (const c of CASES) {
  test(c.message.slice(0, 60), () => {
    const e = explainAlert({ kind: "error", project: c.project, message: c.message });
    console.log(`\n${show(c.project, e)}`);
    c.check(e, c.project);
  });
}

test("credite terminate -> proprietarul reincarca", () => {
  const e = explainAlert({ kind: "error", project: "PostingClips", message: "POST /api/generate (route): 402 Payment Required: ElevenLabs credits exhausted, insufficient_credit" });
  assert.equal(e.who, "tu");
  assert.match(e.action, /reîncarcă/);
});

test("ECONNREFUSED -> serviciu indisponibil", () => {
  const e = explainAlert({ kind: "error", project: "Print", message: "GET /produs/[slug] (render): fetch failed: connect ECONNREFUSED api.stripe.com:443" });
  assert.match(e.title, /Stripe/);
  assert.equal(e.severity, "Important");
});

test("eroare necunoscuta pe pagina -> explicatie generica (AI o poate inlocui)", () => {
  const e = explainAlert({ kind: "error", project: "X", message: "GET /blog/[slug] (render): TypeError: foo.map is not a function" });
  assert.equal(e.source, "generic");
  assert.match(e.customers, /^Da/);
});

test("127.0.0.1 pe server NU e test local", () => {
  assert.equal(isLocalDevAlert("Can't reach database server at 127.0.0.1:5432"), false);
  assert.equal(isLocalDevAlert("x", "development"), true);
});

test("fara secrete in textul pentru AI", () => {
  const s = scrubSecrets("postgresql://user:parola123@db.host:5432/x?schema=a token=abc123secret Bearer sk-ant-api03-AAAAAAAAAAAAAAAA d@x.ro");
  assert.doesNotMatch(s, /parola123|abc123secret|sk-ant|d@x\.ro/);
});
