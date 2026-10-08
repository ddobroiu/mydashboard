"use client";

// Inboxul aplicatiilor: stanga conversatiile (filtre, aplicatie, cautare), mijloc mesajele + raspuns (pleaca din
// casuta in care a venit mesajul), dreapta clientul: platile lui, ce a facut in aplicatie, alte conversatii.
// Citit / rezolvat / arhivat / spam se schimba DOAR aici, nu pe serverul de e-mail. (Portat din adminul ShopPrint.)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Archive, AtSign, Bell, CheckCircle2, Download, FileText, Image as ImageIcon, Inbox as InboxIcon, Loader2, Mail,
  MailOpen, Paperclip, RefreshCw, RotateCcw, Search, Send, ShieldAlert, Sparkles, X,
} from "lucide-react";
import type { EmailAttachmentView, EmailMessageView, ThreadDetail, ThreadRow } from "@/lib/email-inbox/admin";
import { MAIL_PROJECTS, PROJECT_KEYS, projectLabel } from "@/lib/email-inbox/projects";

const POLL_MS = 30_000;
const VIEWS = [
  { key: "inbox", label: "Inbox" },
  { key: "leads", label: "Posibili clienți" },
  { key: "unread", label: "Necitite" },
  { key: "awaiting", label: "Fără răspuns > 24 h" },
  { key: "system", label: "Notificări" },
  { key: "spam", label: "Spam / newsletter" },
  { key: "done", label: "Rezolvate" },
  { key: "archived", label: "Arhivă" },
] as const;
type Counters = { unread: number; leads: number; awaiting: number; system: number; spam: number };
type SyncInfo = {
  configured: { address: string; label: string; project: string | null; folders: string[] }[];
  state: { address: string; folder: string; lastSyncAt: string | null; lastError: string | null }[];
};

const TONES = ["bg-sky-100 text-sky-800", "bg-emerald-100 text-emerald-800", "bg-violet-100 text-violet-800", "bg-amber-100 text-amber-900", "bg-rose-100 text-rose-800", "bg-indigo-100 text-indigo-800", "bg-teal-100 text-teal-800", "bg-orange-100 text-orange-800", "bg-lime-100 text-lime-800", "bg-fuchsia-100 text-fuchsia-800"];
const tone = (p: string | null) => (p ? TONES[Math.max(0, PROJECT_KEYS.indexOf(p as never)) % TONES.length] : "bg-slate-100 text-slate-700");
const fmtSize = (b?: number | null) => (!b ? "" : b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const time = (iso: string) => new Date(iso).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
function when(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return time(iso);
  const y = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === y.toDateString()) return "ieri";
  return d.toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit" });
}
const full = (iso: string) => new Date(iso).toLocaleString("ro-RO", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const initials = (s: string) => s.replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "@";
const isImage = (a: EmailAttachmentView) => a.mime.startsWith("image/");
const money = (v: number, c: string) => v.toLocaleString("ro-RO", { style: "currency", currency: c, maximumFractionDigits: 2 });

function ProjectBadge({ project }: { project: string | null }) {
  if (!project) return null;
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${tone(project)}`}>{projectLabel(project)}</span>;
}

/** HTML-ul mesajului, intr-un iframe fara scripturi; imaginile externe doar la cerere. */
function EmailHtml({ html, loadRemote }: { html: string; loadRemote: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(120);
  const doc = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const body = loadRemote ? html.replace(/\sdata-remote-src=/g, " src=") : html;
    const csp = `default-src 'none'; img-src ${origin} data: ${loadRemote ? "https: http:" : ""}; style-src 'unsafe-inline'; font-src data:; script-src 'none'`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>html,body{margin:0}body{font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#0f172a;background:#fff;padding:2px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%!important}blockquote{margin:0 0 0 .8ex;border-left:2px solid #cbd5e1;padding-left:1ex;color:#475569}</style></head><body>${body}</body></html>`;
  }, [html, loadRemote]);
  const fit = () => {
    const d = ref.current?.contentDocument;
    if (d?.body) setH(Math.min(4000, Math.max(60, d.documentElement.scrollHeight + 4)));
  };
  return (
    <iframe ref={ref} title="mesaj" srcDoc={doc} onLoad={() => { fit(); setTimeout(fit, 600); }}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" className="w-full rounded border-0 bg-white" style={{ height: h }} />
  );
}

