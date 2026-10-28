"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import type { SmsContact, SmsMessage, SmsSettings } from "@/lib/sms/contracts";
import { SmsCampaigns } from "./sms-campaigns";
import { smsPhone } from "@/lib/sms/rules";
import styles from "./sms-view.module.css";
const tabs = ["Activity", "Campaigns", "Contacts", "Settings"] as const;
type Tab = typeof tabs[number];
function permissionStatus(row: ContactRow) {
  if (row.contact?.optedOut) return "Opted out";
  if (!row.contact?.permission) return "No permission";
  if (smsPhone(row.phone) !== row.contact.phone) return "Number changed";
  return "Permission recorded";
}
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
  const operations = useRef(new Map<string, string>());
  const [tab, setTab] = useState<Tab>("Activity");
  const [search, setSearch] = useState("");
  const [permissionFilter, setPermissionFilter] = useState("all");
  const [attemptMessageId, setAttemptMessageId] = useState<string | null>(null);
  const dirty = !!data && !!settings && JSON.stringify(settings) !== JSON.stringify(data.settings);
  const eligibleCount = contacts.filter(row => permissionStatus(row) === "Permission recorded").length;
  const filteredContacts = contacts.filter(row =>
    `${row.name} ${row.phone}`.toLowerCase().includes(search.trim().toLowerCase()) &&
    (permissionFilter === "all" || (permissionFilter === "eligible" ? permissionStatus(row) === "Permission recorded" : permissionStatus(row) !== "Permission recorded")));
  function selectTab(next: Tab, focus = false) {
    setTab(next);
    if (focus) document.getElementById(`sms-tab-${next}`)?.focus();
  }
  async function api<T>(query = "", body?: Record<string, unknown>): Promise<T> {
    const token = await user?.getIdToken(); if (!token) throw new Error("Sign in again.");
    const key = JSON.stringify(body);
    if (body && !operations.current.has(key)) operations.current.set(key, crypto.randomUUID());
    const response = await fetch(`/api/sms/admin${query}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify({ ...body, operationId: operations.current.get(key) }) } : {}) });
    const result = await response.json();
    if (!response.ok) { if (response.status < 500) operations.current.delete(key); throw new Error(result.error ?? "Request failed"); }
    operations.current.delete(key); return result as T;
  }
  async function load() {
    const [next, people] = await Promise.all([api<SmsData>(), api<{ contacts: ContactRow[]; next: string | null }>("?view=contacts")]);
    setData(next); setSettings(current => current && data && JSON.stringify(current) !== JSON.stringify(data.settings) ? current : next.settings); setContacts(people.contacts); setContactNext(people.next);
  }
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
  return <main className={styles.root}>
    <header className={styles.header}>
      <div><div className={styles.kicker}>Member communications</div><h1>SMS operations</h1></div>
      <button disabled={busy} onClick={() => act(load)} aria-label="Refresh">{busy ? "Working…" : "Refresh"}<span aria-hidden="true"> ↻</span></button>
    </header>
    <nav className={styles.tabs} role="tablist" aria-label="SMS workspace">
      {tabs.map((item, index) => <button key={item} id={`sms-tab-${item}`} role="tab" aria-label={item} aria-selected={tab === item} aria-controls={`sms-panel-${item}`} tabIndex={tab === item ? 0 : -1}
        onClick={() => selectTab(item)} onKeyDown={event => {
          let next = index;
          if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
          else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = tabs.length - 1;
          else return;
          event.preventDefault(); selectTab(tabs[next], true);
        }}>{item}{item === "Settings" && dirty && <span className={styles.unsavedDot} aria-label="Unsaved changes" />}</button>)}
    </nav>
    <div className={styles.content}>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {!data || !settings ? <div className={styles.empty} aria-busy={!notice}><h2>{notice ? "SMS workspace unavailable" : "Loading SMS workspace…"}</h2><p>{notice ? "Use Refresh to try loading again." : "Checking your gateway, settings and contacts."}</p></div> : <>
        <aside className={styles.gateway} aria-label="Sending status">
          <span className={styles.statusDot} data-ready={data.configured && data.settings.enabled} />
          <div><strong>{!data.configured ? "Sending disabled — gateway setup required" : data.settings.enabled ? "SMS sending enabled" : "SMS sending paused"}</strong>
          <p>{!data.configured ? "Configure gateway credentials on the server before enabling sending." : "Messages are sent only when sending is enabled and the worker runs."}</p></div>
          {tab !== "Settings" && <button onClick={() => selectTab("Settings", true)}>View settings <span aria-hidden="true">↗</span></button>}
        </aside>
        <div id="sms-panel-Activity" role="tabpanel" aria-labelledby="sms-tab-Activity" hidden={tab !== "Activity"} tabIndex={0}>
          <div className={styles.activityGrid}>
            <section className={styles.panel}>
              <div className={styles.sectionHead}><div><div className={styles.kicker}>Manual queue controls</div><h2>Automatic reminders</h2></div><span className={styles.badge}>Asia/Manila</span></div>
              <div className={styles.rules}><div><strong>Membership expiry</strong><span>7, 5 and 1 day before expiry</span></div><div><strong>Inactive members</strong><span>After more than 10 days without a visit</span></div></div>
              <p>Inactivity reminders run once per visit episode; members without a visit are excluded. Scans respect the saved sending time. Unattended scheduling is not active.</p>
              {reminderPreview && <p className={styles.notice}>{reminderPreview.due} new eligible reminders among {reminderPreview.examined} profiles. Preview does not queue or send messages.</p>}
              <div className={styles.actions}>
                <button className={styles.primary} disabled={busy} onClick={() => act(async () => { setReminderPreview(await api("?view=reminders")); })}>Preview due reminders</button>
                {reminderPreview?.next && <button disabled={busy} onClick={() => act(async () => { const page = await api<{ examined: number; due: number; next: string | null }>(`?view=reminders&after=${encodeURIComponent(reminderPreview.next!)}`); setReminderPreview({ ...page, examined: reminderPreview.examined + page.examined, due: reminderPreview.due + page.due }); })}>Preview more profiles</button>}
                <button disabled={busy || !data.configured || !data.settings.enabled} onClick={() => act(async () => { const result = await api<{ disabled: boolean; examined: number; queued: number }>("", { action: "reminders" }); setNotice(result.disabled ? "Reminder queueing remains disabled or unconfigured." : `Examined ${result.examined} profiles; queued ${result.queued} reminders. Run again for the next batch, then run the sending worker.`); })}>Scan and queue due reminders</button>
              </div>
            </section>
            <section className={styles.panel}>
              <div className={styles.kicker}>Delivery controls</div><h2>Process the queue</h2>
              <p>Queueing a message does not send it. Run the sending worker to process queued messages and reconcile uncertain results.</p>
              <dl className={styles.summary}><div><dt>Saved sending time</dt><dd>{data.settings.sendTime} <small>Philippine time</small></dd></div><div><dt>Loaded eligible contacts</dt><dd>{eligibleCount} <small>of {contacts.length} loaded</small></dd></div></dl>
              <button disabled={busy} onClick={() => act(async () => { const result = await api<{ disabled: boolean; processed: number }>("", { action: "worker" }); await load(); setNotice(result.disabled ? "Sending remains disabled or unconfigured." : `Worker processed ${result.processed} messages.`); })}>Run sending worker</button>
            </section>
          </div>
          <section className={styles.history}>
            <div className={styles.sectionHead}><div><h2>Sending history</h2><p>Recent messages and their delivery status.</p></div><span className={styles.badge}>{data.messages.length} loaded</span></div>
            <div className={styles.legend}><span>Queued: waiting for worker</span><span>Accepted: gateway queued</span><span>Delivered: gateway confirmed</span></div>
            <p>Uncertain sends are reconciled without resending. History is paginated by message ID.</p>
            {data.messages.length === 0 && <div className={styles.empty}><span className={styles.emptyIcon} aria-hidden="true">↗</span><h3>No messages queued.</h3><p>Preview reminders, create a campaign, or queue a requested test to get started.</p><button onClick={() => selectTab("Campaigns", true)}>Create a campaign</button></div>}
            {data.messages.map(message => <article key={message.id} className={styles.message}>
              <div className={styles.sectionHead}><div><strong>{contacts.find(row => row.id === message.personId)?.name ?? message.destination}</strong><div className={styles.meta}>{message.destination} · {message.purpose === "blast" ? "Campaign" : message.purpose}</div></div><span className={styles.badge} data-status={message.status}>{message.status}</span></div>
              <p>{message.text}</p><div className={styles.sectionHead}><span className={styles.meta}>{message.attempts} attempts · {message.providerState ?? message.errorCode ?? "Awaiting worker"}</span>
              <button disabled={busy} onClick={() => act(async () => { const result = await api<{ attempts: unknown[] }>(`?view=attempts&id=${encodeURIComponent(message.id)}`); setAttempts(result.attempts); setAttemptMessageId(message.id); })}>{attemptMessageId === message.id ? "Refresh attempts" : "View attempts"}</button></div>
              {attemptMessageId === message.id && <details open><summary>Provider attempts ({attempts.length})</summary>{attempts.length ? <pre aria-label="Provider attempts">{JSON.stringify(attempts, null, 2)}</pre> : <p>No provider attempts recorded.</p>}</details>}
            </article>)}
            {data.next && <button disabled={busy} onClick={() => act(async () => { const page = await api<SmsData>(`?after=${encodeURIComponent(data.next!)}`); setData({ ...page, messages: [...data.messages, ...page.messages] }); })}>More history</button>}
          </section>
        </div>
        <div id="sms-panel-Campaigns" role="tabpanel" aria-labelledby="sms-tab-Campaigns" hidden={tab !== "Campaigns"} tabIndex={0}>
          <SmsCampaigns contacts={contacts} request={api} />
          <p className={styles.footnote}>Need more recipients? <button onClick={() => selectTab("Contacts", true)}>Manage and load contacts</button></p>
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
            {contactNext && <button disabled={busy} onClick={() => act(async () => { const page = await api<{ contacts: ContactRow[]; next: string | null }>(`?view=contacts&after=${encodeURIComponent(contactNext)}`); setContacts([...contacts, ...page.contacts]); setContactNext(page.next); })}>More customers</button>}
          </section>
        </div>
        <div id="sms-panel-Settings" role="tabpanel" aria-labelledby="sms-tab-Settings" hidden={tab !== "Settings"} tabIndex={0}>
          <form onSubmit={event => { event.preventDefault(); act(async () => { const saved = await api<SmsSettings>("", { action: "settings", ...settings }); setSettings(saved); setData({ ...data, settings: saved }); setNotice("SMS settings saved."); }); }}>
            <fieldset disabled={busy} className={styles.settingsFields}>
              <section className={styles.panel}><div className={styles.kicker}>01 / Activation</div><h2>Sending settings</h2><p>Android SMS Gateway uses the sending SIM’s number and credit or approved plan.</p>
                <label className={styles.checkbox}><input type="checkbox" aria-label="Enable sending" checked={settings.enabled} disabled={!data.configured || busy} onChange={e => setSettings({ ...settings, enabled: e.target.checked })} /><span><strong>Enable sending</strong><small>{data.configured ? "Allow the worker to send queued messages." : "Unavailable until gateway credentials are configured on the server."}</small></span></label>
                <label className={styles.checkbox}><input type="checkbox" checked={settings.policyConfirmed} onChange={e => setSettings({ ...settings, policyConfirmed: e.target.checked })} /><span>I confirmed the sending SIM, funding, templates, permission collection and opt-out process before activation.</span></label>
              </section>
              <section className={styles.panel}><div className={styles.kicker}>02 / Schedule</div><h2>Timing & retries</h2><div className={styles.fieldGrid}>
                <label>Daily sending time (Asia/Manila)<input type="time" required value={settings.sendTime} onChange={e => setSettings({ ...settings, sendTime: e.target.value })} /></label>
                <label>Maximum attempts<input type="number" aria-label="Maximum attempts" min={1} max={3} required value={settings.maxAttempts} onChange={e => setSettings({ ...settings, maxAttempts: Number(e.target.value) })} /><small>Only explicit rate-limit rejections retry. Maximum 3 attempts.</small></label>
              </div></section>
              <section className={`${styles.panel} ${styles.wide}`}><div className={styles.kicker}>03 / Message templates</div><h2>Reminder messages</h2><p>Keep messages clear and include the opt-out instructions.</p><div className={styles.fieldGrid}>
                <label>Expiry template<textarea aria-label="Expiry template" required maxLength={480} value={settings.expiryTemplate} onChange={e => setSettings({ ...settings, expiryTemplate: e.target.value })} /><small>Available tokens: {"{expiry}"}, {"{days}"} · {settings.expiryTemplate.length}/480 characters</small></label>
                <label>Inactivity template<textarea aria-label="Inactivity template" required maxLength={480} value={settings.inactivityTemplate} onChange={e => setSettings({ ...settings, inactivityTemplate: e.target.value })} /><small>{settings.inactivityTemplate.length}/480 characters</small></label>
              </div></section>
            </fieldset>
            {dirty && <div className={styles.savebar}><span>You have unsaved changes</span><div className={styles.actions}>{dirty && <button type="button" disabled={busy} onClick={() => setSettings(data.settings)}>Discard changes</button>}<button className={styles.primary} disabled={busy || !dirty}>Save SMS settings</button></div></div>}
          </form>
          <section className={styles.panel}><div className={styles.kicker}>Delivery check</div><h2>Test delivery</h2><p>Select a customer who requested this test. Queueing does not send until sending is enabled and a worker runs.</p>
            <form onSubmit={event => { event.preventDefault(); act(async () => { await api("", { action: "test", personId, text: testText }); await load(); setNotice("Test queued. Run the worker from Activity when ready."); }); }}>
              <fieldset disabled={busy}><label>Test recipient<select required value={personId} onChange={e => setPersonId(e.target.value)}><option value="">Choose customer</option>{contacts.map(row => <option key={row.id} value={row.id}>{row.name} · {row.phone}</option>)}</select></label>
              <label>Test message<textarea required maxLength={480} value={testText} onChange={e => setTestText(e.target.value)} /></label></fieldset><div className={styles.actions}><button disabled={busy}>Queue requested test</button><button type="button" onClick={() => selectTab("Activity", true)}>View queue controls</button></div>
            </form>
          </section>
        </div>
      </>}
    </div>
  </main>;
}
