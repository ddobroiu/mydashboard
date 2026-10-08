// Verificarile inboxului E-mail si ale API-ului pentru robot (gratuite, fara e-mailuri reale, fara API-uri platite).
//
//   npx tsx scripts/check-email-inbox.ts         → regulile (aplicatia din antete, categorii, „Posibil client”, HTML curatat)
//   npx tsx scripts/check-email-inbox.ts --e2e   → cap-coada cu doua servere IMAP false (hoodiecrow-imap), SMTP false
//        (smtp-server) si o baza Postgres LOCALA de aruncat:
//        TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54341/mydashtest EMAIL_TEST_DEPS=<folder cu node_modules
//        hoodiecrow-imap + smtp-server> npx tsx scripts/check-email-inbox.ts --e2e
//      Refuza orice baza care nu e pe localhost. Recreeaza schema „mydashboard” in baza de test.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

let passed = 0;
async function check(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  EȘUAT  ${name}\n       ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

const D = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);
const rfcDate = (d: Date) => d.toUTCString().replace("GMT", "+0000");

function mail(o: { from: string; to: string; subject: string; text?: string; html?: string; id: string; date?: Date; headers?: string[]; attachments?: { name: string; type: string; data: Buffer; cid?: string }[]; inReplyTo?: string; replyTo?: string }) {
  const b = "BOUNDARY_x1";
  const head = [
    `From: ${o.from}`, `To: ${o.to}`, ...(o.replyTo ? [`Reply-To: ${o.replyTo}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(o.subject).toString("base64")}?=`, `Date: ${rfcDate(o.date || D(0.05))}`, `Message-ID: <${o.id}>`,
    ...(o.inReplyTo ? [`In-Reply-To: <${o.inReplyTo}>`, `References: <${o.inReplyTo}>`] : []), "MIME-Version: 1.0", ...(o.headers || []),
  ];
  const parts: string[] = [];
  if (o.text) parts.push(`Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(o.text).toString("base64")}`);
  if (o.html) parts.push(`Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(o.html).toString("base64")}`);
  for (const a of o.attachments || []) {
    parts.push(`Content-Type: ${a.type}; name="${a.name}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: ${a.cid ? "inline" : "attachment"}; filename="${a.name}"${a.cid ? `\r\nContent-ID: <${a.cid}>` : ""}\r\n\r\n${a.data.toString("base64").replace(/.{76}/g, "$&\r\n")}`);
  }
  return `${head.join("\r\n")}\r\nContent-Type: multipart/mixed; boundary="${b}"\r\n\r\n${parts.map((p) => `--${b}\r\n${p}\r\n`).join("")}--${b}--\r\n`;
}

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n% contract\n"), Buffer.alloc(20_000, 65)]);
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

async function unit() {
  console.log("Reguli (fără bază, fără rețea):");
  const { detectProject, categorize, scoreLead, LEAD_THRESHOLD, counterpart, normalizeSubject } = await import("@/lib/email-inbox/classify");
  const { projectOfAddress, projectKeyOf, matchProject } = await import("@/lib/email-inbox/projects");
  const { sanitizeEmailHtml } = await import("@/lib/email-inbox/sanitize");
  const { getMailboxes } = await import("@/lib/email-inbox/config");
  const { parseSince, windowValue, signupKpi } = await import("@/lib/operator");
  const f = (o: Partial<import("@/lib/email-inbox/classify").MailFacts>) => ({ direction: "in" as const, headers: {}, from: null, replyTo: [], to: [], cc: [], subject: "", text: "", attachments: [], ...o });

  await check("aplicația după adresă; 3D și print nu sunt aplicații", () => {
    assert.equal(projectOfAddress("contact@bazadate.ro"), "bazadate");
    assert.equal(projectOfAddress("Contact@PostingClips.com"), "postingclips");
    assert.equal(projectOfAddress("x@mail.oferte.net"), "oferte");
    assert.equal(projectOfAddress("contact@3dview.ai"), undefined);
    assert.equal(projectOfAddress("contact@shopprint.ro"), undefined);
    assert.equal(projectKeyOf("PostingClips"), "postingclips");
    assert.equal(projectKeyOf("www.tiparementale.ro"), "tiparementale");
    assert.equal(projectKeyOf("3dview"), undefined);
    assert.equal(matchProject("postingclips", [{ name: "PostingClips", domain: null }])?.name, "PostingClips");
    assert.equal(matchProject("bazadate", [{ name: "Baza", domain: "https://www.bazadate.ro/" }])?.name, "Baza");
  });
  await check("aplicația din antete: To / X-Original-To / Received for; casuța ca rezervă", () => {
    assert.equal(detectProject(f({ to: [{ address: "contact@oferte.net" }] }), "bazadate"), "oferte");
    assert.equal(detectProject(f({ to: [{ address: "x@gmail.com" }], headers: { "x-original-to": ["contact@anexa1.ro"] } }), "bazadate"), "anexa1");
    assert.equal(detectProject(f({ headers: { received: ["from mx by mail.ai365.ro with esmtp for <contact@ai365.ro>; Thu"] } })), "ai365");
    assert.equal(detectProject(f({ to: [{ address: "x@gmail.com" }] }), "bazadate"), "bazadate");
  });
  await check("categorii: Stripe/Google/Meta = notificări, aplicația noastră = notificare, newsletter, spam, oameni", () => {
    assert.deepEqual([categorize(f({ from: { address: "notifications@stripe.com" } })).category, categorize(f({ from: { address: "notifications@stripe.com" } })).tag], ["system", "Stripe"]);
    assert.equal(categorize(f({ from: { address: "no-reply@accounts.google.com" } })).tag, "Google");
    assert.equal(categorize(f({ from: { address: "notification@facebookmail.com" } })).tag, "Meta");
    assert.equal(categorize(f({ from: { address: "contact@bazadate.ro" } })).category, "system");
    assert.equal(categorize(f({ from: { address: "contact@bazadate.ro" }, replyTo: [{ address: "ion@gmail.com" }] })).category, "inbox");
    assert.equal(categorize(f({ from: { address: "news@shop.ro" }, headers: { "list-unsubscribe": ["<mailto:u@x>"] } })).category, "bulk");
    assert.equal(categorize(f({ from: { address: "a@b.ro" }, headers: { "x-spam-flag": ["YES"] } })).category, "spam");
    assert.equal(categorize(f({ from: { address: "ion@gmail.com" } })).category, "inbox");
  });
  await check("scor spam cPanel: „X-Spam-Score: 23” = 2,3 (nu spam); score=7.1 în X-Spam-Status = spam", () => {
    const H = (o: Record<string, string[]>) => f({ from: { address: "ion@gmail.com" }, headers: o });
    assert.equal(categorize(H({ "x-spam-status": ["No, score=2.3"], "x-spam-score": ["23"], "x-spam-bar": ["++"], "x-spam-flag": ["NO"] })).category, "inbox");
    assert.equal(categorize(H({ "x-spam-score": ["23"], "x-spam-bar": ["++"] })).category, "inbox");
    assert.equal(categorize(H({ "x-spam-status": ["No, score=7.1"] })).category, "spam");
    assert.equal(categorize(H({ "x-spam-score": ["8.5"] })).category, "spam");
  });
  await check("„Posibil client”: preț + abonament da; mulțumire nu; istoricul citat nu contează", () => {
    assert.ok(scoreLead({ subject: "Întrebare", text: "Bună ziua, cât costă abonamentul anual pentru firma mea?" }).score >= LEAD_THRESHOLD);
    assert.ok(scoreLead({ subject: "Nu merge", text: "Nu pot să mă loghez în cont, e urgent" }).score >= LEAD_THRESHOLD);
    assert.ok(scoreLead({ subject: "Mulțumesc", text: "Mulțumesc frumos!" }).score < LEAD_THRESHOLD);
    assert.ok(scoreLead({ subject: "Re: x", text: "Mulțumesc!\n\nPe 1 oct, X a scris:\n> cât costă abonamentul? vreau o ofertă de preț" }).score < LEAD_THRESHOLD);
  });
  await check("clientul: Reply-To extern (formular), From, destinatarul la trimise", () => {
    assert.equal(counterpart(f({ from: { address: "contact@oferte.net" }, replyTo: [{ address: "maria@x.ro", name: "Maria" }] }))?.address, "maria@x.ro");
    assert.equal(counterpart(f({ direction: "out", from: { address: "contact@oferte.net" }, to: [{ address: "ion@x.ro" }] }))?.address, "ion@x.ro");
    assert.equal(normalizeSubject("RE: Fwd: [Ticket] Ofertă"), "oferta");
  });
  await check("HTML curățat: fără script / onclick; imaginile externe blocate", () => {
    const r = sanitizeEmailHtml(`<p onclick="x()">Salut</p><script>alert(1)</script><img src="https://t.example/p.gif"><a href="javascript:alert(1)">x</a>`);
    assert.ok(!/script|onclick|javascript:/i.test(r.html));
    assert.ok(r.hasRemoteImages && /data-remote-src="https:\/\/t\.example/.test(r.html));
  });
  await check("MAILBOXES_JSON: fără parolă = ignorată, aplicația din domeniu; JSON stricat = []", () => {
    const list = getMailboxes({ MAILBOXES_JSON: JSON.stringify([{ address: "Contact@Bazadate.ro", imapHost: "mail.bazadate.ro", pass: "x" }, { address: "contact@oferte.net", imapHost: "h" }]) } as unknown as NodeJS.ProcessEnv);
    assert.equal(list.length, 1);
    assert.equal(list[0].project, "bazadate");
    assert.deepEqual(list[0].folders, ["INBOX"]);
    assert.deepEqual(getMailboxes({ MAILBOXES_JSON: "nu e json" } as unknown as NodeJS.ProcessEnv), []);
  });
  await check("operator: since=24h/7d/ISO, plafon 31 de zile; fereastra cifrelor; rândul de conturi noi", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    assert.equal(parseSince(null, now).toISOString(), "2026-10-07T12:00:00.000Z");
    assert.equal(parseSince("7d", now).toISOString(), "2026-10-01T12:00:00.000Z");
    assert.equal(parseSince("2026-10-08T10:00:00Z", now).toISOString(), "2026-10-08T10:00:00.000Z");
    assert.equal(parseSince("400d", now).toISOString(), "2026-09-07T12:00:00.000Z");
    assert.deepEqual(windowValue({ h24: 3, today: 1, d7: 9, d30: 20 }, parseSince("24h", now), now), { value: 3, basis: "24h" });
    assert.deepEqual(windowValue({ today: 1, d7: 9, d30: 20 }, parseSince("24h", now), now), { value: 1, basis: "azi" });
    assert.deepEqual(windowValue({ h24: 3, d7: 9, d30: 20 }, parseSince("3d", now), now), { value: 9, basis: "7 zile" });
    assert.equal(signupKpi({ project: "x", generatedAt: "", kpi: [{ key: "vanzari", label: "Vânzări", unit: "money" }, { key: "conturi", label: "Conturi noi", unit: "count" }] })?.key, "conturi");
  });
}

// ---------------- cap-coada ----------------
async function e2e() {
  const base = process.env.TEST_DATABASE_URL || "";
  const host = (() => { try { return new URL(base).hostname; } catch { return ""; } })();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("TEST_DATABASE_URL lipsește sau nu e pe localhost — refuz (nu rulez pe baza de producție).");
  const req = createRequire(path.join(process.env.EMAIL_TEST_DEPS || process.cwd(), "package.json"));
  const hoodiecrow = req("hoodiecrow-imap");
  const { SMTPServer } = req("smtp-server");
  const { Client } = await import("pg");
  const { ImapFlow } = await import("imapflow");
  console.log("\nCap-coadă (IMAP/SMTP false, Postgres local, schema „mydashboard” ca în producție):");

  // baza de test + schema „mydashboard” refacută de la zero: tabelele vechi (fără Email*), apoi migrarea noastră de 2 ori
  {
    const admin = new Client({ connectionString: base.replace(/\/[^/?]+(\?|$)/, "/postgres$1") });
    await admin.connect();
    const db = new URL(base).pathname.slice(1);
    if (!/^[a-z0-9_]+$/.test(db)) throw new Error("nume de bază invalid");
    const ex = await admin.query("SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1", [db]);
    // baza de test trebuie sa fie UTF8 (ca in productie); pe Windows initdb poate crea WIN1252
    if (ex.rowCount && ex.rows[0].enc !== "UTF8") await admin.query(`DROP DATABASE "${db}"`);
    if (!ex.rowCount || ex.rows[0].enc !== "UTF8") await admin.query(`CREATE DATABASE "${db}" ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
    await admin.end();
  }
  const pg = new Client({ connectionString: base });
  await pg.connect();
  await pg.query(`DROP SCHEMA IF EXISTS mydashboard CASCADE; CREATE SCHEMA mydashboard; SET search_path TO mydashboard`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mydash-schema-"));
  const full = fs.readFileSync("prisma/schema.prisma", "utf8");
  const cut = full.indexOf("// ─── Inboxul E-mail");
  fs.writeFileSync(path.join(tmp, "old.prisma"), full.slice(0, cut));
  const oldSql = execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "migrate", "diff", "--from-empty", "--to-schema", path.join(tmp, "old.prisma"), "--script"], { encoding: "utf8", shell: process.platform === "win32" })
    .split(/\r?\n/).filter((l) => !/injected env|Loaded Prisma config/.test(l)).join("\n");
  await pg.query(oldSql);
  const mig = fs.readFileSync("prisma/sql/2026-10-08_email_inbox.sql", "utf8");
  await check("migrarea: doar adăugări, se aplică de două ori fără eroare, tabelele apar în schema mydashboard", async () => {
    assert.ok(!/\b(drop|truncate|rename)\b|\balter\s+column\b|^\s*delete\s/im.test(mig.replace(/--.*$/gm, "")));
    await pg.query(mig);
    await pg.query(mig);
    const r = await pg.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'mydashboard' AND table_name LIKE 'Email%'`);
    assert.equal(r.rows[0].n, 4);
    const fk = await pg.query(`SELECT count(*)::int AS n FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'mydashboard' AND c.conname LIKE 'Email%_fkey'`);
    assert.equal(fk.rows[0].n, 2);
  });
  // date: proiectele bazadate + oferte, o plată Stripe a clientului, o alertă activă
  await pg.query(`INSERT INTO "Organization" (id, name) VALUES ('org1', 'Noi')`);
  await pg.query(`INSERT INTO "Project" (id, "organizationId", name, domain) VALUES ('p_bd', 'org1', 'bazadate', 'bazadate.ro'), ('p_of', 'org1', 'oferte', 'www.oferte.net'), ('p_print', 'org1', 'Print', 'shopprint.ro')`);
  await pg.query(`INSERT INTO "Connection" (id, "projectId", provider, credentials) VALUES ('c_bd', 'p_bd', 'STRIPE', 'x'), ('c_pr', 'p_print', 'STRIPE', 'x')`);
  await pg.query(`INSERT INTO "Transaction" (id, "projectId", "connectionId", provider, "externalId", "occurredAt", date, currency, amount, customer)
                  VALUES ('t1', 'p_bd', 'c_bd', 'STRIPE', 'ch_1', now() - interval '2 hours', current_date, 'RON', 149, 'Client@Example.com'),
                         ('t2', 'p_print', 'c_pr', 'STRIPE', 'ch_2', now() - interval '1 hours', current_date, 'RON', 999, 'altcineva@example.com')`);
  await pg.query(`INSERT INTO "AlertState" (key, project, kind, message, active, "updatedAt") VALUES ('down:bazadate.ro', 'bazadate', 'down', 'bazadate.ro nu răspunde în 15 secunde', true, now()),
                  ('down:www.prynt.ro', 'prynt.ro', 'down', 'prynt.ro nu răspunde', true, now())`);

  // statisticile aplicațiilor (fals): bazadate trimite conturi noi + activitatea clientului; oferte nu are endpoint
  const stats = http.createServer((rq, rs) => {
    if (rq.url?.startsWith("/bd/api/mydashboard/stats")) {
      rs.setHeader("Content-Type", "application/json");
      rs.end(JSON.stringify({
        project: "bazadate", generatedAt: new Date().toISOString(),
        kpi: [{ key: "conturi", label: "Conturi noi", unit: "count", h24: 2, today: 1, d7: 5, d30: 12, total: 300 }, { key: "venit", label: "Încasări", unit: "money", h24: 149 }],
        recent: [{ at: new Date(Date.now() - 3600_000).toISOString(), title: "100 firme", detail: "Ion Popescu · client@example.com · factura CDV 12", amount: 149, status: "paid" }],
      }));
    } else { rs.statusCode = 404; rs.end("nu"); }
  });
  await new Promise<void>((r) => stats.listen(0, "127.0.0.1", () => r()));
  const statsPort = (stats.address() as { port: number }).port;

  process.env.MAILBOXES_JSON = "";
  process.env.CRON_SECRET = "test-secret";
  process.env.APP_STATS_URLS = `bazadate=http://127.0.0.1:${statsPort}/bd,oferte=http://127.0.0.1:${statsPort}/of`;

  const msgs = {
    lead: mail({ from: "Ion Popescu <client@example.com>", to: "contact@bazadate.ro", subject: "Abonament pentru firmă", id: "lead-1@example.com", date: D(0.2),
      text: "Bună ziua,\nCât costă abonamentul anual? Aș vrea o ofertă pentru SC Test SRL.\nTel 0722 123 456", attachments: [{ name: "contract.pdf", type: "application/pdf", data: PDF }] }),
    reply: mail({ from: "Ion Popescu <client@example.com>", to: "contact@bazadate.ro", subject: "Re: Abonament pentru firmă", id: "lead-2@example.com", inReplyTo: "lead-1@example.com", date: D(0.1),
      html: `<p>Revin cu logo-ul:</p><img src="cid:logo1"><img src="https://tracker.example/open.gif"><script>alert(1)</script>`, attachments: [{ name: "logo.png", type: "image/png", data: PNG, cid: "logo1" }] }),
    stripe: mail({ from: "Stripe <notifications@stripe.com>", to: "contact@bazadate.ro", subject: "Plată primită 149 RON", id: "stripe-1@stripe.com", text: "Ai primit o plată." }),
    news: mail({ from: "Shop <news@shop.example>", to: "contact@bazadate.ro", subject: "Reduceri", id: "news-1@x", headers: ["List-Unsubscribe: <mailto:u@shop.example>"], text: "Promo, preț mic, abonament ofertă" }),
    spam: mail({ from: "win@lottery.example", to: "contact@bazadate.ro", subject: "You won", id: "spam-1@x", headers: ["X-Spam-Flag: YES"], text: "click" }),
    old: mail({ from: "vechi@example.com", to: "contact@bazadate.ro", subject: "Mesaj vechi", id: "old-1@x", date: D(45), text: "x" }),
    waiting: mail({ from: "Ana <ana@example.org>", to: "contact@bazadate.ro", subject: "Întrebare cont", id: "wait-1@x", date: D(3), text: "Nu pot să mă loghez în cont, e urgent." }),
    seen: mail({ from: "citit@example.com", to: "contact@bazadate.ro", subject: "Mulțumesc", id: "seen-1@x", date: D(0.3), text: "Mulțumesc!" }),
  };
  const ofMsg = mail({ from: "Maria <maria@example.org>", to: "contact@oferte.net", subject: "Problemă", id: "of-1@x", date: D(2), text: "Nu merge contul meu, nu pot intra. Urgent, vă rog." });
  const imapServer = (inbox: { raw: string; internaldate: Date; flags?: string[] }[], sent: { raw: string; internaldate: Date; flags?: string[] }[]) =>
    hoodiecrow({
      plugins: ["ID", "UIDPLUS", "SPECIAL-USE", "ENABLE", "IDLE", "LITERALPLUS"],
      storage: { INBOX: { messages: inbox, folders: { Sent: { "special-use": "\\Sent", messages: sent } } }, "": { separator: "." } },
    });
  const imapBd = imapServer(
    [
      { raw: msgs.lead, internaldate: D(0.2) },
      { raw: msgs.lead, internaldate: D(0.19) }, // același Message-ID de două ori
      { raw: msgs.reply, internaldate: D(0.1) },
      { raw: msgs.stripe, internaldate: D(0.09) },
      { raw: msgs.news, internaldate: D(0.08) },
      { raw: msgs.spam, internaldate: D(0.07) },
      { raw: msgs.old, internaldate: D(45) },
      { raw: msgs.waiting, internaldate: D(3) },
      { raw: msgs.seen, internaldate: D(0.3), flags: ["\\Seen"] },
    ],
    [],
  );
  const imapOf = imapServer([{ raw: ofMsg, internaldate: D(2) }], []);
  const listen = async (srv: { listen: (p: number, h: string, cb: () => void) => void; server?: { address: () => { port: number } }; address?: () => { port: number } }) => {
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    return (srv.server?.address?.() ?? srv.address?.())!.port;
  };
  const bdPort = await listen(imapBd);
  const ofPort = await listen(imapOf);
  const smtpGot: { server: string; from: string; to: string[]; raw: string }[] = [];
  const smtpServer = (name: string) =>
    new SMTPServer({
      authOptional: true, disabledCommands: ["STARTTLS"], onAuth: (_a: unknown, _s: unknown, cb: (e: null, r: { user: string }) => void) => cb(null, { user: "u" }),
      onData(stream: NodeJS.ReadableStream, session: { envelope: { mailFrom: { address: string }; rcptTo: { address: string }[] } }, cb: () => void) {
        const ch: Buffer[] = [];
        stream.on("data", (c: Buffer) => ch.push(c));
        stream.on("end", () => { smtpGot.push({ server: name, from: session.envelope.mailFrom.address, to: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(ch).toString() }); cb(); });
      },
    });
  const smtpBd = smtpServer("bazadate");
  const smtpOf = smtpServer("oferte");
  const smtpPort = async (s: { listen: (p: number, h: string, cb: () => void) => void; server: { address: () => unknown } }) => {
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    return (s.server.address() as { port: number }).port;
  };
  const sBd = await smtpPort(smtpBd);
  const sOf = await smtpPort(smtpOf);

  const box = (address: string, imapPort: number, smtpPort: number) => ({ label: address, address, imapHost: "127.0.0.1", imapPort, imapSecure: false, smtpHost: "127.0.0.1", smtpPort, smtpSecure: false, user: "testuser", pass: "testpass", folders: ["INBOX", "INBOX.Sent"], sentFolder: "INBOX.Sent" });
  const { getMailboxes } = await import("@/lib/email-inbox/config");
  const mailboxes = getMailboxes({ MAILBOXES_JSON: JSON.stringify([box("contact@bazadate.ro", bdPort, sBd), box("contact@oferte.net", ofPort, sOf)]) } as unknown as NodeJS.ProcessEnv);
  process.env.MAILBOXES_JSON = JSON.stringify([box("contact@bazadate.ro", bdPort, sBd), box("contact@oferte.net", ofPort, sOf)]);

  const snapshot = async (port: number) => {
    const c = new ImapFlow({ host: "127.0.0.1", port, secure: false, auth: { user: "testuser", pass: "testpass" }, logger: false });
    await c.connect();
    const out: string[] = [];
    for (const folder of ["INBOX", "INBOX.Sent"]) {
      const lock = await c.getMailboxLock(folder, { readOnly: true });
      try {
        for await (const m of c.fetch("1:*", { uid: true, flags: true })) out.push(`${folder}:${m.uid}:${[...(m.flags || [])].sort().join(",")}`);
      } catch { /* folder gol */ } finally { lock.release(); }
    }
    await c.logout();
    return out;
  };

  try {
    const { syncAll } = await import("@/lib/email-inbox/sync");
    const { prisma } = await import("@/lib/prisma");
    const admin = await import("@/lib/email-inbox/admin");
    const { sendReply } = await import("@/lib/email-inbox/send");
    const { fetchAttachmentFromImap } = await import("@/lib/email-inbox/attachments");
    const { getTasks } = await import("@/lib/tasks");
    const beforeBd = await snapshot(bdPort);
    const beforeOf = await snapshot(ofPort);

    const r = await syncAll({ mailboxes });
    const inBd = r.results.find((x) => x.mailbox === "contact@bazadate.ro" && x.folder === "INBOX")!;
    await check("prima sincronizare: 8 mesaje din 30 de zile (cel de 45 sărit), dublura recunoscută, fără erori", () => {
      assert.ok(r.results.every((x) => !x.error), r.results.map((x) => x.error).filter(Boolean).join(" | "));
      assert.equal(inBd.fetched, 8);
      assert.equal(inBd.created, 7);
      assert.equal(inBd.duplicates, 1);
      assert.equal(r.results.find((x) => x.mailbox === "contact@oferte.net" && x.folder === "INBOX")!.created, 1);
    });
    await check("pe server nu s-a schimbat nimic (niciun \\Seen, nimic mutat sau șters)", async () => {
      assert.deepEqual(await snapshot(bdPort), beforeBd);
      assert.deepEqual(await snapshot(ofPort), beforeOf);
    });
    const lead = await prisma.emailThread.findFirstOrThrow({ where: { customerEmail: "client@example.com" } });
    await check("conversația clientului: 2 mesaje legate prin In-Reply-To, bazadate, Posibil client, 2 necitite, telefon", () => {
      assert.equal(lead.project, "bazadate");
      assert.equal(lead.messageCount, 2);
      assert.equal(lead.unreadCount, 2);
      assert.ok(lead.possibleLead, lead.leadSignals.join(","));
      assert.equal(lead.customerPhone, "0722123456");
      assert.ok(lead.hasAttachments);
    });
    await check("categorii salvate: Stripe = notificare, newsletter, spam; mesajul citit pe server rămâne citit", async () => {
      const st = await prisma.emailThread.findFirstOrThrow({ where: { subject: { contains: "Plată primită" } } });
      assert.deepEqual([st.category, st.tag], ["system", "Stripe"]);
      assert.equal((await prisma.emailThread.findFirstOrThrow({ where: { subject: "Reduceri" } })).category, "bulk");
      assert.equal((await prisma.emailThread.findFirstOrThrow({ where: { subject: "You won" } })).category, "spam");
      assert.equal((await prisma.emailThread.findFirstOrThrow({ where: { customerEmail: "citit@example.com" } })).unreadCount, 0);
    });
    await check("conversația: HTML fără script, imagine externă blocată, cid → ruta de atașamente; clientul cu plata și activitatea din aplicație", async () => {
      const d = (await admin.getThread(lead.id, { markRead: false }))!;
      const html = d.messages[1].html || "";
      assert.ok(!/<script/i.test(html));
      assert.ok(/data-remote-src="https:\/\/tracker/.test(html));
      assert.ok(/src="\/api\/email\/attachment\/[^"]+\?inline=1"/.test(html), html.slice(0, 300));
      assert.equal(d.customer.payments.length, 1);
      assert.equal(d.customer.paymentsTotal.RON, 149);
      assert.equal(d.customer.appActivity.length, 1);
      assert.equal(d.customer.appActivity[0].title, "100 firme");
    });
    await check("filtre și numărători: necitite, posibili clienți, fără răspuns > 24 h, pe aplicație", async () => {
      const c = await admin.counters();
      assert.equal(c.unread, 4); // lead x2, ana, maria
      assert.ok(c.leads >= 2);
      assert.equal(c.awaiting, 2); // ana (3 zile), maria (2 zile)
      const bp = await admin.countersByProject();
      assert.equal(bp.get("bazadate")?.unread, 3);
      assert.equal(bp.get("oferte")?.awaiting, 1);
      assert.equal((await admin.listThreads({ view: "system" })).length, 1);
      assert.equal((await admin.listThreads({ view: "inbox", project: "oferte" })).length, 1);
      assert.equal((await admin.listThreads({ view: "inbox", q: "contract.pdf" })).length, 1);
    });
    await check("„De făcut”: alerta bazadate (fără alerta print), cele 2 e-mailuri fără răspuns", async () => {
      const { tasks } = await getTasks();
      assert.ok(tasks.some((t) => t.kind === "alert" && t.project === "bazadate"));
      assert.ok(!tasks.some((t) => /prynt/.test(t.title)));
      assert.equal(tasks.filter((t) => t.kind === "email").length, 2);
      assert.equal(tasks[0].kind, "alert");
    });
    await check("atașamentul se descarcă din IMAP (doar citire)", async () => {
      const att = await prisma.emailAttachment.findFirstOrThrow({ where: { filename: "contract.pdf" }, include: { message: true } });
      const data = await fetchAttachmentFromImap(att, mailboxes);
      assert.equal(data.length, PDF.length);
    });

    const ofThread = await prisma.emailThread.findFirstOrThrow({ where: { customerEmail: "maria@example.org" } });
    const sentBefore = (await snapshot(ofPort)).filter((x) => x.startsWith("INBOX.Sent")).length;
    await check("răspunsul pleacă din ACEEAȘI căsuță (SMTP oferte), cu In-Reply-To; copia în INBOX.Sent al oferte", async () => {
      const res = await sendReply(ofThread.id, "Bună ziua, am resetat contul. Încercați acum.", { mailboxes });
      assert.equal(res.appendError, undefined, res.appendError);
      const got = smtpGot.at(-1)!;
      assert.equal(got.server, "oferte");
      assert.equal(got.from, "contact@oferte.net");
      assert.deepEqual(got.to, ["maria@example.org"]);
      assert.ok(/In-Reply-To: <of-1@x>/i.test(got.raw));
      assert.ok(/^From: .*contact@oferte\.net/im.test(got.raw));
      assert.equal((await snapshot(ofPort)).filter((x) => x.startsWith("INBOX.Sent")).length, sentBefore + 1);
      const t = await prisma.emailThread.findUniqueOrThrow({ where: { id: ofThread.id } });
      assert.equal(t.lastDirection, "out");
      assert.equal(t.messageCount, 2);
      assert.equal(t.unreadCount, 0);
    });
    await check("după răspuns: nu mai e „fără răspuns”; a doua sincronizare nu aduce dubluri (copia din Trimise e recunoscută)", async () => {
      assert.equal((await admin.counters()).awaiting, 1);
      const r2 = await syncAll({ mailboxes });
      assert.ok(r2.results.every((x) => !x.error));
      assert.equal(r2.results.reduce((s, x) => s + x.created, 0), 0);
      assert.equal((await prisma.emailThread.findUniqueOrThrow({ where: { id: ofThread.id } })).messageCount, 2);
    });
    await check("rezolvat / arhivă / spam / necitit se schimbă doar în baza noastră (serverul rămâne neatins)", async () => {
      const seen = await prisma.emailThread.findFirstOrThrow({ where: { customerEmail: "citit@example.com" } });
      const before = await snapshot(bdPort);
      await admin.setThreadStatus(seen.id, "done");
      assert.equal((await admin.listThreads({ view: "done" })).length, 1);
      await admin.setThreadStatus(seen.id, "archived");
      assert.equal((await admin.listThreads({ view: "archived" })).length, 1);
      await admin.setThreadStatus(seen.id, "open");
      await admin.setThreadCategory(seen.id, "spam");
      assert.ok((await admin.listThreads({ view: "spam" })).some((x) => x.id === seen.id));
      await admin.setThreadCategory(seen.id, "inbox");
      await admin.markUnread(seen.id);
      await admin.setThreadStatus(seen.id, "done");
      assert.deepEqual(await snapshot(bdPort), before);
    });

    // API-ul robotului: rutele reale, cu cheia din OPERATOR_TOKEN
    const summaryRoute = await import("@/app/api/operator/summary/route");
    const emailsRoute = await import("@/app/api/operator/emails/route");
    const emailRoute = await import("@/app/api/operator/emails/[id]/route");
    const salesRoute = await import("@/app/api/operator/sales/route");
    const signupsRoute = await import("@/app/api/operator/signups/route");
    const alertsRoute = await import("@/app/api/operator/alerts/route");
    const tasksRoute = await import("@/app/api/operator/tasks/route");
    const TOKEN = "t".repeat(40);
    const get = (url: string, token?: string) => new Request(`http://localhost${url}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    await check("operator: fără OPERATOR_TOKEN = 404; cheie greșită = 401", async () => {
      delete process.env.OPERATOR_TOKEN;
      assert.equal((await summaryRoute.GET(get("/api/operator/summary", TOKEN))).status, 404);
      process.env.OPERATOR_TOKEN = TOKEN;
      assert.equal((await summaryRoute.GET(get("/api/operator/summary"))).status, 401);
      assert.equal((await summaryRoute.GET(get("/api/operator/summary", "gresit"))).status, 401);
    });
    await check("operator /summary: vânzări, conturi noi, e-mailuri, alerte pe aplicație; fără print și 3D", async () => {
      const res = await summaryRoute.GET(get("/api/operator/summary?since=24h", TOKEN));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "no-store");
      const s = await res.json();
      const bd = s.projects.find((p: { key: string }) => p.key === "bazadate");
      assert.equal(bd.sales.count, 1);
      assert.equal(bd.sales.amounts.RON, 149);
      assert.equal(bd.signups.value, 2);
      assert.equal(bd.emails.unread, 3);
      assert.equal(bd.alerts.length, 1);
      assert.equal(s.totals.sales.amounts.RON, 149, "plata print nu intră");
      assert.equal(s.totals.activeAlerts, 1, "alerta prynt nu intră");
      assert.ok(!s.projects.some((p: { key: string }) => /3d|print/.test(p.key)));
      assert.equal(s.projects.find((p: { key: string }) => p.key === "oferte").appStats, "fără endpoint");
      assert.ok(s.tasks.length >= 2);
      assert.equal(s.mailboxes.length, 2);
    });
    await check("operator /emails?unread=1&project=, /emails/<id> (text, fără să marcheze citit), /sales, /signups, /alerts, /tasks", async () => {
      const e = await (await emailsRoute.GET(get("/api/operator/emails?unread=1&project=bazadate", TOKEN))).json();
      assert.equal(e.count, 2);
      assert.ok(e.emails.every((x: { project: string; unread: number }) => x.project === "bazadate" && x.unread > 0));
      const one = await (await emailRoute.GET(get(`/api/operator/emails/${lead.id}`, TOKEN), { params: Promise.resolve({ id: lead.id }) })).json();
      assert.equal(one.messages.length, 2);
      assert.ok(one.messages[0].text.includes("abonamentul"));
      assert.equal(one.customer.payments.length, 1);
      assert.equal((await prisma.emailThread.findUniqueOrThrow({ where: { id: lead.id } })).unreadCount, 2, "robotul nu marchează citit");
      const sales = await (await salesRoute.GET(get("/api/operator/sales?since=7d", TOKEN))).json();
      assert.equal(sales.total.count, 1);
      assert.equal(sales.recent[0].customer, "Client@Example.com");
      const su = await (await signupsRoute.GET(get("/api/operator/signups?since=7d", TOKEN))).json();
      assert.equal(su.byProject.find((x: { project: string }) => x.project === "bazadate").signups.value, 5);
      const al = await (await alertsRoute.GET(get("/api/operator/alerts", TOKEN))).json();
      assert.equal(al.count, 1);
      assert.ok(al.alerts[0].action);
      const tk = await (await tasksRoute.GET(get("/api/operator/tasks", TOKEN))).json();
      assert.equal(tk.emailReady, true);
      assert.ok(tk.count >= 2);
    });
    await prisma.$disconnect();
  } finally {
    await pg.end();
    imapBd.close?.();
    imapOf.close?.();
    smtpBd.close();
    smtpOf.close();
    stats.close();
  }
}

(async () => {
  // DATABASE_URL inainte de primul import @/lib/prisma: baza de test (doar localhost) sau una inexistenta (regulile nu o folosesc)
  const t = process.env.TEST_DATABASE_URL || "";
  process.env.DATABASE_URL = process.argv.includes("--e2e") && t ? `${t}${t.includes("?") ? "&" : "?"}schema=mydashboard` : "postgresql://none:none@127.0.0.1:1/none";
  await unit();
  if (process.argv.includes("--e2e")) await e2e();
  console.log(`\n${passed} verificări trecute${process.exitCode ? ", unele EȘUATE" : ""}.`);
  process.exit(process.exitCode || 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