function AttachmentChip({ a }: { a: EmailAttachmentView }) {
  return (
    <a href={`/api/email/attachment/${a.id}`} target="_blank" rel="noreferrer" className="flex w-full max-w-xs items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 hover:border-accent sm:w-auto">
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-md ${isImage(a) ? "bg-sky-50 text-sky-600" : "bg-rose-50 text-rose-600"}`}>{isImage(a) ? <ImageIcon size={18} /> : <FileText size={18} />}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{a.filename}</span>
        <span className="block text-xs text-text-3">{[(a.filename.match(/\.([a-z0-9]+)$/i)?.[1] || a.mime.split("/")[1] || "").toUpperCase(), fmtSize(a.size)].filter(Boolean).join(" · ")}</span>
      </span>
      <Download size={16} className="text-text-3" />
    </a>
  );
}

function MessageCard({ m, open, onToggle }: { m: EmailMessageView; open: boolean; onToggle: () => void }) {
  const [remote, setRemote] = useState(false);
  const [asText, setAsText] = useState(false);
  const files = m.attachments.filter((a) => !a.inline);
  const out = m.direction === "out";
  const who = out ? `Tu (${m.fromEmail || ""})` : m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail || "";
  return (
    <article className={`rounded-xl border bg-surface ${out ? "border-accent/40" : "border-border"}`}>
      <button onClick={onToggle} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${out ? "bg-accent text-white" : "bg-bg text-text-2"}`}>{out ? "Tu" : initials(m.fromName || m.fromEmail || "")}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="truncate text-sm font-semibold">{who}</span>
            <span className="ml-auto shrink-0 text-xs text-text-3">{full(m.sentAt)}</span>
          </span>
          <span className="block truncate text-xs text-text-3">
            către {m.to.map((a) => a.address).join(", ")}{m.cc.length ? ` · cc ${m.cc.map((a) => a.address).join(", ")}` : ""}
          </span>
          {!open && <span className="mt-0.5 block truncate text-xs text-text-2">{(m.text || "").replace(/\s+/g, " ").slice(0, 160)}</span>}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {out && m.source === "dashboard" && <span className="rounded bg-good-bg px-1.5 py-0.5 font-medium text-good">trimis din mydashboard</span>}
            {m.error && <span className="inline-flex items-center gap-1 rounded bg-warn-bg px-1.5 py-0.5 text-warn"><AlertTriangle size={11} /> {m.error}</span>}
            {m.leadSignals.length > 0 && <span className="inline-flex items-center gap-1 rounded bg-warn-bg px-1.5 py-0.5 text-warn"><Sparkles size={11} /> {m.leadSignals.join(" · ")}</span>}
            {m.html && (
              <span className="ml-auto flex gap-2">
                {m.hasRemoteImages && !asText && !remote && <button onClick={() => setRemote(true)} className="rounded border border-border px-2 py-0.5 font-medium text-text-2 hover:bg-bg">Încarcă imaginile</button>}
                <button onClick={() => setAsText((v) => !v)} className="rounded border border-border px-2 py-0.5 text-text-2 hover:bg-bg">{asText ? "Vezi formatat" : "Vezi ca text"}</button>
              </span>
            )}
          </div>
          {m.html && !asText ? <EmailHtml html={m.html} loadRemote={remote} /> : <p className="whitespace-pre-wrap break-words text-sm">{m.text || "(mesaj fără text)"}</p>}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              {files.map((a) => <AttachmentChip key={a.id} a={a} />)}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

const chipBtn = "inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-text-2 hover:bg-bg";

export default function EmailInbox({ initialId, initialProject, initialView }: { initialId?: string; initialProject?: string; initialView?: string }) {
  const [list, setList] = useState<ThreadRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notReady, setNotReady] = useState(false);
  const [counters, setCounters] = useState<Counters>({ unread: 0, leads: 0, awaiting: 0, system: 0, spam: 0 });
  const [sync, setSync] = useState<SyncInfo | null>(null);
  const [view, setView] = useState<string>(initialView && VIEWS.some((v) => v.key === initialView) ? initialView : "inbox");
  const [project, setProject] = useState(initialProject || "");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(initialId || null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const loadList = useCallback(async () => {
    try {
      const r = await fetch(`/api/email/inbox?view=${view}&project=${project}&q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const d = await r.json();
      if (r.ok) {
        setList(d.threads || []);
        if (d.counters) setCounters(d.counters);
        setSync(d.sync || null);
        setNotReady(Boolean(d.notReady));
      }
    } catch {
      /* reincearca la urmatorul ciclu */
    } finally {
      setLoaded(true);
    }
  }, [view, project, q]);

  const loadDetail = useCallback(async (id: string, peek = false) => {
    try {
      const r = await fetch(`/api/email/inbox/${id}${peek ? "?peek=1" : ""}`, { cache: "no-store" });
      const d = await r.json();
      if (r.ok) {
        const det = d as ThreadDetail;
        setDetail(det);
        // implicit deschis: ultimul mesaj (pastram ce era deschis in aceeasi conversatie)
        setOpenIds((prev) => (prev.size && det.messages.some((m) => prev.has(m.id)) ? prev : new Set(det.messages.slice(-1).map((m) => m.id))));
      }
    } catch {
      /* idem */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(loadList, q ? 300 : 0);
    const i = setInterval(() => { if (document.visibilityState === "visible") void loadList(); }, POLL_MS);
    return () => { clearTimeout(t); clearInterval(i); };
  }, [loadList, q]);

  // conversatia din adresa (/dashboard/email?id=...), deschisa o singura data la incarcare
  useEffect(() => {
    if (!initialId) return;
    const t = setTimeout(() => void loadDetail(initialId), 0);
    return () => clearTimeout(t);
  }, [initialId, loadDetail]);

  const choose = (id: string | null) => {
    setNote(null);
    setReply("");
    setDetail(null);
    setOpenIds(new Set());
    setSel(id);
    if (id) void loadDetail(id).then(() => loadList());
  };

  const act = async (body: Record<string, unknown>, okText?: string) => {
    if (!sel) return;
    setNote(null);
    try {
      const r = await fetch(`/api/email/inbox/${sel}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Eroare");
      if (okText) setNote({ kind: "ok", text: okText });
      await loadDetail(sel, true);
      void loadList();
    } catch (e) {
      setNote({ kind: "err", text: e instanceof Error ? e.message : "Eroare" });
    }
  };

  const send = async () => {
    if (!sel || !reply.trim()) return;
    setSending(true);
    setNote(null);
    try {
      const r = await fetch(`/api/email/inbox/${sel}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reply", text: reply }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Mesajul nu a plecat.");
      setReply("");
      setNote({ kind: "ok", text: `Trimis de pe ${d.from}${d.appendError ? ` (${d.appendError})` : ""}.` });
      await loadDetail(sel, true);
      void loadList();
    } catch (e) {
      setNote({ kind: "err", text: e instanceof Error ? e.message : "Eroare" });
    } finally {
      setSending(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    setNote(null);
    try {
      const r = await fetch("/api/email/inbox", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Eroare");
      const created = (d.results || []).reduce((s: number, x: { created: number }) => s + x.created, 0);
      const errs = (d.results || []).filter((x: { error?: string }) => x.error).map((x: { mailbox: string; folder: string; error: string }) => `${x.mailbox} ${x.folder}: ${x.error}`);
      setNote(errs.length ? { kind: "err", text: errs.join(" · ") } : { kind: "ok", text: created ? `${created} mesaj(e) noi.` : "Nimic nou." });
      void loadList();
    } catch (e) {
      setNote({ kind: "err", text: e instanceof Error ? e.message : "Eroare" });
    } finally {
      setSyncing(false);
    }
  };

  const t = detail?.thread;
  const lastSync = sync?.state.map((s) => s.lastSyncAt).filter(Boolean).sort().pop() || null;
  const syncErrors = (sync?.state || []).filter((s) => s.lastError);
  const noMailbox = sync && sync.configured.length === 0;
  const replyFrom = detail ? [...detail.messages].reverse().find((m) => m.direction === "in")?.mailbox || t?.mailbox : "";
  const countFor = (k: string) => (k === "leads" ? counters.leads : k === "unread" ? counters.unread : k === "awaiting" ? counters.awaiting : k === "system" ? counters.system : k === "spam" ? counters.spam : 0);
  const c = detail?.customer;

  return (
    <div className="space-y-3">
      {notReady && <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">Inboxul nu e activ încă: lipsește migrarea bazei de date (<code>prisma/sql/2026-10-08_email_inbox.sql</code>).</p>}
      {noMailbox && !notReady && <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">Nicio căsuță configurată: lipsește <code>MAILBOXES_JSON</code> în .env.</p>}
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-3">
        <button onClick={syncNow} disabled={syncing} className="btn btn-ghost text-xs">
          <RefreshCw size={13} className={syncing ? "animate-spin" : ""} /> Verifică acum
        </button>
        {lastSync && <span>Ultima verificare: {when(lastSync)} · {sync?.configured.length || 0} căsuțe</span>}
        {syncErrors.length > 0 && (
          <span className="inline-flex items-center gap-1 text-warn" title={syncErrors.map((s) => `${s.address} ${s.folder}: ${s.lastError}`).join("\n")}>
            <AlertTriangle size={12} /> {syncErrors.length === 1 ? `${syncErrors[0].address}: ${(syncErrors[0].lastError || "").slice(0, 120)}` : `${syncErrors.length} căsuțe cu erori`}
          </span>
        )}
      </div>
      {note && !sel && <p className={`rounded-lg px-3 py-2 text-sm ${note.kind === "ok" ? "bg-good-bg text-good" : "bg-bad-bg text-bad"}`}>{note.text}</p>}

      <div className="grid h-[calc(100vh-200px)] min-h-[560px] overflow-hidden rounded-xl border border-border bg-surface lg:grid-cols-[330px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_290px]">
        {/* Conversatiile */}
        <aside className={`min-h-0 flex-col border-r border-border ${sel ? "hidden lg:flex" : "flex"}`}>
          <div className="space-y-2 border-b border-border p-3">
            <div className="flex gap-2">
              <label className="relative block flex-1">
                <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută subiect, e-mail, text, fișier" className="w-full rounded-lg border border-border bg-bg py-2 pl-8 pr-3 text-sm focus:border-accent focus:outline-none" />
              </label>
              <select value={project} onChange={(e) => { setProject(e.target.value); choose(null); }} className="rounded-lg border border-border bg-bg px-2 text-xs" aria-label="Aplicația">
                <option value="">Toate aplicațiile</option>
                {PROJECT_KEYS.map((k) => <option key={k} value={k}>{MAIL_PROJECTS[k].name}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap gap-1">
              {VIEWS.map((f) => {
                const n = countFor(f.key);
                return (
                  <button key={f.key} onClick={() => { setView(f.key); choose(null); }} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${view === f.key ? "bg-text text-bg" : "bg-bg text-text-2 hover:bg-border"}`}>
                    {f.label}
                    {n > 0 && f.key !== "inbox" && <span className={`rounded-full px-1.5 text-[10px] ${f.key === "leads" || f.key === "awaiting" ? "bg-amber-500 text-white" : "bg-surface text-text-2"}`}>{n}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!loaded ? (
              <p className="flex items-center gap-2 p-4 text-sm text-text-3"><Loader2 size={14} className="animate-spin" /> Se încarcă…</p>
            ) : list.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-bg text-accent"><InboxIcon size={22} /></span>
                <p className="text-sm font-medium">{q || project || view !== "inbox" ? "Niciun mesaj găsit" : "Încă nu sunt mesaje"}</p>
                <p className="text-xs text-text-3">{q || project || view !== "inbox" ? "Schimbă căutarea sau filtrul." : "Mesajele apar aici după prima verificare a căsuțelor."}</p>
              </div>
            ) : (
              list.map((r) => (
                <button key={r.id} onClick={() => choose(r.id)} className={`flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left hover:bg-bg ${sel === r.id ? "bg-bg" : ""}`}>
                  <span className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${r.category === "system" ? "bg-slate-700 text-white" : "bg-bg text-text-2"}`}>{r.category === "system" ? <Bell size={16} /> : initials(r.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={`truncate text-sm ${r.unread ? "font-semibold" : "font-medium text-text-2"}`}>{r.name}</span>
                      <span className={`ml-auto shrink-0 text-[11px] ${r.unread ? "font-semibold text-accent" : "text-text-3"}`}>{when(r.lastMessageAt)}</span>
                    </span>
                    <span className={`block truncate text-xs ${r.unread ? "font-semibold" : "text-text-2"}`}>{r.subject}</span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className="truncate text-xs text-text-3">{r.lastDirection === "out" && "Tu: "}{r.preview}</span>
                      {r.unread > 0 && <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{r.unread}</span>}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <ProjectBadge project={r.project} />
                      {r.possibleLead && <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900"><Sparkles size={10} /> Posibil client</span>}
                      {r.tag && <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-semibold text-white">{r.tag}</span>}
                      {r.hasAttachments && <span className="inline-flex items-center gap-0.5 rounded bg-bg px-1.5 py-0.5 text-[10px] text-text-2"><Paperclip size={10} /> fișiere</span>}
                      {r.status === "done" && <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] text-text-2">rezolvat</span>}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Mesajele */}
        <section className={`min-h-0 flex-col ${sel ? "flex" : "hidden lg:flex"}`}>
          {!t || !detail ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-bg text-center">
              <Mail size={36} className="text-text-3" />
              <p className="text-sm text-text-3">{sel ? "Se încarcă mesajele…" : "Alege o conversație din stânga."}</p>
            </div>
          ) : (
            <>
              <header className="space-y-2 border-b border-border px-4 py-3">
                <div className="flex items-start gap-3">
                  <button onClick={() => choose(null)} className="rounded-lg p-1 text-text-3 hover:bg-bg lg:hidden" aria-label="Înapoi"><X size={18} /></button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{t.subject}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-3">
                      <ProjectBadge project={t.project} />
                      {t.possibleLead && <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900" title={t.leadSignals.join(", ")}><Sparkles size={10} /> Posibil client</span>}
                      {t.category === "system" && <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-semibold text-white">Notificare{t.tag ? ` ${t.tag}` : ""}</span>}
                      {t.category === "spam" && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800">Spam</span>}
                      {t.category === "bulk" && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">Newsletter / automat</span>}
                      <span>{t.messageCount} mesaj(e) · {t.mailbox}</span>
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {t.status === "open" ? (
                    <button onClick={() => act({ action: "status", status: "done" }, "Marcat rezolvat.")} className={chipBtn}><CheckCircle2 size={13} /> Rezolvat</button>
                  ) : (
                    <button onClick={() => act({ action: "status", status: "open" }, "Redeschis.")} className={chipBtn}><RotateCcw size={13} /> Redeschide</button>
                  )}
                  {t.status !== "archived" && <button onClick={() => act({ action: "status", status: "archived" }, "Arhivat (doar în mydashboard).")} className={chipBtn}><Archive size={13} /> Arhivează</button>}
                  <button onClick={() => act({ action: "unread" }, "Marcat necitit.")} className={chipBtn}><MailOpen size={13} /> Necitit</button>
                  {t.category === "inbox" ? (
                    <button onClick={() => act({ action: "category", category: "spam" }, "Mutat la spam (doar în mydashboard).")} className={chipBtn}><ShieldAlert size={13} /> Spam</button>
                  ) : (
                    <button onClick={() => act({ action: "category", category: "inbox" }, "Mutat în Inbox.")} className={chipBtn}><InboxIcon size={13} /> E de la un om</button>
                  )}
                </div>
              </header>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-bg px-4 py-4">
                {detail.messages.map((m) => (
                  <MessageCard key={m.id} m={m} open={openIds.has(m.id)}
                    onToggle={() => setOpenIds((p) => { const n = new Set(p); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} />
                ))}
              </div>
              <footer className="border-t border-border p-3">
                {note && <p className={`mb-2 rounded-lg px-3 py-2 text-sm ${note.kind === "ok" ? "bg-good-bg text-good" : "bg-bad-bg text-bad"}`}>{note.text}</p>}
                <div className="flex items-end gap-2">
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }}
                    placeholder={`Răspunde către ${t.email || ""}… (Ctrl+Enter trimite)`}
                    className="min-h-[60px] flex-1 resize-y rounded-xl border border-border bg-bg px-3 py-2 text-sm focus:border-accent focus:outline-none" />
                  <button onClick={send} disabled={sending || !reply.trim() || !t.email} className="btn h-11">
                    {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Trimite
                  </button>
                </div>
                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-text-3"><AtSign size={11} /> Pleacă de pe {replyFrom}, cu mesajul clientului citat; copia se salvează în „Trimise” al aceleiași căsuțe.</p>
              </footer>
            </>
          )}
        </section>

        {/* Clientul */}
        <aside className="hidden min-h-0 overflow-y-auto border-l border-border bg-bg p-4 xl:block">
          {!detail || !t ? (
            <p className="text-sm text-text-3">Detaliile clientului apar aici.</p>
          ) : t.category !== "inbox" ? (
            <div className="space-y-2 text-sm text-text-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Expeditor</p>
              <p className="break-all">{t.email}</p>
              <p className="text-xs text-text-3">Notificările automate și newsletterele nu se leagă de un client.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Client</p>
                <p className="text-base font-semibold">{t.name}</p>
                {t.email && <a href={`mailto:${t.email}`} className="block break-all text-sm text-accent hover:underline">{t.email}</a>}
                {t.customerPhone && <a href={`tel:${t.customerPhone}`} className="block text-sm text-text-2">{t.customerPhone}</a>}
                <p className="pt-1"><ProjectBadge project={t.project} /></p>
              </div>
              {t.possibleLead && (
                <div className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 ring-1 ring-amber-200">
                  <p className="flex items-center gap-1 font-semibold"><Sparkles size={12} /> Posibil client</p>
                  <p className="mt-0.5">{t.leadSignals.join(" · ")}</p>
                </div>
              )}
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Plăți cu acest e-mail</p>
                {!c || c.payments.length === 0 ? (
                  <p className="text-xs text-text-3">Nicio plată găsită (Stripe / Oblio / comenzi).</p>
                ) : (
                  <>
                    <p className="text-sm font-semibold">{Object.entries(c.paymentsTotal).map(([cur, v]) => money(v, cur)).join(" + ")} <span className="font-normal text-text-3">în {c.payments.length} plăți</span></p>
                    {c.payments.slice(0, 6).map((p, i) => (
                      <p key={i} className="flex justify-between text-xs text-text-2"><span>{new Date(p.at).toLocaleDateString("ro-RO")} · {p.project}</span><span className="tabular-nums">{money(p.amount, p.currency)}</span></p>
                    ))}
                  </>
                )}
              </div>
              {c && c.appActivity.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">În aplicație</p>
                  {c.appActivity.map((a, i) => (
                    <div key={i} className="rounded-lg bg-surface p-2 text-xs ring-1 ring-border">
                      <p className="font-medium">{a.title}{a.amount != null ? ` · ${a.amount}` : ""}</p>
                      <p className="text-text-3">{new Date(a.at).toLocaleString("ro-RO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{a.status ? ` · ${a.status}` : ""}</p>
                    </div>
                  ))}
                </div>
              )}
              {c && c.otherThreads.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Alte conversații</p>
                  {c.otherThreads.map((o) => (
                    <button key={o.id} onClick={() => choose(o.id)} className="block w-full truncate rounded-lg bg-surface px-2 py-1.5 text-left text-xs ring-1 ring-border hover:ring-accent">
                      {when(o.lastMessageAt)} · {o.subject}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
