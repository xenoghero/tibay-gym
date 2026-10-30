"use client";

import Link from "next/link";
import { FinanceStatistics } from "./finance-statistics";
import { useEffect, useMemo, useState } from "react";
import {
  closeStaleSessions,
  effectiveMemberStatus,
  watchAllPersons,
  watchOpenSessions,
  watchTodaysLogs,
  type AttendanceLog,
  type Person,
} from "@/lib/db";
import { formatClockTime } from "@/lib/dates";
import { watchRejectedMemberTaps, visibleRejections, formatRejectionTime, type RejectionAlertEvent } from "@/lib/rfid/rejection-alerts";
import { rfidAdminApi } from "@/lib/rfid/admin-api";
import { CheckInFeed, type CheckInRow } from "./check-in-feed";

// Attendance listeners drive totals/feed; persisted rejections drive alerts independently.

function personProfileHref(personId: string | null): string {
  // Phase 8 — the read-only Person Profile is now the click-through target for
  // feed rows and RFID alerts.
  return personId ? `/dashboard/people/${personId}` : "/dashboard/people";
}

export function OverviewView() {
  const [mobilePanel, setMobilePanel] = useState<"check-ins" | "collections">("check-ins");
  const [todaysLogs, setTodaysLogs] = useState<AttendanceLog[]>([]);
  const [openSessions, setOpenSessions] = useState<AttendanceLog[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [openSessionsLoaded, setOpenSessionsLoaded] = useState(false);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [listenerError, setListenerError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const [rejections, setRejections] = useState<RejectionAlertEvent[]>([]);
  const [dismissing, setDismissing] = useState<string[]>([]);
  const [alertError, setAlertError] = useState<string | null>(null);

  const peopleById = useMemo(() => {
    const map = new Map<string, Person>();
    for (const p of people) map.set(p.id, p);
    return map;
  }, [people]);

  // Profile deletion now cascades attendance-log removal. Filtering against
  // the live roster also keeps legacy orphan rows (created under the old
  // retention policy) out of the Overview while those stored rows are cleaned
  // up separately.
  const visibleTodaysLogs = useMemo(
    () => todaysLogs.filter((log) => peopleById.has(log.personId)),
    [peopleById, todaysLogs],
  );
  const visibleOpenSessions = useMemo(
    () => openSessions.filter((log) => peopleById.has(log.personId)),
    [openSessions, peopleById],
  );

  // Sweep sessions past the 4-hour window that no check-in traffic has closed
  // yet, so "currently inside" doesn't count someone who left hours ago. The
  // open-sessions listener picks up the closes automatically.
  useEffect(() => {
    void closeStaleSessions({ caller: "admin" }).catch((err) => {
      console.error("[OverviewView] stale-session sweep failed", err);
    });
  }, []);

  useEffect(() => {
    const unsubAlerts = watchRejectedMemberTaps(setRejections, (err) => {
      console.error("[OverviewView] rejection listener failed", err);
      setAlertError("Could not load rejected RFID taps. Retry live updates.");
    });
    const unsubLogs = watchTodaysLogs(
      (logs) => {
        setTodaysLogs(logs);
        setLogsLoaded(true);
      },
      (err) => {
        console.error("[OverviewView] today's-logs listener failed", err);
        setListenerError(true);
      },
    );
    const unsubOpen = watchOpenSessions((sessions) => { setOpenSessions(sessions); setOpenSessionsLoaded(true); }, (err) => {
      console.error("[OverviewView] open-sessions listener failed", err);
      setListenerError(true);
    });
    const unsubPeople = watchAllPersons(
      (list) => {
        setPeople(list);
        setPeopleLoaded(true);
      },
      (err) => {
        console.error("[OverviewView] persons listener failed", err);
        setListenerError(true);
      },
    );
    return () => {
      unsubAlerts();
      unsubLogs();
      unsubOpen();
      unsubPeople();
    };
  }, [retryKey]);

  const alerts = visibleRejections(rejections).flatMap((event) => {
    const person = peopleById.get(event.personId!);
    return person && person.deletingAt == null ? [{ eventId: event.id, personId: person.id,
      name: person.name, time: formatRejectionTime(event.occurredAt) }] : [];
  });

  async function dismissAlert(eventId: string) {
    setDismissing((prev) => [...prev, eventId]);
    setAlertError(null);
    try {
      await rfidAdminApi("/api/rfid/admin/alerts", "POST", { eventId });
      setRejections((prev) => prev.filter((event) => event.id !== eventId));
    } catch {
      setAlertError("Could not dismiss this alert. Check your connection and try again.");
    } finally {
      setDismissing((prev) => prev.filter((id) => id !== eventId));
    }
  }

  function retryLiveUpdates() {
    setListenerError(false);
    setAlertError(null);
    setLogsLoaded(false);
    setOpenSessionsLoaded(false);
    setPeopleLoaded(false);
    setRetryKey((k) => k + 1);
  }

  const loading = !logsLoaded || !peopleLoaded;

  // --- tile figures ------------------------------------------------------
  const checkinsToday = visibleTodaysLogs.length;
  const currentlyInside = visibleOpenSessions.length;

  let membersToday = 0;
  let guestsToday = 0;
  for (const log of visibleTodaysLogs) {
    const person = peopleById.get(log.personId);
    if (!person) continue;
    if (person.type === "member") membersToday += 1;
    else guestsToday += 1;
  }

  let activeMembers = 0;
  let expiredMembers = 0;
  for (const person of people) {
    if (person.type !== "member") continue;
    if (effectiveMemberStatus(person) === "expired") expiredMembers += 1;
    else activeMembers += 1;
  }

  const feedRows: CheckInRow[] = visibleTodaysLogs.map((log) => {
    const person = peopleById.get(log.personId) ?? null;
    const isMember = person?.type === "member";
    const badge: CheckInRow["badge"] = isMember
      ? effectiveMemberStatus(person!) === "expired"
        ? { text: "Expired", kind: "expired" }
        : { text: "Active", kind: "active" }
      : {
          text: person
            ? `${person.visitCount} ${person.visitCount === 1 ? "visit" : "visits"}`
            : "—",
          kind: "guest",
        };
    return {
      logId: log.id,
      personId: person?.id ?? null,
      name: person?.name ?? "Unknown person",
      phone: person?.phone ?? "—",
      typeLabel: person ? (isMember ? "Member" : "Guest") : "—",
      sourceLabel: log.source.toUpperCase(),
      time: formatClockTime(log.checkInAt),
      badge,
    };
  });

  const todayLabel = new Date().toLocaleDateString("en-US", {
    timeZone: "Asia/Manila",
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <main className="rs-ov">
      <header className="rs-ov-head">
        <div><div className="rs-ov-kicker">{todayLabel}</div><h1 className="rs-ov-title">Overview</h1></div>
        <span className="rs-ov-live">{listenerError ? "Live updates interrupted" : loading ? "Connecting attendance…" : "Attendance live"}</span>
      </header>
      <div className="rs-ov-content">
        {(listenerError || alertError) && <div className="rs-ov-error">
          <span role="alert">{alertError ?? "Live updates dropped out."}</span>
          <button type="button" onClick={retryLiveUpdates}>Retry</button>
        </div>}
        {alerts.length > 0 && <div className="rs-ov-alerts">
          {alerts.map(alert => <div key={alert.eventId} className="rs-ov-alert">
            <Link href={personProfileHref(alert.personId)} className="rs-ov-alert-body">
              <span>Expired membership</span><strong>{alert.name} — RFID tap rejected because membership expired.</strong>
              <small>RFID tap · {alert.time}</small>
            </Link>
            <Link href={`/dashboard/people/${alert.personId}/renew`} aria-label={`Renew membership for ${alert.name}`}>Renew</Link>
            <button type="button" onClick={() => void dismissAlert(alert.eventId)} disabled={dismissing.includes(alert.eventId)} aria-label={`Dismiss alert for ${alert.name}`}>×</button>
          </div>)}
        </div>}
        <section className="rs-ov-tiles" aria-label="Attendance summary" aria-busy={loading || !openSessionsLoaded}>
          <div className="rs-ov-tile rs-ov-tile-hero"><h2>Currently inside</h2><strong>{!openSessionsLoaded || !peopleLoaded ? "—" : currentlyInside}</strong><span>Open sessions right now</span></div>
          <div className="rs-ov-tile"><h2>Check-ins today</h2><strong>{loading ? "—" : checkinsToday}</strong><span>Live, all sources</span></div>
          <div className="rs-ov-tile"><h2>Members / Guests</h2><strong>{loading ? "—" : `${membersToday} / ${guestsToday}`}</strong><span>Today’s check-ins</span></div>
          <div className="rs-ov-tile"><h2>Active / Expired</h2><strong>{!peopleLoaded ? "—" : `${activeMembers} / ${expiredMembers}`}</strong><span>Member standing</span></div>
        </section>
        <div className="rs-ov-workspace">
          <div className="rs-ov-panel-selector" role="group" aria-label="Overview panel">
            <button type="button" aria-pressed={mobilePanel === "check-ins"} aria-controls="overview-check-ins" onClick={() => setMobilePanel("check-ins")}>Recent check-ins</button>
            <button type="button" aria-pressed={mobilePanel === "collections"} aria-controls="overview-collections" onClick={() => setMobilePanel("collections")}>Today’s collections</button>
          </div>
          <div id="overview-check-ins" className="rs-ov-panel" data-selected={mobilePanel === "check-ins"}>
            <CheckInFeed rows={feedRows} loading={loading} />
          </div>
          <div id="overview-collections" className="rs-ov-panel" data-selected={mobilePanel === "collections"}>
            <FinanceStatistics compact />
          </div>
        </div>
      </div>
    </main>
  );
}
