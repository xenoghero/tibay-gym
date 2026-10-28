"use client";
import { useState } from "react";
import Link from "next/link";
import { smsPhone } from "@/lib/sms/rules";
import type { SmsContact } from "@/lib/sms/contracts";
import styles from "./sms-view.module.css";
interface AudienceRow { id: string; name: string; phone: string; contact: SmsContact | null }
interface Preview { id: string; count: number; excluded: number; text: string; personIds: string[] }
interface CampaignSummary { id: string; text: string; count: number; dispatchRequestedAt: number | null }
interface Progress extends CampaignSummary { totals: Record<string, number>; recipients: Array<{ personId: string; status: string; errorCode: string | null; messageId: string | null }> }
export function SmsCampaigns({ contacts, request }: {
  contacts: AudienceRow[]; request: <T>(query?: string, body?: Record<string, unknown>) => Promise<T>;
}) {
  const [text, setText] = useState(""), [selected, setSelected] = useState<string[]>([]), [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]), [next, setNext] = useState<string | null>(null), [progress, setProgress] = useState<Progress | null>(null);
  const [attempts, setAttempts] = useState<unknown[]>([]);
  const eligible = contacts.filter(row => row.contact?.permission && !row.contact.optedOut && smsPhone(row.phone) === row.contact.phone);
  async function work(action: () => Promise<void>) {
    setBusy(true); setNotice("");
    try { await action(); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not complete the campaign action."); }
    finally { setBusy(false); }
  }
  async function loadCampaigns(after?: string) {
    const page = await request<{ campaigns: CampaignSummary[]; next: string | null }>(`?view=campaigns${after ? `&after=${after}` : ""}`);
    setCampaigns(after ? [...campaigns, ...page.campaigns] : page.campaigns); setNext(page.next);
  }
  return <section className="sms-campaigns"><div className={styles.kicker}>Compose / select recipients / review</div><h2>Create a campaign</h2><p>Select up to 100 consenting recipients. Load more customers in Contacts to expand the selection. Preview freezes the message and eligible audience; dispatch rechecks permission and number.</p>
    <form onSubmit={event => { event.preventDefault(); work(async () => { setConfirmed(false); setPreview(await request("", { action: "campaign-preview", text, personIds: selected })); }); }}>
      <label>Campaign message<textarea aria-label="Campaign message" required maxLength={480} disabled={busy} value={text} onChange={e => { setText(e.target.value); setPreview(null); setConfirmed(false); }} /><small>{text.length}/480 characters</small></label>
      <fieldset disabled={busy}><legend>Eligible recipients · {selected.length} selected</legend>
        {!eligible.length && <p>No eligible recipients in the loaded customer list.</p>}
        {eligible.map(row => <label key={row.id}><span><input type="checkbox" checked={selected.includes(row.id)} disabled={!selected.includes(row.id) && selected.length >= 100} onChange={e => {
          setSelected(e.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id)); setPreview(null); setConfirmed(false);
        }} /> {row.name} · {row.phone}</span></label>)}
      </fieldset><button className={styles.primary} disabled={busy || !text.trim() || !selected.length || selected.length > 100}>Preview campaign</button>
    </form>
    {preview && <div><h3>Review campaign</h3><p>{preview.text}</p><p>{preview.count} eligible recipients. {preview.excluded} selected recipients excluded. Preview expires after 30 minutes.</p>
      <ul aria-label="Reviewed campaign audience">{preview.personIds.map(id => <li key={id}><Link href={`/dashboard/people/${encodeURIComponent(id)}`}>{contacts.find(row => row.id === id)?.name ?? `Customer ${id}`}</Link></li>)}</ul>
      <label><span><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /> I reviewed this message and audience and want to queue this campaign.</span></label>
      <button className={styles.primary} disabled={busy || !confirmed} onClick={() => work(async () => { await request("", { action: "campaign-dispatch", campaignId: preview.id }); setConfirmed(false); setProgress(await request(`?view=campaign&id=${preview.id}`)); await loadCampaigns(); setNotice("Campaign queued. Sending requires enabled settings and a worker run."); })}>Queue campaign for {preview.count} recipients</button>
    </div>}
    {notice && <p role="status">{notice}</p>}
    <h3>Campaign history</h3><button disabled={busy} onClick={() => work(() => loadCampaigns())}>Refresh campaigns</button>
    {campaigns.map(campaign => <article key={campaign.id}><p>{campaign.text}</p><p>{campaign.count} recipients · {campaign.dispatchRequestedAt === null ? "Draft" : "Dispatch requested"}</p>
      {campaign.dispatchRequestedAt === null && <button disabled={busy} onClick={() => work(async () => { const saved = await request<Progress>(`?view=campaign&id=${campaign.id}`); setPreview({ id: saved.id, text: saved.text, count: saved.count, excluded: 0, personIds: saved.recipients.map(row => row.personId) }); setConfirmed(false); })}>Review saved draft</button>}
      <button disabled={busy} onClick={() => work(async () => { setProgress(await request(`?view=campaign&id=${campaign.id}`)); setAttempts([]); })}>View campaign {campaign.id.slice(0, 8)}</button></article>)}
    {next && <button disabled={busy} onClick={() => work(() => loadCampaigns(next))}>More campaigns</button>}
    {progress && <div><h3>Campaign progress</h3><p>{Object.entries(progress.totals).map(([status, count]) => `${status}: ${count}`).join(" · ")}</p>
      <button disabled={busy} onClick={() => work(async () => { setProgress(await request(`?view=campaign&id=${progress.id}`)); })}>Refresh progress</button>
      {progress.recipients.map(recipient => <div key={recipient.personId} className="rs-sms-contact"><span>{contacts.find(row => row.id === recipient.personId)?.name ?? recipient.personId} · {recipient.status} {recipient.errorCode ?? ""}</span>
        {recipient.messageId && <button disabled={busy} onClick={() => work(async () => { const evidence = await request<{ attempts: unknown[] }>(`?view=attempts&id=${recipient.messageId}`); setAttempts(evidence.attempts); })}>Recipient attempts</button>}
      </div>)}
      {attempts.length > 0 && <pre aria-label="Campaign recipient attempts">{JSON.stringify(attempts, null, 2)}</pre>}
    </div>}
  </section>;
}
