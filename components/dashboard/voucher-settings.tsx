"use client";
import { FormSelect } from "@/components/ui/form-select";

import { FormInput } from "@/components/ui/form-input";

import { LoadingSkeleton } from "@/components/ui/skeleton";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import type { ChargeKind, GymSettings, RateCategory } from "@/lib/finance/contracts";
import { discountQuote, validateVoucher, voucherAvailability, type Voucher, type VoucherUse } from "@/lib/finance/vouchers";
import { voucherError } from "@/components/people/voucher-entry";
import { SettingsDrawer } from "./settings-drawer";
import { SettingsConfirm } from "./settings-confirm";
import { VoucherActions } from "./voucher-actions";
import styles from "./settings.module.css";

const money = (v: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v / 100);
const date = (v: number | null) => v === null ? "No limit" : new Date(v).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
const kindNames: Record<ChargeKind, string> = { daily_session: "Daily session", renewal: "Membership renewal", new_membership: "New membership" };
function generatedCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8)), alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `GYM-${Array.from(bytes, b => alphabet[b % alphabet.length]).join("")}`;
}
interface Draft {
  code: string; name: string; note: string; discountKind: "fixed" | "percent"; amount: string; maxDiscount: string;
  minimum: string; kinds: ChargeKind[]; categories: RateCategory[]; starts: string; ends: string; total: string; customer: string;
}
const localDate = (at: number | null) => at === null ? "" : new Date(at + 8 * 3600000).toISOString().slice(0, 16);
function draftFor(v?: Voucher): Draft {
  return v ? { code: v.code, name: v.name, note: v.note, discountKind: v.discountKind, amount: String(v.value / 100), maxDiscount: v.maxDiscountMinor === null ? "" : String(v.maxDiscountMinor / 100),
    minimum: String(v.minimumBaseMinor / 100), kinds: v.kinds, categories: v.categories, starts: localDate(v.startsAt), ends: localDate(v.endsAt), total: v.totalLimit === null ? "" : String(v.totalLimit), customer: v.customerLimit === null ? "" : String(v.customerLimit) }
    : { code: generatedCode(), name: "", note: "", discountKind: "fixed", amount: "", maxDiscount: "", minimum: "0", kinds: ["daily_session"], categories: ["student", "regular"], starts: "", ends: "", total: "", customer: "1" };
}
function configFor(d: Draft) {
  const decimal = (v: string) => { if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new Error("Use positive amounts with up to two decimal places."); return Math.round(Number(v) * 100); };
  return validateVoucher({ code: d.code, name: d.name, note: d.note, discountKind: d.discountKind, value: decimal(d.amount),
    maxDiscountMinor: d.maxDiscount ? decimal(d.maxDiscount) : null, minimumBaseMinor: d.minimum ? decimal(d.minimum) : 0,
    kinds: d.kinds, categories: d.categories, startsAt: d.starts ? Date.parse(`${d.starts}:00+08:00`) : null, endsAt: d.ends ? Date.parse(`${d.ends}:00+08:00`) : null,
    totalLimit: d.total ? Number(d.total) : null, customerLimit: d.customer ? Number(d.customer) : null });
}
function discountLabel(v: Pick<Voucher, "discountKind" | "value" | "maxDiscountMinor">) {
  return `${v.discountKind === "fixed" ? money(v.value) : `${v.value / 100}%`} off${v.maxDiscountMinor === null ? "" : ` · max ${money(v.maxDiscountMinor)}`}`;
}

