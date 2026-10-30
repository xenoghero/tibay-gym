"use client";

import { FormInput } from "@/components/ui/form-input";

import { useContentTransition } from "@/lib/use-content-transition";

import { LoadingSkeleton } from "@/components/ui/skeleton";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import type { SmsContact, SmsMessage, SmsSettings } from "@/lib/sms/contracts";
import { SmsCampaigns, SmsCampaignHistory, contactExclusion, smsDate, smsStatus, type CampaignPreview } from "./sms-campaigns";

import styles from "./sms-view.module.css";
const tabs = ["Messages", "History", "Contacts"] as const;
type Tab = typeof tabs[number] | "Settings";
function permissionStatus(row: ContactRow) { return contactExclusion(row) ?? "Permission recorded"; }
interface ContactRow { id: string; name: string; phone: string; contact: SmsContact | null }
interface SmsData { settings: SmsSettings; configured: boolean; messages: SmsMessage[]; next: string | null }
export function SmsView() {
  const { user } = useAuth();
  const [data, setData] = useState<SmsData | null>(null), [settings, setSettings] = useState<SmsSettings | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]), [contactNext, setContactNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [personId, setPersonId] = useState(""), [testText, setTestText] = useState("Tibay Gym: This is your requested SMS delivery test.");
  const [attempts, setAttempts] = useState<unknown[]>([]);
  const [reminderPreview, setReminderPreview] = useState<{ examined: number; due: number; next: string | null } | null>(null);
  const contactCursors = useRef<string[]>([""]);
  const operations = useRef(new Map<string, string>());
  const [tab, setTab] = useState<Tab>("Messages");
  const [journey, setJourney] = useState<"home" | "announcement" | "reminders">("home");
  const [historySelectionVersion, setHistorySelectionVersion] = useState(0);
  const [historyCampaignId, setHistoryCampaignId] = useState<string | null>(null);
  const [recoveredDraft, setRecoveredDraft] = useState<CampaignPreview | null>(null);
  const [draftVersion, setDraftVersion] = useState(0);
  const [historySearch, setHistorySearch] = useState(""), [historyStatus, setHistoryStatus] = useState("all");
  const [announcementQueued, setAnnouncementQueued] = useState(false);
  const [remindersQueued, setRemindersQueued] = useState(false), [processed, setProcessed] = useState(false);
  const journeyTitle = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (tab === "Messages" && journey !== "announcement" && document.activeElement?.getAttribute("role") !== "tab") journeyTitle.current?.focus(); }, [journey, tab]);
  const [search, setSearch] = useState("");
  const [permissionFilter, setPermissionFilter] = useState("all");
  const [attemptMessageId, setAttemptMessageId] = useState<string | null>(null);
  const dirty = !!data && !!settings && JSON.stringify(settings) !== JSON.stringify(data.settings);
  const eligibleCount = contacts.filter(row => permissionStatus(row) === "Permission recorded").length;
  const filteredContacts = contacts.filter(row =>
    `${row.name} ${row.phone}`.toLowerCase().includes(search.trim().toLowerCase()) &&
    (permissionFilter === "all" || (permissionFilter === "eligible" ? permissionStatus(row) === "Permission recorded" : permissionStatus(row) !== "Permission recorded")));
  const filteredMessages = [...(data?.messages ?? [])].sort((a, b) => b.createdAt - a.createdAt).filter(message =>
    (historyStatus === "all" || message.status === historyStatus) &&
    (message.text + " " + message.destination + " " + (contacts.find(row => row.id === message.personId)?.name ?? "")).toLowerCase().includes(historySearch.trim().toLowerCase()));
  function selectTab(next: Tab, focus = false) {
    setTab(next);
    if (focus) document.getElementById(`sms-tab-${next}`)?.focus();
  }
  const api = useCallback(async <T,>(query = "", body?: Record<string, unknown>): Promise<T> => {
    const token = await user?.getIdToken(); if (!token) throw new Error("Sign in again.");
    const key = JSON.stringify(body);
    if (body && !operations.current.has(key)) operations.current.set(key, crypto.randomUUID());
    const response = await fetch(`/api/sms/admin${query}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify({ ...body, operationId: operations.current.get(key) }) } : {}) });
    const result = await response.json();
    if (!response.ok) { if (response.status < 500) operations.current.delete(key); throw new Error(result.error ?? "Request failed"); }
    operations.current.delete(key); return result as T;
  }, [user]);
  async function load() {
    const [next, pages] = await Promise.all([api<SmsData>(), Promise.all(contactCursors.current.map(cursor =>
      api<{ contacts: ContactRow[]; next: string | null }>("?view=contacts" + (cursor ? "&after=" + encodeURIComponent(cursor) : ""))))]);
    setData(next);
    setSettings(current => current && data && JSON.stringify(current) !== JSON.stringify(data.settings) ? current : next.settings);
    setContacts([...new Map(pages.flatMap(page => page.contacts).map(row => [row.id, row])).values()]);
    setContactNext(pages.at(-1)?.next ?? null);
  }
  async function loadMoreContacts() {
    if (!contactNext) return;
    const cursor = contactNext;
    const page = await api<{ contacts: ContactRow[]; next: string | null }>("?view=contacts&after=" + encodeURIComponent(cursor));
    if (!contactCursors.current.includes(cursor)) contactCursors.current.push(cursor);
    setContacts(current => [...new Map([...current, ...page.contacts].map(row => [row.id, row])).values()]); setContactNext(page.next);
  }
  function showHistory(id: string | null = null) { setHistoryCampaignId(id); setHistorySelectionVersion(value => value + 1); selectTab("History", id === null); }

  useEffect(() => {
    let active = true;
    if (user) {
      const headers = async () => ({ Authorization: `Bearer ${await user.getIdToken()}` });
      Promise.all([headers().then(h => fetch("/api/sms/admin", { headers: h })), headers().then(h => fetch("/api/sms/admin?view=contacts", { headers: h }))])
        .then(async ([a, b]) => { if (!a.ok || !b.ok) throw new Error("Could not load SMS. Use Refresh to retry."); return [await a.json(), await b.json()]; })
        .then(([next, people]) => { if (active) { setData(next); setSettings(next.settings); setContacts(people.contacts); setContactNext(people.next); } })
        .catch(error => { if (active) setNotice(error.message); });
    }
    return () => { active = false; };
  }, [user]);
  async function act(work: () => Promise<void>) {
    setBusy(true); setNotice("");
    try { await work(); } catch (error) { setNotice(error instanceof Error ? error.message : "Request failed. Retry safely."); }
    finally { setBusy(false); }
  }
  const tabContent = useRef<HTMLDivElement>(null);
  useContentTransition(tabContent, `${tab}:${journey}`);
  return <main className={styles.root}>
    <header className={styles.header}>
      <div><div className={styles.kicker}>Member communications</div><h1>SMS operations</h1></div>
      <div className={styles.actions}><button id="sms-tab-Settings" aria-label="Settings" aria-expanded={tab === "Settings"} aria-controls="sms-panel-Settings" onClick={() => selectTab("Settings")}>Settings{dirty && <span className={styles.unsavedDot} aria-label="Unsaved changes" />}</button>
      <button disabled={busy} onClick={() => act(load)} aria-label="Refresh">{busy ? "Working…" : "Refresh"}<span aria-hidden="true"> ↻</span></button></div>
    </header>
    <nav className={styles.tabs} role="tablist" aria-label="SMS workspace">
      {tabs.map((item, index) => <button key={item} id={`sms-tab-${item}`} role="tab" aria-label={item} aria-selected={tab === item} aria-controls={`sms-panel-${item}`} tabIndex={tab === item || (tab === "Settings" && index === 0) ? 0 : -1}
        onClick={() => selectTab(item)} onKeyDown={event => {
          let next = index;
          if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
          else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = tabs.length - 1;
          else return;
          event.preventDefault(); selectTab(tabs[next], true);
        }}>{item}</button>)}
    </nav>
    <div ref={tabContent} className={styles.content}>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {!data || !settings ? notice ? <div className={styles.empty}><h2>SMS workspace unavailable</h2><p>Use Refresh to try loading again.</p></div> : <LoadingSkeleton label="Loading SMS workspace…" variant={tab === "Settings" ? "form" : "cards"} /> : <>
        <aside className={styles.gateway} data-ready={data.configured && data.settings.enabled} aria-label="Sending status">
          <span className={styles.statusDot} data-ready={data.configured && data.settings.enabled} />
          <div><strong>{!data.configured ? "Sending disabled — gateway setup required" : data.settings.enabled ? "SMS sending enabled" : "SMS sending paused"}</strong>
          <p>{!data.configured ? "Ask the system administrator to finish gateway setup." : "Queue messages first, then process them to send."}</p></div>
          {tab !== "Settings" && (!data.configured || !data.settings.enabled) && <button onClick={() => selectTab("Settings", true)}>View settings <span aria-hidden="true">↗</span></button>}
        </aside>
        <div id="sms-panel-Messages" role="tabpanel" aria-labelledby="sms-tab-Messages" hidden={tab !== "Messages"} tabIndex={0}>
          {journey !== "home" && <button aria-label="Back to messages" className={styles.backLink} onClick={() => setJourney("home")}>← Back to messages</button>}
          {journey === "home" && <>
            <div className={styles.intro}><h2 ref={journeyTitle} tabIndex={-1}>What would you like to do?</h2><p>Start a message, review reminders, or check what happened after sending.</p></div>
            <div className={styles.startGrid}>
              <section className={styles.startAction}><span className={styles.kicker}>Announcement</span><h3>Share an update with members</h3><p>Choose recipients, write your message, then review before queueing.</p><button className={styles.primary} onClick={() => setJourney("announcement")}>Send an announcement</button></section>
              <section className={styles.startAction}><span className={styles.kicker}>Reminders</span><h3>Check who is due a reminder</h3><p>Review membership expiry and inactivity reminders. Checks are run manually.</p><button onClick={() => setJourney("reminders")}>Review due reminders</button></section>
            </div>
          </>}
          <div hidden={journey !== "announcement"}>
            <SmsCampaigns key={draftVersion} contacts={contacts} request={api} hasMore={!!contactNext} loadMore={loadMoreContacts} onQueued={async () => { setAnnouncementQueued(true); setProcessed(false); await load(); }} onHistory={showHistory} onStart={() => setAnnouncementQueued(false)} initialPreview={recoveredDraft} active={tab === "Messages" && journey === "announcement"} />
          </div>
          {journey === "reminders" && <section className={styles.journey}>
            <div className={styles.kicker}>Check → Review → Queue → Process → Results</div>
            <h2 ref={journeyTitle} tabIndex={-1}>Review due reminders</h2>
            <p>Expiry reminders: 7, 5 and 1 day before expiry. Inactivity: more than 10 days since a visit, once per visit episode. Members without visits are excluded.</p>
            <p>Checks respect {data.settings.sendTime} Philippine time. No unattended schedule is active.</p>
            {!reminderPreview ? <button className={styles.primary} disabled={busy} onClick={() => act(async () => { setReminderPreview(await api("?view=reminders")); setRemindersQueued(false); })}>Check due reminders</button> : <>
              <div className={styles.notice} role="status"><strong>{reminderPreview.due} eligible reminders found</strong><p>Across {reminderPreview.examined} checked profiles{reminderPreview.next ? " · More profiles available" : ""}. Checking does not queue or send messages.</p></div>
              <details><summary>Review reminder messages</summary><h3>Membership expiry</h3><p>{data.settings.expiryTemplate}</p><h3>Inactivity</h3><p>{data.settings.inactivityTemplate}</p><p>These are your saved templates. Dates and days are filled in for expiry messages.</p></details>
              <div className={styles.actions}>
                {reminderPreview.next && <button disabled={busy} onClick={() => act(async () => { const page = await api<{ examined: number; due: number; next: string | null }>("?view=reminders&after=" + encodeURIComponent(reminderPreview.next!)); setReminderPreview({ ...page, examined: reminderPreview.examined + page.examined, due: reminderPreview.due + page.due }); })}>Check more profiles</button>}
                <button disabled={busy} onClick={() => act(async () => { setReminderPreview(await api("?view=reminders")); setRemindersQueued(false); })}>Check again</button>
              </div>
              <p>Queueing checks the next batch of up to 50 profiles and rechecks eligibility. This batch may differ from the preview. Repeat for larger rosters.</p>
              <button className={styles.primary} disabled={busy || !data.configured || !data.settings.enabled} onClick={() => act(async () => {
                const result = await api<{ disabled: boolean; examined: number; queued: number }>("", { action: "reminders" });
                setRemindersQueued(!result.disabled); setProcessed(false); await load();
                setNotice(result.disabled ? "Reminder queueing is paused or unconfigured." : "Checked " + result.examined + " profiles; queued " + result.queued + " reminders. Next: process queued messages below.");
              })}>Queue next reminder batch</button>
              {(!data.configured || !data.settings.enabled) && <p>Sending must be enabled before reminders can be queued. <button onClick={() => selectTab("Settings")}>Open settings</button></p>}
              {remindersQueued && <p>Batch checked. Process queued messages below, or queue the next batch to cover more members.</p>}
            </>}
          </section>}
          {(journey === "home" || (journey === "announcement" && announcementQueued) || (journey === "reminders" && remindersQueued)) && <section className={styles.queuePanel} aria-label="Queue processing">
            <div><h2>Waiting to send</h2><p>{data.messages.filter(message => message.status === "queued").length} waiting in {data.messages.length} loaded message records. More records may exist.</p><p>Process queued messages to send and update delivery results. Each run handles a limited batch; repeat for larger queues.</p></div>
            <div><button className={styles.primary} disabled={busy || !data.configured || !data.settings.enabled} onClick={() => act(async () => {
              const result = await api<{ disabled: boolean; processed: number }>("", { action: "worker" }); await load(); setProcessed(!result.disabled);
              setNotice(result.disabled ? "Sending is paused or unconfigured." : "Processed " + result.processed + " messages. Check delivery results; another run may be needed.");
            })}>{busy ? "Working…" : "Process queued messages"}</button>
            {(!data.configured || !data.settings.enabled) && <p>Sending is paused or setup is incomplete. <button onClick={() => selectTab("Settings")}>Open settings</button></p>}
            {processed && <button onClick={() => showHistory()}>View delivery results</button>}</div>
          </section>}
          {journey === "home" && <section className={styles.history}>
            <div className={styles.sectionHead}><h2>Recent results</h2><button onClick={() => showHistory()}>View all history</button></div>
            {!data.messages.length && <p>No messages queued yet. Start with an announcement or check due reminders.</p>}
            {[...data.messages].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3).map(message => <article key={message.id} className={styles.historyRow}><div><strong className={styles.truncate}>{message.text}</strong><span className={styles.meta}>{smsDate(message.createdAt)} · {message.destination}</span></div><span className={styles.badge} data-status={message.status}>{smsStatus(message.status)}</span></article>)}
            {!!data.messages.length && <p className={styles.meta}>Latest among loaded records · Philippine time</p>}
          </section>}
        </div>
        <div id="sms-panel-History" role="tabpanel" aria-labelledby="sms-tab-History" hidden={tab !== "History"} tabIndex={0}>
          <SmsCampaignHistory contacts={contacts} request={api} active={tab === "History"} selectedId={historyCampaignId} selectionVersion={historySelectionVersion} onReview={preview => { setAnnouncementQueued(false); setRecoveredDraft(preview); setDraftVersion(value => value + 1); setJourney("announcement"); selectTab("Messages"); }} />
          <section className={styles.history} aria-label="Individual message history">
            <div className={styles.sectionHead}><div><h2>Individual messages</h2><p>Announcements, reminders and requested tests · Philippine time</p></div><span className={styles.badge}>{data.messages.length} loaded</span></div>
            <div className={styles.filters}><label>Search loaded messages<input type="search" value={historySearch} placeholder="Name, phone or message" onChange={event => setHistorySearch(event.target.value)} /></label><label>Delivery status<select value={historyStatus} onChange={event => setHistoryStatus(event.target.value)}><option value="all">All statuses</option>{["queued", "sending", "accepted", "sent", "delivered", "uncertain", "failed", "cancelled"].map(status => <option key={status} value={status}>{smsStatus(status)}</option>)}</select></label></div>
            <p>Accepted by gateway and sent by gateway do not confirm delivery. Only “Delivered” confirms a delivery report.</p>
            {!data.messages.length && <p>No messages queued yet.</p>}
            {!!data.messages.length && !filteredMessages.length && <p>No matching loaded messages. Change the filters or load more history.</p>}
            {filteredMessages.map(message => <details key={message.id} className={styles.message}>
              <summary className={styles.historyRow}><span><strong>{contacts.find(row => row.id === message.personId)?.name ?? message.destination}</strong><span className={styles.meta}>{smsDate(message.createdAt)} · {message.purpose === "blast" ? "Announcement" : message.purpose === "expiry" ? "Expiry reminder" : message.purpose === "inactivity" ? "Inactivity reminder" : "Requested test"}</span></span><span className={styles.badge} data-status={message.status}>{smsStatus(message.status)}</span></summary>
              <p className={styles.messagePreview}>{message.text}</p><p>{message.destination}</p>
              {message.campaignId && <button onClick={() => showHistory(message.campaignId)}>View announcement progress</button>}
              <details><summary>Technical details</summary><p>{message.attempts} attempts · {message.providerState ?? message.errorCode ?? "Awaiting processing"}</p>
                <button disabled={busy} onClick={() => act(async () => { const result = await api<{ attempts: unknown[] }>("?view=attempts&id=" + encodeURIComponent(message.id)); setAttempts(result.attempts); setAttemptMessageId(message.id); })}>Load delivery attempts</button>
                {attemptMessageId === message.id && <pre aria-label="Provider attempts">{JSON.stringify(attempts, null, 2)}</pre>}
              </details>
            </details>)}
            {data.next && <button disabled={busy} onClick={() => act(async () => { const page = await api<SmsData>("?after=" + encodeURIComponent(data.next!)); setData({ ...page, messages: [...data.messages, ...page.messages] }); })}>Load more message history</button>}
          </section>
        </div>
        <div id="sms-panel-Contacts" role="tabpanel" aria-labelledby="sms-tab-Contacts" hidden={tab !== "Contacts"} tabIndex={0}>
          <section><div className={styles.sectionHead}><div><h2>Contact permission</h2><p>{eligibleCount} eligible · {contacts.length} customers loaded{contactNext ? " · More customers available" : ""}</p></div></div>
            <p>Record permission only after the customer agrees to reminders and gym messages. Opt out immediately on request. A changed number requires new permission.</p>
            <div className={styles.filters}><label>Search loaded contacts<input type="search" placeholder="Search name or phone…" value={search} onChange={event => setSearch(event.target.value)} /></label><label>Permission status<select value={permissionFilter} onChange={event => setPermissionFilter(event.target.value)}><option value="all">All contacts</option><option value="eligible">Eligible to receive</option><option value="excluded">Excluded from sending</option></select></label></div>
            <div className={styles.contactHeader} aria-hidden="true"><span>Customer</span><span>Permission</span><span>Actions</span></div>
            {contacts.length === 0 ? <div className={styles.empty}><h3>No official customer profiles.</h3><p>Customer profiles will appear here so you can record their SMS permission.</p></div> : filteredContacts.length === 0 ? <div className={styles.empty}><h3>No matching loaded contacts</h3><p>Try another name or phone number, or change the permission filter.</p></div> : filteredContacts.map(row => <article key={row.id} className={styles.contact}>
              <div><strong>{row.name}</strong><div className={styles.meta}>{row.phone || "No phone number"}</div></div><span className={styles.badge} data-status={permissionStatus(row) === "Permission recorded" ? "accepted" : "excluded"}>{permissionStatus(row)}</span>
              <div className={styles.actions}><button aria-label={`Record customer’s permission for ${row.name}`} disabled={busy || permissionStatus(row) === "Permission recorded"} onClick={() => act(async () => { await api("", { action: "contact", personId: row.id, permission: true, optedOut: false, revision: row.contact?.revision ?? 0 }); await load(); setNotice("Customer permission recorded."); })}>Record permission</button>
              <button aria-label={`Opt out ${row.name}`} disabled={busy || !!row.contact?.optedOut} onClick={() => act(async () => { await api("", { action: "contact", personId: row.id, permission: false, optedOut: true, revision: row.contact?.revision ?? 0 }); await load(); setNotice("Customer excluded from future sends."); })}>Opt out</button></div>
            </article>)}
            {contactNext && <button disabled={busy} onClick={() => act(loadMoreContacts)}>More customers</button>}
          </section>
        </div>
        <div id="sms-panel-Settings" role="region" aria-labelledby="sms-tab-Settings" hidden={tab !== "Settings"} tabIndex={0}>
          <form onSubmit={event => { event.preventDefault(); act(async () => { const saved = await api<SmsSettings>("", { action: "settings", ...settings }); setSettings(saved); setData({ ...data, settings: saved }); setNotice("SMS settings saved."); }); }}>
            <fieldset disabled={busy} className={styles.settingsFields}>
              <section className={styles.panel}><div className={styles.kicker}>01 / Activation</div><h2>Sending settings</h2><p>Android SMS Gateway uses the sending SIM’s number and credit or approved plan.</p>
                <label className={styles.checkbox}><input type="checkbox" aria-label="Enable sending" checked={settings.enabled} disabled={!data.configured || busy} onChange={e => setSettings({ ...settings, enabled: e.target.checked })} /><span><strong>Enable sending</strong><small>{data.configured ? "Allow the worker to send queued messages." : "Unavailable until gateway credentials are configured on the server."}</small></span></label>
                <label className={styles.checkbox}><input type="checkbox" checked={settings.policyConfirmed} onChange={e => setSettings({ ...settings, policyConfirmed: e.target.checked })} /><span>I confirmed the sending SIM, funding, templates, permission collection and opt-out process before activation.</span></label>
              </section>
              <section className={styles.panel}><div className={styles.kicker}>02 / Schedule</div><h2>Timing & retries</h2><div className={styles.fieldGrid}>
                <label>Daily sending time (Asia/Manila)<FormInput type="time" required value={settings.sendTime} onChange={e => setSettings({ ...settings, sendTime: e.target.value })} /></label>
                <label>Maximum attempts<select aria-label="Maximum attempts" required value={settings.maxAttempts} onChange={e => setSettings({ ...settings, maxAttempts: Number(e.target.value) })}>{[1, 2, 3].map(count => <option key={count} value={count}>{count}</option>)}</select><small>Only explicit rate-limit rejections retry. Maximum 3 attempts.</small></label>
              </div></section>
              <section className={`${styles.panel} ${styles.wide}`}><div className={styles.kicker}>03 / Message templates</div><h2>Reminder messages</h2><p>Keep messages clear and include the opt-out instructions.</p><div className={styles.fieldGrid}>
                <label>Expiry template<textarea aria-label="Expiry template" required maxLength={480} value={settings.expiryTemplate} onChange={e => setSettings({ ...settings, expiryTemplate: e.target.value })} /><small>Available tokens: {"{expiry}"}, {"{days}"} · {settings.expiryTemplate.length}/480 characters</small></label>
                <label>Inactivity template<textarea aria-label="Inactivity template" required maxLength={480} value={settings.inactivityTemplate} onChange={e => setSettings({ ...settings, inactivityTemplate: e.target.value })} /><small>{settings.inactivityTemplate.length}/480 characters</small></label>
              </div></section>
            </fieldset>
            {dirty && <div className={styles.savebar}><span>You have unsaved changes</span><div className={styles.actions}>{dirty && <button type="button" disabled={busy} onClick={() => setSettings(data.settings)}>Discard changes</button>}<button className={styles.primary} disabled={busy || !dirty}>Save SMS settings</button></div></div>}
          </form>
          <section className={styles.panel}><div className={styles.kicker}>Delivery check</div><h2>Test delivery</h2><p>Select a customer who requested this test. Queueing does not send until sending is enabled and a worker runs.</p>
            <form onSubmit={event => { event.preventDefault(); act(async () => { await api("", { action: "test", personId, text: testText }); await load(); setNotice("Test queued. Open Messages and process the queue when ready."); }); }}>
              <fieldset disabled={busy}><label>Test recipient<select required value={personId} onChange={e => setPersonId(e.target.value)}><option value="">Choose customer</option>{contacts.filter(row => !contactExclusion(row)).map(row => <option key={row.id} value={row.id}>{row.name} · {row.phone}</option>)}</select></label>
              <label>Test message<textarea required maxLength={480} value={testText} onChange={e => setTestText(e.target.value)} /></label></fieldset><div className={styles.actions}><button disabled={busy}>Queue requested test</button><button type="button" onClick={() => selectTab("Messages", true)}>Go to message processing</button></div>
            </form>
          </section>
        </div>
      </>}
    </div>
  </main>;
}
