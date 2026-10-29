"use client";
import { useEffect, useRef, useState } from "react";
import type { SmsContact } from "@/lib/sms/contracts";
import { smsPhone } from "@/lib/sms/rules";
import styles from "./sms-view.module.css";
export interface AudienceRow { id: string; name: string; phone: string; contact: SmsContact | null }
export interface CampaignPreview { id: string; count: number; excluded: number; text: string; personIds: string[] }
export type SmsRequest = <T>(query?: string, body?: Record<string, unknown>) => Promise<T>;
interface CampaignSummary { id: string; text: string; count: number; createdAt: number; dispatchRequestedAt: number | null }
interface Progress extends CampaignSummary { totals: Record<string, number>; recipients: Array<{ personId: string; status: string; errorCode: string | null; messageId: string | null }> }
export function contactExclusion(row: AudienceRow) {
  if (row.contact?.optedOut) return "Opted out";
  if (!smsPhone(row.phone)) return "Invalid mobile number";
  if (!row.contact?.permission) return "No SMS permission";
  if (smsPhone(row.phone) !== row.contact.phone) return "Number changed";
  return null;
}
export function smsStatus(status: string) {
  return ({ queued: "Waiting to send", sending: "Sending", accepted: "Accepted by gateway", sent: "Sent by gateway", delivered: "Delivered", uncertain: "Delivery unconfirmed", failed: "Failed", cancelled: "Cancelled", removed: "Profile removed" } as Record<string, string>)[status] ?? status;
}
export function smsDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(timestamp);
}
export function SmsCampaigns({ contacts, request, hasMore = false, loadMore, onQueued, onHistory, onStart, initialPreview, active = true }: {
  contacts: AudienceRow[]; request: SmsRequest; hasMore?: boolean; loadMore?: () => Promise<void>;
  onQueued?: () => Promise<void>; onHistory?: (id: string) => void; onStart?: () => void; initialPreview?: CampaignPreview | null; active?: boolean;
}) {
  const [text, setText] = useState(initialPreview?.text ?? "");
  const [selected, setSelected] = useState<string[]>(initialPreview?.personIds ?? []);
  const [preview, setPreview] = useState<CampaignPreview | null>(initialPreview ?? null);
  const [step, setStep] = useState(initialPreview ? 3 : 1);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [search, setSearch] = useState(""), [queuedId, setQueuedId] = useState<string | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (active && document.activeElement?.getAttribute("role") !== "tab") title.current?.focus(); }, [step, queuedId, active]);
  const eligible = contacts.filter(row => !contactExclusion(row));
  const matches = (row: AudienceRow) => (row.name + " " + row.phone).toLowerCase().includes(search.trim().toLowerCase());
  const available = eligible.filter(matches);
  const validSelection = selected.length > 0 && selected.length <= 100 && selected.every(id => eligible.some(row => row.id === id));
  async function work(action: () => Promise<void>) {
    setBusy(true); setNotice("");
    try { await action(); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not complete this action. Please retry."); }
    finally { setBusy(false); }
  }
  function edit(next: number) { setPreview(null); setConfirmed(false); setStep(next); }
  if (queuedId) return <section className={styles.journey}>
    <h2 ref={title} tabIndex={-1}>Announcement queued</h2><p>The announcement is queued. Queueing alone does not send messages.</p>
    <p>Next: use <strong>Process queued messages</strong> below, then check delivery progress. Processing also handles other waiting messages.</p>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    <div className={styles.actions}><button onClick={() => onHistory?.(queuedId)}>View delivery progress</button>
      <button onClick={() => { onStart?.(); setQueuedId(null); setText(""); setSelected([]); setPreview(null); setConfirmed(false); setStep(1); }}>Create another announcement</button></div>
  </section>;
  return <section className={styles.journey} aria-busy={busy}>
    <ol className={styles.steps} aria-label="Announcement progress">{["Choose recipients", "Write message", "Review"].map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
    <h2 ref={title} tabIndex={-1}>Step {step} of 3 · {step === 1 ? "Choose recipients" : step === 2 ? "Write message" : "Review announcement"}</h2>
    {notice && <p role="alert" className={styles.notice}>{notice}</p>}
    {step === 1 && <>
      <p>Choose up to 100 people who have agreed to receive gym messages.</p>
      <label>Search recipients<input type="search" placeholder="Name or phone number" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <p className={styles.selectionSummary}>{selected.length} selected · {eligible.length} eligible among {contacts.length} loaded contacts</p>
      <fieldset disabled={busy} aria-label="Eligible recipients" className={styles.recipientList}>
        {!available.length && <p>{eligible.length ? "No matching eligible recipients. Try another search." : "No eligible recipients in the loaded customer list."}</p>}
        {available.map(row => <label key={row.id} className={styles.recipient}><input type="checkbox" checked={selected.includes(row.id)} disabled={!selected.includes(row.id) && selected.length >= 100}
          onChange={event => { setSelected(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id)); setPreview(null); setConfirmed(false); }} /><span><strong>{row.name}</strong><small>{row.phone}</small></span></label>)}
      </fieldset>
      {selected.length >= 100 && <p>You reached the 100-recipient limit.</p>}
      {!validSelection && selected.length > 0 && <p role="status">A selected contact is no longer eligible. Remove them before continuing.</p>}
      {selected.filter(id => !eligible.some(row => row.id === id)).map(id => <button key={id} onClick={() => setSelected(selected.filter(value => value !== id))}>Remove {contacts.find(row => row.id === id)?.name ?? "unavailable contact"}</button>)}
      {hasMore && <button disabled={busy} onClick={() => work(async () => { await loadMore?.(); })}>{busy ? "Loading…" : "Load more recipients"}</button>}
      <details><summary>Why some contacts cannot be selected ({contacts.length - eligible.length})</summary><p>Manage permission in Contacts. Only eligible contacts can be selected.</p>
        {contacts.filter(row => contactExclusion(row) && matches(row)).map(row => <div className={styles.excludedRow} key={row.id}><strong>{row.name}</strong><span>{contactExclusion(row)}</span></div>)}</details>
    </>}
    {step === 2 && <>
      <div className={styles.selectionSummary}>{selected.length} recipients selected <button disabled={busy} onClick={() => edit(1)}>Edit recipients</button></div>
      <label>Announcement message<textarea aria-label="Campaign message" required maxLength={480} disabled={busy} value={text} onChange={event => { setText(event.target.value); setPreview(null); setConfirmed(false); }} /><small>{text.length}/480 characters · Include how to stop receiving messages.</small></label>
    </>}
    {step === 3 && preview && <>
      <p className={styles.messagePreview}>{preview.text}</p><button disabled={busy} onClick={() => edit(2)}>Edit message</button>
      <p>{preview.count} eligible recipients · {preview.excluded} excluded during review. This preview expires after 30 minutes.</p>
      <details><summary>View reviewed recipients ({preview.count})</summary><ul>{preview.personIds.map(id => <li key={id}>{contacts.find(row => row.id === id)?.name ?? "Previously reviewed customer"}</li>)}</ul></details>
      <label className={styles.checkbox}><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>I reviewed this message and audience and want to queue this announcement.</span></label>
      <p>Permission and phone numbers are checked again when queueing. Messages must then be processed to send.</p>
    </>}
    <div className={styles.journeyBar}>
      <span>{step === 3 ? preview?.count ?? 0 : selected.length} recipients {step === 3 ? "reviewed" : "selected"}</span>
      <div className={styles.actions}>
        {step > 1 && <button disabled={busy} onClick={() => edit(step - 1)}>Back</button>}
        {step === 1 && <button className={styles.primary} disabled={busy || !validSelection} onClick={() => setStep(2)}>Continue to message</button>}
        {step === 2 && <button className={styles.primary} disabled={busy || !text.trim() || !validSelection} onClick={() => work(async () => { setConfirmed(false); setPreview(await request("", { action: "campaign-preview", text, personIds: selected })); setStep(3); })}>{busy ? "Preparing review…" : "Review announcement"}</button>}
        {step === 3 && preview && <button className={styles.primary} disabled={busy || !confirmed || !preview.count} onClick={() => work(async () => {
          await request("", { action: "campaign-dispatch", campaignId: preview.id }); setConfirmed(false); setQueuedId(preview.id); await onQueued?.();
        })}>{busy ? "Queueing…" : "Queue " + preview.count + (preview.count === 1 ? " message" : " messages")}</button>}
      </div>
    </div>
  </section>;
}
export function SmsCampaignHistory({ contacts, request, active, selectedId, selectionVersion = 0, onReview }: {
  contacts: AudienceRow[]; request: SmsRequest; active: boolean; selectedId: string | null; selectionVersion?: number; onReview: (preview: CampaignPreview) => void;
}) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]), [next, setNext] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [attempts, setAttempts] = useState<{ id: string; rows: unknown[] } | null>(null);
  const detailTitle = useRef<HTMLHeadingElement>(null);
  const progressId = progress?.id;
  useEffect(() => { if (active && progressId && document.activeElement?.getAttribute("role") !== "tab") detailTitle.current?.focus(); }, [progressId, active]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    async function load() {
      setBusy(true); setNotice("");
      try {
        const page = await request<{ campaigns: CampaignSummary[]; next: string | null }>("?view=campaigns");
        if (current) { setCampaigns(page.campaigns); setNext(page.next); }
        if (selectedId) { const detail = await request<Progress>("?view=campaign&id=" + encodeURIComponent(selectedId)); if (current) { setProgress(detail); setAttempts(null); } }
      } catch (error) { if (current) setNotice(error instanceof Error ? error.message : "Could not load announcements."); }
      finally { if (current) setBusy(false); }
    }
    void load(); return () => { current = false; };
  }, [active, selectedId, selectionVersion, request]);
  async function work(action: () => Promise<void>) { setBusy(true); setNotice(""); try { await action(); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load history."); } finally { setBusy(false); } }
  async function loadPage(after?: string) {
    const page = await request<{ campaigns: CampaignSummary[]; next: string | null }>("?view=campaigns" + (after ? "&after=" + encodeURIComponent(after) : ""));
    setCampaigns(after ? [...campaigns, ...page.campaigns] : page.campaigns); setNext(page.next);
  }
  return <section aria-label="Announcement history" aria-busy={busy}>
    <div className={styles.sectionHead}><h2>Announcements & saved drafts</h2><button disabled={busy} onClick={() => work(() => loadPage())}>Refresh announcements</button></div>
    {notice && <p role="alert" className={styles.notice}>{notice}</p>}
    {!busy && !campaigns.length && !notice && <p>No announcements yet. Create one from Messages.</p>}
    {campaigns.map(campaign => <article className={styles.historyRow} key={campaign.id}>
      <div><strong className={styles.truncate}>{campaign.text}</strong><span className={styles.meta}>{smsDate(campaign.createdAt)} · {campaign.count} recipients · {campaign.dispatchRequestedAt === null ? "Saved draft" : "Queue requested"}</span></div>
      <button disabled={busy} onClick={() => work(async () => { setProgress(await request("?view=campaign&id=" + encodeURIComponent(campaign.id))); setAttempts(null); })}>View details<span className={styles.srOnly}> for {campaign.text}</span></button>
    </article>)}
    {next && <button disabled={busy} onClick={() => work(() => loadPage(next))}>Load more announcements</button>}
    {progress && <section className={styles.panel} aria-label="Announcement details">
      <div className={styles.sectionHead}><h3 ref={detailTitle} tabIndex={-1}>Announcement details</h3><button onClick={() => { setProgress(null); setAttempts(null); }}>Close details</button></div>
      <p className={styles.messagePreview}>{progress.text}</p>
      <p>{Object.entries(progress.totals).map(([status, count]) => smsStatus(status) + ": " + count).join(" · ") || "No delivery results yet."}</p>
      <p>Accepted and sent statuses do not confirm delivery. Times are Philippine time.</p>
      <div className={styles.actions}><button disabled={busy} onClick={() => work(async () => { setProgress(await request("?view=campaign&id=" + encodeURIComponent(progress.id))); })}>Refresh delivery progress</button>
        {progress.dispatchRequestedAt === null && <button disabled={busy} onClick={() => onReview({ id: progress.id, text: progress.text, count: progress.count, excluded: 0, personIds: progress.recipients.map(row => row.personId) })}>Review saved draft</button>}</div>
      {progress.recipients.map(recipient => <details key={recipient.personId}><summary>{contacts.find(row => row.id === recipient.personId)?.name ?? "Customer profile unavailable"} · {smsStatus(recipient.status)}</summary>
        {recipient.errorCode && <p>{recipient.errorCode}</p>}
        {recipient.messageId && <details><summary>Technical details</summary><button disabled={busy} onClick={() => work(async () => { const result = await request<{ attempts: unknown[] }>("?view=attempts&id=" + encodeURIComponent(recipient.messageId!)); setAttempts({ id: recipient.messageId!, rows: result.attempts }); })}>Load delivery attempts</button>
          {attempts?.id === recipient.messageId && <pre>{JSON.stringify(attempts.rows, null, 2)}</pre>}</details>}
      </details>)}
    </section>}
  </section>;
}