export function VoucherSettings() {
  const { user } = useAuth();
  const [records, setRecords] = useState<Voucher[]>([]), [cursor, setCursor] = useState<string | null>(null), [loading, setLoading] = useState(true), [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [search, setSearch] = useState(""), [filter, setFilter] = useState("all");
  const [editor, setEditor] = useState<{ original?: Voucher; draft: Draft } | null>(null), [dirty, setDirty] = useState(false);
  const [detail, setDetail] = useState<{ voucher: Voucher; uses: VoucherUse[]; nextCursor: string | null } | null>(null);
  const [confirm, setConfirm] = useState<{ voucher?: Voucher; use?: VoucherUse; action: string; title: string; text: string } | null>(null);
  const [closeReason, setCloseReason] = useState("");
  const [rates, setRates] = useState<GymSettings | null>(null);
  const attempt = useRef<{ payload: string; id: string } | null>(null);
  const [drawerClosing, setDrawerClosing] = useState(false);
  async function headers() { return { Authorization: `Bearer ${await user?.getIdToken()}` }; }
  async function load(next?: string) {
    setLoading(true);
    try {
      const response = await fetch(`/api/finance/vouchers${next ? `?cursor=${encodeURIComponent(next)}` : ""}`, { headers: await headers() });
      if (!response.ok) throw new Error("Could not load vouchers. Try again.");
      const result = await response.json(); setRecords(rows => next ? [...rows, ...result.records] : result.records); setCursor(result.nextCursor); setLoaded(true);
    } finally { setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    if (user) user.getIdToken().then(token => Promise.all([
      fetch("/api/finance/vouchers", { headers: { Authorization: `Bearer ${token}` } }).then(async r => { if (!r.ok) throw new Error("Could not load vouchers. Try again."); const data = await r.json(); if (active) { setRecords(data.records); setCursor(data.nextCursor); setLoaded(true); } }),
      fetch("/api/finance/settings", { headers: { Authorization: `Bearer ${token}` } }).then(async r => { if (r.ok) { const data = await r.json(); if (active) setRates(data); } }),
    ])).catch(e => { if (active) setMessage(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  function finishClosingDrawer() { setEditor(null); setDetail(null); setDrawerClosing(false); }
  async function mutate(body: Record<string, unknown>) {
    const payload = JSON.stringify(body);
    if (attempt.current?.payload !== payload) attempt.current = { payload, id: crypto.randomUUID() };
    const response = await fetch("/api/finance/vouchers", { method: "POST", headers: { "Content-Type": "application/json", ...await headers() }, body: JSON.stringify({ ...body, operationId: attempt.current.id }) });
    const result = await response.json();
    if (!response.ok) throw new Error(voucherError(result.error));
    attempt.current = null;
    setRecords(rows => rows.some(v => v.id === result.id) ? rows.map(v => v.id === result.id ? result : v) : [result, ...rows]);
    setDetail(old => old && old.voucher.id === result.id ? { ...old, voucher: result } : old);
    return result as Voucher;
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editor || busy) return;
    setBusy(true); setMessage("");
    try {
      const config = configFor(editor.draft);
      await mutate({ ...config, ...(editor.original ? { id: editor.original.id, revision: editor.original.revision } : {}) });
      setDrawerClosing(true); setDirty(false); setMessage("Voucher saved. Existing purchases keep their original discount.");
    } catch (e) { setMessage(e instanceof Error ? e.message.startsWith("voucher-") ? voucherError(e.message) : e.message : "Could not save voucher. Your draft is preserved."); }
    finally { setBusy(false); }
  }
  async function openDetails(v: Voucher, next?: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/finance/vouchers?id=${encodeURIComponent(v.id)}${next ? `&cursor=${encodeURIComponent(next)}` : ""}`, { headers: await headers() });
      if (!response.ok) throw new Error("Could not load voucher details. Try again.");
      const result = await response.json(); setDetail(old => ({ ...result, uses: next && old ? [...old.uses, ...result.uses] : result.uses }));
      setRecords(rows => rows.map(row => row.id === v.id ? result.voucher : row));
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not load details."); }
    finally { setBusy(false); }
  }
  function edit(v?: Voucher, duplicate = false) {
    const draft = draftFor(v); if (duplicate) { draft.code = generatedCode(); draft.name = `${v!.name} copy`.slice(0, 80); draft.starts = ""; draft.ends = ""; }
    setDrawerClosing(false); setEditor({ original: duplicate ? undefined : v, draft }); setDetail(null); setDirty(false); setMessage("");
  }
  function closeEditor() {
    if (dirty) setConfirm({ action: "discard", title: "Discard voucher changes?", text: "Your unsaved changes will be discarded." }); else setDrawerClosing(true);
  }
  function requestAction(v: Voucher, action: string) {
    const texts: Record<string, string> = { pause: "New submissions will stop. Existing submitted purchases keep their discount.", resume: "New submissions can use this code when its schedule and usage limits allow.", archive: "The code will stop accepting new submissions. Its financial and usage history will be preserved.", delete: "This unused voucher will be deleted. Its code remains retired and cannot be reused." };
    setConfirm({ voucher: v, action, title: `${action[0].toUpperCase() + action.slice(1)} ${v.code}?`, text: texts[action] });
  }
  async function confirmAction() {
    if (!confirm) return;
    if (confirm.action === "discard") { setDrawerClosing(true); setDirty(false); setConfirm(null); return; }
    setBusy(true); setMessage("");
    try {
      if (confirm.action === "close-purchase") {
        const response = await fetch("/api/finance/purchases", { method: "POST", headers: { "Content-Type": "application/json", ...await headers() },
          body: JSON.stringify({ action: "abandon", chargeId: confirm.use!.chargeId, paymentRequestId: confirm.use!.paymentRequestId, confirmed: true, reason: closeReason }) });
        if (!response.ok) throw new Error("Could not close this purchase. Refresh usage to check whether it changed or was approved.");
        if (detail) await openDetails(detail.voucher);
        setMessage("Request closed. Its voucher reservation was released.");
      } else { await mutate({ id: confirm.voucher!.id, revision: confirm.voucher!.revision, action: confirm.action }); setMessage("Voucher updated."); }
      setConfirm(null);
    }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not update voucher."); }
    finally { setBusy(false); }
  }
  async function copy(code: string) { try { await navigator.clipboard.writeText(code); setMessage(`${code} copied.`); } catch { setMessage(`Copy this code: ${code}`); } }
  const filtered = records.filter(v => v.status !== "deleted" && (filter === "all" || voucherAvailability(v, Date.now()) === filter) && `${v.code} ${v.name}`.toLowerCase().includes(search.trim().toLowerCase()));
  const metricRows = records.filter(v => v.status !== "deleted");
  function moreActions(v: Voucher) {
    return <VoucherActions voucher={v} busy={busy} onEdit={edit} onAction={requestAction} />;
  }
  const change = (patch: Partial<Draft>) => { if (editor) { setEditor({ ...editor, draft: { ...editor.draft, ...patch } }); setDirty(true); } };
  let preview = "Enter the discount and eligibility to preview the rules.";
  if (editor) { try {
    const config = configFor(editor.draft), category = config.categories[0], kind = config.kinds[0];
    const key = `${category}${kind === "daily_session" ? "Daily" : "Monthly"}Minor` as "studentDailyMinor";
    const base = rates?.[key];
    preview = `${discountLabel(config)} · ${config.kinds.map(k => kindNames[k]).join(", ")} · ${config.categories.join(" / ")}. `;
    if (base) { try { const q = discountQuote({ ...config, id: "preview", status: "enabled", revision: 1, heldCount: 0, confirmedCount: 0 } as Voucher, base, kind, category, config.startsAt ?? Date.now()); preview += `Example (${category}, ${kindNames[kind]}): ${money(base)} − ${money(q.discountAmountMinor)} = ${money(q.amountMinor)}.`; } catch (e) { preview += voucherError(e instanceof Error ? e.message : undefined); } }
    else preview += "Configure the eligible price in Pricing to see an example.";
  } catch { /* Incomplete drafts have no valid preview yet. */ } }
  return <section className={styles.section} aria-labelledby="vouchers-title">
      <div className={styles.head}><div><h2 id="vouchers-title">Vouchers</h2><p className={styles.sub}>Offer a discount. Keep control of where and how often it applies.</p></div><button className={styles.primary} disabled={busy} onClick={() => edit()}>+ Create voucher</button></div>
      <dl className={`${styles.metrics} ${styles.voucherMetrics}`}><div><dt>Confirmed uses</dt><dd>{loaded ? metricRows.reduce((sum, v) => sum + v.confirmedCount, 0) : "—"}</dd></div><div><dt>Held uses</dt><dd>{loaded ? metricRows.reduce((sum, v) => sum + v.heldCount, 0) : "—"}</dd></div><div><dt>Confirmed discounts</dt><dd>{loaded ? money(metricRows.reduce((sum, v) => sum + v.confirmedDiscountMinor, 0)) : "—"}</dd></div></dl>
      <p className={styles.sub}>All time · loaded vouchers. Search and filters apply to the loaded list.</p>
      <div className={`${styles.toolbar} ${styles.voucherToolbar}`}><label className={styles.search}>Search code or campaign<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a voucher" /></label><label>Availability<FormSelect value={filter} onChange={e => setFilter(e.target.value)}>{["all", "available", "scheduled", "paused", "expired", "limit reached", "archived"].map(s => <option key={s} value={s}>{s === "all" ? "All statuses" : s[0].toUpperCase() + s.slice(1)}</option>)}</FormSelect></label><button disabled={busy || loading} onClick={() => void load().catch(e => setMessage(e.message))}>↻ Refresh</button></div>
      {loading && !loaded ? <LoadingSkeleton label="Loading vouchers…" count={5} /> : !loaded ? <div className={styles.empty}><h3>Vouchers could not load</h3><button onClick={() => void load().catch(e => setMessage(e.message))}>Retry</button></div> : !filtered.length ? <div className={styles.empty}><h3>{search || filter !== "all" ? "No matching vouchers" : "Your first offer starts here"}</h3><p>{search || filter !== "all" ? "Change the search or availability filter." : "Create a code for daily sessions, membership renewals, or new memberships."}</p><button onClick={() => { if (search || filter !== "all") { setSearch(""); setFilter("all"); } else edit(); }}>{search || filter !== "all" ? "Clear filters" : "Create voucher"}</button></div> : <table className={`${styles.table} ${styles.voucherCards}`}><thead><tr>{["Code / campaign", "Discount / scope", "Availability", "Uses", "Actions"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{filtered.map(v => <tr key={v.id}><td><strong className={styles.code}>{v.code}</strong><small>{v.name}</small></td><td>{discountLabel(v)}<small>{v.kinds.map(k => kindNames[k]).join(", ")}</small><small>{v.categories.join(" / ")}</small></td><td><span className={styles.status} data-status={voucherAvailability(v, Date.now())}>{voucherAvailability(v, Date.now())}</span><small>{v.endsAt ? `Until ${date(v.endsAt)}` : "No expiry"}</small></td><td><span className={styles.number}>{v.confirmedCount} confirmed</span><small>{v.heldCount} held{v.totalLimit ? ` / ${v.totalLimit} total` : " · Unlimited"}</small>{v.totalLimit && <progress className={styles.capacity} max={v.totalLimit} value={v.heldCount + v.confirmedCount} aria-label={`${v.heldCount + v.confirmedCount} of ${v.totalLimit} uses committed`} />}</td><td><div className={styles.actions}><button disabled={busy} onClick={() => void openDetails(v)}>Details</button><button aria-label={`Copy ${v.code}`} onClick={() => void copy(v.code)}>Copy</button></div>{moreActions(v)}</td></tr>)}</tbody></table>}
      {cursor && <div className={styles.footer}><p className={styles.sub}>{records.length} vouchers loaded</p><button disabled={loading || busy} onClick={() => void load(cursor).catch(e => setMessage(e.message))}>{loading ? "Loading…" : "Load 50 more"}</button></div>}

    {(editor || detail) && <SettingsDrawer title={editor ? editor.original ? "Edit voucher" : "Create voucher" : detail!.voucher.code} closing={drawerClosing} busy={busy} onClose={() => { if (editor) closeEditor(); else { setDrawerClosing(true); setMessage(""); } }} onExited={finishClosingDrawer}>
    {editor ? <div className={styles.editor}>
      <div className={styles.head}><div><p className={styles.sub}>Set who can use this code and what it saves.</p></div></div>
      <form onSubmit={save}>
        <fieldset disabled={busy}><legend>Identity</legend><div className={styles.fields}>
          <label>Code<input aria-label="Code" aria-describedby="voucher-code-hint" required pattern="[A-Za-z0-9-]{6,24}" maxLength={24} value={editor.draft.code} readOnly={editor.original?.everUsed} onChange={e => change({ code: e.target.value.toUpperCase() })} className={styles.code} /><small id="voucher-code-hint">{editor.original?.everUsed ? "Used code text stays fixed. Duplicate to use another code." : "6–24 letters, digits or hyphens. Renaming retires the old code."}</small></label>
          <div><label>Generate a unique code</label><button type="button" disabled={editor.original?.everUsed} onClick={() => change({ code: generatedCode() })}>↻ Generate code</button></div>
          <label className={styles.full}>Campaign name<input required maxLength={80} value={editor.draft.name} onChange={e => change({ name: e.target.value })} /></label>
          <label className={styles.full}>Private admin note (optional)<textarea rows={2} maxLength={500} value={editor.draft.note} onChange={e => change({ note: e.target.value })} /></label>
        </div></fieldset>
        <fieldset disabled={busy}><legend>Discount</legend><div className={styles.fields}>
          <label>Discount type<FormSelect value={editor.draft.discountKind} onChange={e => change({ discountKind: e.target.value as Draft["discountKind"] })}><option value="fixed">Fixed amount (PHP)</option><option value="percent">Percentage (%)</option></FormSelect></label>
          <label>{editor.draft.discountKind === "fixed" ? "Amount off (PHP)" : "Percentage off (%)"}<FormInput required inputMode="decimal" value={editor.draft.amount} onChange={e => change({ amount: e.target.value })} /></label>
          {editor.draft.discountKind === "percent" && <label>Maximum discount (PHP, optional)<FormInput inputMode="decimal" value={editor.draft.maxDiscount} onChange={e => change({ maxDiscount: e.target.value })} /></label>}
          <label>Minimum purchase (PHP)<FormInput inputMode="decimal" value={editor.draft.minimum} onChange={e => change({ minimum: e.target.value })} /></label>
        </div><small>At least PHP 1 must remain payable. One voucher per purchase; percentage discounts round down to the nearest centavo.</small></fieldset>
        <fieldset disabled={busy}><legend>Eligible purchases</legend><div className={styles.checkGroup}>{(Object.keys(kindNames) as ChargeKind[]).map(k => <label key={k}><input type="checkbox" checked={editor.draft.kinds.includes(k)} onChange={e => change({ kinds: e.target.checked ? [...editor.draft.kinds, k] : editor.draft.kinds.filter(x => x !== k) })} />{kindNames[k]}</label>)}</div></fieldset>
        <fieldset disabled={busy}><legend>Rate categories</legend><div className={styles.checkGroup}>{(["student", "regular"] as const).map(c => <label key={c}><input type="checkbox" checked={editor.draft.categories.includes(c)} onChange={e => change({ categories: e.target.checked ? [...editor.draft.categories, c] : editor.draft.categories.filter(x => x !== c) })} />{c === "student" ? "Student" : "Regular"}</label>)}</div></fieldset>
        <fieldset disabled={busy}><legend>Schedule & limits</legend><div className={styles.fields}>
          <label>Starts (optional)<FormInput type="datetime-local" value={editor.draft.starts} onChange={e => change({ starts: e.target.value })} /><small>Philippine time · Asia/Manila</small></label>
          <label>Ends (optional)<FormInput type="datetime-local" value={editor.draft.ends} onChange={e => change({ ends: e.target.value })} /><small>Unavailable from this exact time.</small></label>
          <label>Total uses (optional)<FormInput aria-label="Total uses (optional)" inputMode="numeric" value={editor.draft.total} onChange={e => change({ total: e.target.value })} /><small>Held and confirmed uses consume capacity.</small></label>
          <label>Uses per customer (optional)<FormInput aria-label="Uses per customer (optional)" inputMode="numeric" value={editor.draft.customer} onChange={e => change({ customer: e.target.value })} /><small>Clear to allow unlimited uses per profile.</small></label>
        </div></fieldset>
        <div className={styles.preview}><strong>Rule preview</strong><p>{preview}</p></div>
        {message && <p role="status" className={styles.message}>{message}</p>}
        <div className={styles.footer}><p className={styles.sub}>Existing submitted purchases keep their discount.</p><div className={styles.actions}><button type="button" disabled={busy} onClick={closeEditor}>Cancel</button><button className={styles.primary} disabled={busy || (!!editor.original && !dirty)}>{busy ? "Saving…" : "Save voucher"}</button></div></div>
        {editor.original && <button type="button" disabled={busy} onClick={() => void openDetails(editor.original!).then(() => { if (!dirty) setEditor(null); })}>Reload latest details (keep draft)</button>}
        {detail && editor.original && detail.voucher.revision !== editor.original.revision && <div className={styles.preview}><p>Latest revision {detail.voucher.revision}: {discountLabel(detail.voucher)} · {detail.voucher.kinds.map(k => kindNames[k]).join(", ")} · {detail.voucher.totalLimit ?? "Unlimited"} total uses. Your draft is preserved.</p><button type="button" disabled={busy} onClick={() => { setEditor({ ...editor, original: detail.voucher }); setDetail(null); setMessage("Review your draft against the latest revision, then save."); }}>Use latest revision and keep draft</button></div>}
      </form>
    </div> : detail ? <>
      <div className={styles.head}><div><p className={styles.sub}>{detail.voucher.name}</p></div><div className={styles.actions}><button onClick={() => void copy(detail.voucher.code)}>Copy code</button>{moreActions(detail.voucher)}</div></div>
      <span className={styles.status} data-status={voucherAvailability(detail.voucher, Date.now())}>{voucherAvailability(detail.voucher, Date.now())}</span>
      <dl className={`${styles.metrics} ${styles.voucherMetrics}`}><div><dt>Confirmed uses</dt><dd>{detail.voucher.confirmedCount}</dd></div><div><dt>Held uses</dt><dd>{detail.voucher.heldCount}</dd></div><div><dt>Confirmed discounts</dt><dd>{money(detail.voucher.confirmedDiscountMinor)}</dd></div></dl>
      <dl className={styles.ruleList}><div><dt>Discount</dt><dd>{discountLabel(detail.voucher)}</dd></div><div><dt>Applies to</dt><dd>{detail.voucher.kinds.map(k => kindNames[k]).join(", ")}</dd></div><div><dt>Categories / minimum price</dt><dd>{detail.voucher.categories.join(" / ")} · {money(detail.voucher.minimumBaseMinor)}</dd></div><div><dt>Available uses / per customer</dt><dd>{detail.voucher.totalLimit === null ? "Unlimited" : Math.max(0, detail.voucher.totalLimit - detail.voucher.heldCount - detail.voucher.confirmedCount)} / {detail.voucher.customerLimit ?? "Unlimited"}</dd></div><div><dt>Starts · Philippine time</dt><dd>{date(detail.voucher.startsAt)}</dd></div><div><dt>Ends · Philippine time (exclusive)</dt><dd>{date(detail.voucher.endsAt)}</dd></div><div><dt>Private note</dt><dd>{detail.voucher.note || "None"}</dd></div><div><dt>Revision / last edited</dt><dd>{detail.voucher.revision} · {date(detail.voucher.updatedAt)}</dd></div></dl>
      <div className={styles.head}><div><h2>Usage history</h2><p className={styles.sub}>One row per purchase. Corrected payment attempts share the same use.</p></div><button disabled={busy} onClick={() => void openDetails(detail.voucher)}>Refresh</button></div>
      {!detail.uses.length ? <div className={styles.empty}><h3>No submissions yet</h3><p>Usage will appear after a customer submits this code with a purchase.</p></div> : <table className={styles.table}><thead><tr>{["Customer / purchase", "Original", "Discount", "Payable", "Status / time"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{detail.uses.map(use => <tr key={use.id}><td><strong>{use.customerName ?? use.personId}</strong><small>{use.personId}</small><small>{kindNames[use.kind]} · {use.category}</small><small className={styles.code}>{use.transactionNumber}</small></td><td data-label="Original">{money(use.baseAmountMinor)}</td><td data-label="Discount">−{money(use.discountAmountMinor)}</td><td data-label="Payable">{money(use.amountMinor)}</td><td><span className={styles.status}>{use.status}</span>{use.paymentStatus && <small>Payment: {use.paymentStatus}</small>}<small>Submitted {date(use.reservedAt)}</small>{use.confirmedAt && <small>Confirmed {date(use.confirmedAt)}</small>}{use.releasedAt && <small>Released {date(use.releasedAt)}</small>}{use.status === "held" && use.kind !== "daily_session" && use.paymentRequestId && <button disabled={busy} onClick={() => { setCloseReason(""); setMessage(""); setConfirm({ use, action: "close-purchase", title: "Close abandoned purchase?", text: "This permanently ends this unpaid membership purchase, blocks corrections, and releases its voucher reservation. Financial history is preserved." }); }}>Close abandoned request</button>}</td></tr>)}</tbody></table>}
      {message && <p role="status" className={styles.message}>{message}</p>}
      {detail.nextCursor && <button disabled={busy} onClick={() => void openDetails(detail.voucher, detail.nextCursor!)}>Load more uses</button>}
      <p className={styles.sub}>Held uses include rejected payments awaiting correction. Close abandoned membership requests in Payment review to release their capacity. Daily charges retain their discount until settlement.</p>
    </> : null}
    </SettingsDrawer>}
    {!editor && !detail && message && <p role="status" className={styles.message}>{message}</p>}
    {confirm && <SettingsConfirm title={confirm.title} busy={busy} confirmDisabled={confirm.action === "close-purchase" && !closeReason.trim()} label={confirm.action === "discard" ? "Discard changes" : "Confirm"} danger={!["resume"].includes(confirm.action)} onCancel={() => setConfirm(null)} onConfirm={() => void confirmAction()}><p>{confirm.text}</p>{confirm.action === "close-purchase" && <label>Reason (required)<textarea maxLength={500} value={closeReason} onChange={e => setCloseReason(e.target.value)} /></label>}{message && <p role="status">{message}</p>}</SettingsConfirm>}
  </section>;
}
