"use client";

import { FormInput } from "@/components/ui/form-input";

import { useContentTransition } from "@/lib/use-content-transition";

import { LoadingSkeleton } from "@/components/ui/skeleton";

import Link from "next/link";
import { FinanceStatistics } from "./finance-statistics";
import { LeadStatistics } from "./lead-statistics";
import { ReportDateSheet } from "./report-date-sheet";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Timestamp } from "firebase/firestore";
import {
  effectiveMemberStatus,
  getLogsInRange,
  getMembershipExpiryWatch,
  listPersons,
  RANGE_QUERY_LIMIT,
  type AttendanceLog,
  type Person,
} from "@/lib/db";
import {
  formatDateTime,
  formatLongDate,
  isSingleDayRange,
  rangeForCustom,
  rangeForPreset,
  rangeFilenameStamp,
  type DateRange,
  type RangePreset,
} from "@/lib/dates";
import { downloadCsv, toCsv } from "@/lib/csv";
import { statusBadgeStyle } from "@/lib/status-badge";

// TASKLIST Phase 10 — Admin Dashboard: Statistics tab
// (statistics-tab-content.md). Pulled from the Claude Design canvas's
// `isStats` view for the check-ins/peak-hours/peak-days/top-visitors section;
// the Membership Expiry Watch section below it has no canvas counterpart
// (added to content scope after the canvas was drawn) and is built here to
// match the same card/table conventions as the rest of the tab.
//
// Unlike Overview/People, nothing here is a live Firestore listener — the tab
// queries once on load and again whenever the range or threshold changes
// (statistics-tab-content.md §"Decisions locked").

const displayFont =
  "var(--font-barlow-condensed), 'Barlow Condensed', sans-serif";
const monoFont = "var(--font-geist-mono), ui-monospace, monospace";


const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
];

const THRESHOLDS = [7, 14, 30] as const;
type Threshold = (typeof THRESHOLDS)[number];

/** The composite `persons` index (type + membershipExpiry) needs a one-time
 *  build on a fresh project, same situation as the Phase 8 visit-history index. */
function describeLoadError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/requires an index/i.test(message)) {
    return "This view isn't set up yet — it needs a one-time step from whoever manages the system. Contact them and mention \"missing database index on persons.\"";
  }
  return "Couldn't load this data. Check your connection and refresh.";
}

function personProfileHref(personId: string): string {
  return `/dashboard/people/${personId}`;
}

function statusLabel(person: Person | undefined): string {
  if (!person || person.type !== "member") return "—";
  return effectiveMemberStatus(person) === "expired" ? "Expired" : "Active";
}

interface DayBucket {
  key: string;
  label: string;
  total: number;
  memberCount: number;
  guestCount: number;
}

interface HourBucket {
  hour: number;
  label: string;
  count: number;
}

interface WeekdayBucket {
  index: number;
  label: string;
  count: number;
}

interface TopVisitor {
  personId: string;
  name: string;
  typeLabel: string;
  status: string;
  visits: number;
}

interface Stats {
  total: number;
  memberCount: number;
  guestCount: number;
  uniqueVisitors: number;
  avgPerDay: number;
  numDays: number;
  days: DayBucket[];
  hours: HourBucket[];
  weekdays: WeekdayBucket[];
  topVisitors: TopVisitor[];
}

const WEEKDAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function hourLabel(h: number): string {
  if (h === 0) return "12a";
  if (h < 12) return `${h}a`;
  if (h === 12) return "12p";
  return `${h - 12}p`;
}

/** Peak hours, folded into twelve two-hour buckets for the narrow layout.
 *  24 bars across a phone is ~11px each with colliding labels; 12 is legible,
 *  and the card's "Busiest: 6p–7p" hint still names the exact hour so nothing
 *  is actually lost by bucketing. Labels land every 4 hours only. */
function pairHours(hours: HourBucket[]): {
  hour: number;
  label: string;
  showLabel: boolean;
  count: number;
}[] {
  const pairs = [];
  for (let h = 0; h < 24; h += 2) {
    pairs.push({
      hour: h,
      label: hourLabel(h),
      showLabel: h % 4 === 0,
      count: hours[h].count + hours[h + 1].count,
    });
  }
  return pairs;
}

function IconChevronDown({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function IconDownload({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      aria-hidden
    >
      <path d="M12 3v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

function computeStats(
  logs: AttendanceLog[],
  people: Map<string, Person>,
  range: DateRange,
): Stats {
  const numDays = Math.max(
    1,
    Math.round((range.end.toMillis() - range.start.toMillis()) / (24 * 60 * 60 * 1000)),
  );

  const dayMap = new Map<string, DayBucket>();
  const dayKeyFmtShort = numDays <= 7;
  for (let i = 0; i < numDays; i++) {
    const d = new Date(range.start.toDate());
    d.setDate(d.getDate() + i);
    const key = d.toDateString();
    const label = dayKeyFmtShort
      ? d.toLocaleDateString("en-US", { weekday: "short" })
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    dayMap.set(key, { key, label, total: 0, memberCount: 0, guestCount: 0 });
  }

  const hours: HourBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: hourLabel(hour),
    count: 0,
  }));

  const weekdays: WeekdayBucket[] = WEEKDAY_LABELS.map((label, index) => ({
    index,
    label,
    count: 0,
  }));

  const visitorCounts = new Map<string, number>();
  let memberCount = 0;
  let guestCount = 0;

  for (const log of logs) {
    const person = people.get(log.personId);
    const isMember = person?.type === "member";
    if (person) {
      if (isMember) memberCount += 1;
      else guestCount += 1;
    }

    const d = log.checkInAt.toDate();
    const dayKey = d.toDateString();
    const bucket = dayMap.get(dayKey);
    if (bucket) {
      bucket.total += 1;
      if (isMember) bucket.memberCount += 1;
      else bucket.guestCount += 1;
    }

    hours[d.getHours()].count += 1;
    weekdays[d.getDay()].count += 1;

    visitorCounts.set(log.personId, (visitorCounts.get(log.personId) ?? 0) + 1);
  }

  const topVisitors: TopVisitor[] = Array.from(visitorCounts.entries())
    .map(([personId, visits]) => {
      const person = people.get(personId);
      return {
        personId,
        name: person?.name ?? "Unknown person",
        typeLabel: person ? (person.type === "member" ? "Member" : "Guest") : "—",
        status: statusLabel(person),
        visits,
      };
    })
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 20);

  return {
    total: logs.length,
    memberCount,
    guestCount,
    uniqueVisitors: visitorCounts.size,
    avgPerDay: logs.length / numDays,
    numDays,
    days: Array.from(dayMap.values()),
    hours,
    weekdays,
    topVisitors,
  };
}

function formatDaysDelta(days: number): string {
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} overdue`;
  if (days === 0) return "Expires today";
  return `In ${days} ${days === 1 ? "day" : "days"}`;
}

function daysUntil(expiry: Timestamp | null): number {
  if (!expiry) return 0;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((expiry.toMillis() - Date.now()) / msPerDay);
}

export function StatisticsView() {
  const reportScroller = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"collections" | "attendance" | "renewals" | "leads">("collections");
  useContentTransition(reportScroller, tab);
  const [attendanceRefresh, setAttendanceRefresh] = useState(0);
  const [renewalsRefresh, setRenewalsRefresh] = useState(0);
  const [preset, setPreset] = useState<RangePreset | null>("7d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("7d"));

  const [logs, setLogs] = useState<AttendanceLog[] | null>(null);
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);

  const [threshold, setThreshold] = useState<Threshold>(7);
  const [expiryList, setExpiryList] = useState<Person[] | null>(null);
  const [expiryError, setExpiryError] = useState<string | null>(null);

  // Narrow layout only: the range presets and the custom date pair live in a
  // bottom sheet instead of a bar, so the controls cost one sticky line
  // instead of a third of the viewport. Same sheet chrome as the More nav.
  const [rangeSheetOpen, setRangeSheetOpen] = useState(false);

  useEffect(() => {
    if (!rangeSheetOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setRangeSheetOpen(false);
    }
    // Below 860px the content column is the scroller, not <body> — see the
    // matching note in mobile-bottom-nav.tsx.
    const scroller = document.querySelector<HTMLElement>(".rs-dashboard-content");
    const previousOverflow = scroller?.style.overflow ?? "";
    if (scroller) scroller.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      if (scroller) scroller.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [rangeSheetOpen]);

  useEffect(() => {
    let active = true;
    Promise.all([getLogsInRange(range.start, range.end), listPersons()])
      .then(([rangeLogs, personList]) => {
        if (!active) return;
        setLogs(rangeLogs);
        setPeople(new Map(personList.map((p) => [p.id, p])));
      })
      .catch((err) => {
        console.error("[StatisticsView] range query failed", err);
        if (active) setLoadError(describeLoadError(err));
      });
    return () => {
      active = false;
    };
  }, [range, attendanceRefresh]);

  useEffect(() => {
    let active = true;
    getMembershipExpiryWatch(threshold)
      .then((list) => {
        if (active) setExpiryList(list);
      })
      .catch((err) => {
        console.error("[StatisticsView] expiry watch query failed", err);
        if (active) setExpiryError(describeLoadError(err));
      });
    return () => {
      active = false;
    };
  }, [threshold, renewalsRefresh]);

  // Resetting to the loading state happens in these handlers (a user action),
  // not inside the effects above, which only ever react to the new range/
  // threshold once it's already committed.
  function applyPreset(p: RangePreset) {
    setPreset(p);
    setRangeSheetOpen(false);
    setCustomStart("");
    setCustomEnd("");
    setLogs(null);
    setLoadError(null);
    setRange(rangeForPreset(p));
  }

  function applyCustom(nextStart: string, nextEnd: string) {
    setCustomStart(nextStart);
    setCustomEnd(nextEnd);
    const custom = rangeForCustom(nextStart, nextEnd);
    if (custom) {
      setPreset(null);
      setLogs(null);
      setLoadError(null);
      setRange(custom);
    }
  }

  function applyThreshold(t: Threshold) {
    setThreshold(t);
    setExpiryList(null);
    setExpiryError(null);
  }

  const stats = useMemo(
    () => (logs ? computeStats(logs, people, range) : null),
    [logs, people, range],
  );

  const expiryRows = useMemo(
    () =>
      (expiryList ?? [])
        .map((person) => ({ person, daysDelta: daysUntil(person.membershipExpiry) }))
        .sort((a, b) => a.daysDelta - b.daysDelta),
    [expiryList],
  );

  const singleDay = isSingleDayRange(range);
  const loading = logs === null;
  const empty = !loading && !loadError && stats !== null && stats.total === 0;
  const truncated = (logs?.length ?? 0) >= RANGE_QUERY_LIMIT;

  function exportCheckinsCsv() {
    if (!logs) return;
    const rows = logs.map((log) => {
      const person = people.get(log.personId);
      return [
        formatDateTime(log.checkInAt),
        person?.name ?? "Unknown person",
        person ? (person.type === "member" ? "Member" : "Guest") : "—",
        log.source.toUpperCase(),
        statusLabel(person),
      ];
    });
    downloadCsv(
      `tibay-gym-checkins_${rangeFilenameStamp(range)}.csv`,
      toCsv(["Date/Time", "Name", "Type", "Source", "Status"], rows),
    );
  }

  function exportExpiryCsv() {
    const rows = expiryRows.map(({ person, daysDelta }) => [
      person.name,
      person.phone,
      formatLongDate(person.membershipExpiry),
      formatDaysDelta(daysDelta),
      effectiveMemberStatus(person) === "expired" ? "Expired" : "Active",
    ]);
    downloadCsv(
      `tibay-gym-expiry-watch_${threshold}-days.csv`,
      toCsv(["Name", "Phone", "Expiry Date", "Days Until/Since Expiry", "Status"], rows),
    );
  }

  const maxDayTotal = stats ? Math.max(1, ...stats.days.map((d) => d.total)) : 1;
  const maxHourCount = stats ? Math.max(1, ...stats.hours.map((h) => h.count)) : 1;
  const maxWeekdayCount = stats ? Math.max(1, ...stats.weekdays.map((w) => w.count)) : 1;

  const busiestHour = stats
    ? stats.hours.reduce((best, h) => (h.count > best.count ? h : best), stats.hours[0])
    : null;

  // Both hour resolutions are rendered and one is hidden by the stylesheet,
  // rather than branching on a media query in JS — a JS branch would have to
  // guess at render time on the server and correct itself after hydration.
  // Same arrangement as the two phone copies in the Overview feed.
  const hourPairs = stats ? pairHours(stats.hours) : [];
  const maxHourPairCount = Math.max(1, ...hourPairs.map((h) => h.count));

  function selectTab(next: typeof tab) {
    setTab(next);
    setRangeSheetOpen(false);
    if (reportScroller.current) reportScroller.current.scrollTop = 0;
  }

  const rangeChipText =
    PRESETS.find((p) => p.key === preset)?.label ?? "Custom range";

  return (
    <main className="rs-st rs-st-finance" style={pageStyle}>
      {/* Matches the Overview header: kicker over an oversized display title,
          and on narrow screens it drops to a block with nothing beside it. The
          presets that used to sit here were a second copy of the ones in the
          range bar below — one control, one place. */}
      <header className="rs-st-head" style={headerRow}>
        <div>
          <div className="rs-st-kicker" style={dateKicker}>
            Gym performance
          </div>
          <h1 className="rs-st-title" style={headingStyle}>
            Statistics
          </h1>
        </div>
      </header>
      <div className="rs-stat-tabs" role="tablist" aria-label="Statistics reports">
        {(["collections", "attendance", "renewals", "leads"] as const).map((name, index, tabs) => <button
          key={name} type="button" role="tab" id={`statistics-tab-${name}`}
          aria-selected={tab === name} aria-controls={`statistics-panel-${name}`}
          tabIndex={tab === name ? 0 : -1}
          onClick={() => selectTab(name)}
          onKeyDown={event => {
            let next = index;
            if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
            else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = tabs.length - 1;
            else return;
            event.preventDefault(); selectTab(tabs[next]);
            document.getElementById(`statistics-tab-${tabs[next]}`)?.focus();
          }}
        >{name[0].toUpperCase() + name.slice(1)}</button>)}
      </div>
      <div ref={reportScroller} className="rs-finance-scroll" role="region" aria-label="Statistics reports">
      <section role="tabpanel" id="statistics-panel-leads" aria-labelledby="statistics-tab-leads" hidden={tab !== "leads"} tabIndex={0}>
        <LeadStatistics enabled={tab === "leads"} />
      </section>
      <section role="tabpanel" id="statistics-panel-collections" aria-labelledby="statistics-tab-collections" hidden={tab !== "collections"} tabIndex={0}>
        <FinanceStatistics />
      </section>
      <section role="tabpanel" id="statistics-panel-attendance" aria-labelledby="statistics-tab-attendance" hidden={tab !== "attendance"} tabIndex={0}>
      <div className="rs-stat-section-heading"><div><h2>Attendance</h2><p>Check-ins, visitor patterns and your busiest times.</p></div>
        <div className="rs-stat-actions"><button type="button" disabled={loading && !loadError} onClick={() => { setLogs(null); setLoadError(null); setAttendanceRefresh(value => value + 1); }}>Refresh attendance</button>
        <button type="button" onClick={exportCheckinsCsv} disabled={!logs?.length || !!loadError}>Attendance CSV</button></div>
      </div>
      <div className="rs-st-rangebar" style={rangeBarStyle}>
        <div style={rangeBarLabel}>Date range</div>
        <div style={presetGroupStyle}>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={preset === p.key}
              onClick={() => applyPreset(p.key)}
              style={presetButtonStyle(preset === p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div style={customRowStyle}>
          <span style={{ fontSize: 13, color: "var(--rs-muted)" }}>Custom</span>
          <FormInput
            type="date"
            value={customStart}
            onChange={(e) => applyCustom(e.target.value, customEnd)}
            aria-label="Custom range start date"
            style={dateInputStyle(preset === null)}
          />
          <span style={{ color: "var(--rs-muted)" }}>–</span>
          <FormInput
            type="date"
            value={customEnd}
            onChange={(e) => applyCustom(customStart, e.target.value)}
            aria-label="Custom range end date"
            style={dateInputStyle(preset === null)}
          />
        </div>
      </div>

      {/* The narrow-layout stand-in for the bar above: one sticky line that
          survives the scroll, so the range the numbers belong to is still
          answerable from anywhere down the page. Hidden at wide widths. */}
      <div className="rs-st-mobilebar" style={mobileBarStyle}>
        <button
          type="button"
          onClick={() => setRangeSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={rangeSheetOpen}
          style={rangeChipStyle}
        >
          <span style={rangeChipLabel}>Range</span>
          <span style={rangeChipValue}>{rangeChipText}</span>
          <IconChevronDown />
        </button>
        <button
          type="button"
          onClick={exportCheckinsCsv}
          disabled={!logs || logs.length === 0 || !!loadError}
          aria-label="Download check-ins CSV"
          style={iconButtonStyle(!logs || logs.length === 0)}
        >
          <IconDownload />
        </button>
      </div>

      <p className="rs-attendance-period">{formatLongDate(range.start)} – {formatLongDate(Timestamp.fromMillis(range.end.toMillis() - 1))} · All check-in sources</p>
      {customStart && customEnd && !rangeForCustom(customStart, customEnd) && <p role="alert" style={errorBannerStyle}>Choose a valid start and end date, with the end on or after the start.</p>}
      <ReportDateSheet open={rangeSheetOpen} onClose={() => setRangeSheetOpen(false)}>
            <div style={sheetPresetList}>
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={preset === p.key}
              onClick={() => applyPreset(p.key)}
                  style={sheetPresetStyle(preset === p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div style={sheetCustomBlock}>
              <div style={sheetSubLabel}>Custom range</div>
              <div className="rs-report-range-fields" style={sheetCustomRow}>
                <label>
                  <span>From</span>
                  <FormInput
                    type="date"
                    value={customStart}
                    onChange={(e) => applyCustom(e.target.value, customEnd)}
                    aria-label="Custom range start date"
                    style={{ ...dateInputStyle(preset === null), height: 44 }}
                  />
                </label>
                <label>
                  <span>Through</span>
                  <FormInput
                    type="date"
                    value={customEnd}
                    onChange={(e) => applyCustom(customStart, e.target.value)}
                    aria-label="Custom range end date"
                    style={{ ...dateInputStyle(preset === null), height: 44 }}
                  />
                </label>
              </div>
            </div>
            {customStart && customEnd && !rangeForCustom(customStart, customEnd) && <p role="alert">Choose a valid start and end date, with the end on or after the start.</p>}
      </ReportDateSheet>

      <div
        className="rs-st-scroll"
        role="region"
        aria-label="Statistics content"
        tabIndex={0}
      >

      {loadError && <p role="alert" style={errorBannerStyle}>{loadError}</p>}
      {!loadError && truncated && (
        <p style={errorBannerStyle}>
          This range has {RANGE_QUERY_LIMIT.toLocaleString()}+ check-ins — the
          report below only covers the first {RANGE_QUERY_LIMIT.toLocaleString()}
          , so totals may be undercounted. Try a narrower date range for a
          complete picture.
        </p>
      )}

      {!loadError && (loading ? (
        <>
          <LoadingSkeleton label="Loading attendance summary…" variant="cards" count={4} />
          <LoadingSkeleton label="Loading attendance chart…" variant="chart" count={7} />
        </>
      ) : empty ? (
        <>
          <div className="rs-st-tiles" style={tileGridStyle}>
            {["Check-ins in range", "Member / Guest split", "Unique visitors", "Average per day"].map(
              (label, i) => (
                <div
                  key={label}
                  className={i === 0 ? "rs-st-tile rs-st-tile-hero" : "rs-st-tile"}
                  style={zeroTileStyle}
                >
                  <div className="rs-st-label" style={tileLabelStyle}>{label}</div>
                  <div className="rs-st-value" style={{ ...tileValueStyle, color: "var(--rs-muted)" }}>0</div>
                  <div className="rs-st-note" style={tileNoteStyle}>—</div>
                </div>
              ),
            )}
          </div>
          <div className="rs-st-emptypanel" style={emptyPanelStyle}>
            <div style={emptyHeadingStyle}>No check-ins in this date range.</div>
            <p style={emptyTextStyle}>Pick a different range to see attendance patterns.</p>
          </div>
        </>
      ) : (
        stats && (
          <>
            {/* The lead figure is the one already carrying the red accent, so
                the narrow layout promotes it rather than introducing a new
                emphasis — same hero-plus-strip shape as Overview. */}
            <div className="rs-st-tiles" style={tileGridStyle}>
              <div className="rs-st-tile rs-st-tile-hero" style={{ ...tileStyle, ...tileAccentStyle }}>
                <div className="rs-st-label" style={tileLabelOnAccent}>Check-ins in range</div>
                <div className="rs-st-value" style={tileValueStyle}>{stats.total}</div>
                <div className="rs-st-note" style={tileNoteOnAccent}>All sources</div>
              </div>
              <div className="rs-st-tile" style={tileStyle}>
                <div className="rs-st-label" style={tileLabelStyle}>Member / Guest split</div>
                <div style={tileSplitRow}>
                  <span className="rs-st-value" style={tileValueStyle}>{stats.memberCount}</span>
                  <span className="rs-st-value-sec" style={tileSplitSecondary}>/ {stats.guestCount}</span>
                </div>
                <div className="rs-st-note" style={tileNoteStyle}>
                  {stats.total > 0
                    ? `${Math.round((stats.memberCount / stats.total) * 100)}% members / ${Math.round(
                        (stats.guestCount / stats.total) * 100,
                      )}% guests`
                    : "—"}
                </div>
              </div>
              <div className="rs-st-tile" style={tileStyle}>
                <div className="rs-st-label" style={tileLabelStyle}>Unique visitors</div>
                <div className="rs-st-value" style={tileValueStyle}>{stats.uniqueVisitors}</div>
                <div className="rs-st-note" style={tileNoteStyle}>Distinct people in range</div>
              </div>
              <div className="rs-st-tile" style={tileStyle}>
                <div className="rs-st-label" style={tileLabelStyle}>Average per day</div>
                <div className="rs-st-value" style={tileValueStyle}>{stats.avgPerDay.toFixed(1)}</div>
                <div className="rs-st-note" style={tileNoteStyle}>Across {stats.numDays} {stats.numDays === 1 ? "day" : "days"}</div>
              </div>
            </div>

            <section className="rs-st-card" style={cardStyle}>
              <div style={cardHeaderRow}>
                <h2 style={cardHeading}>Check-ins over time</h2>
                {!singleDay && (
                  <div style={legendRow}>
                    <span style={legendItem}>
                      <span style={{ ...legendDot, background: "var(--rs-accent)" }} />
                      Members
                    </span>
                    <span style={legendItem}>
                      <span style={{ ...legendDot, background: "var(--rs-fg)", opacity: 0.28 }} />
                      Guests
                    </span>
                  </div>
                )}
              </div>
              {singleDay ? (
                <div className="rs-st-singleday" style={{ padding: "24px 20px 26px", display: "flex", gap: 32, flexWrap: "wrap" }}>
                  <div>
                    <div style={tileValueStyle}>{stats.total}</div>
                    <div style={tileNoteStyle}>Total check-ins</div>
                  </div>
                  <div>
                    <div style={{ ...tileValueStyle, fontSize: 32 }}>{stats.memberCount}</div>
                    <div style={tileNoteStyle}>Members</div>
                  </div>
                  <div>
                    <div style={{ ...tileValueStyle, fontSize: 32 }}>{stats.guestCount}</div>
                    <div style={tileNoteStyle}>Guests</div>
                  </div>
                </div>
              ) : (
                <div className="rs-st-chartpad" style={{ padding: "24px 20px 18px", overflowX: "auto" }}>
                  {/* The day count rides along as a custom property so the
                      narrow layout can retune the track width without knowing
                      it at authoring time. */}
                  <div
                    className="rs-st-daygrid"
                    style={
                      {
                        display: "grid",
                        gridTemplateColumns: `repeat(${stats.days.length}, minmax(28px, 1fr))`,
                        gap: 14,
                        alignItems: "end",
                        height: 250,
                        minWidth: stats.days.length * 42,
                        "--rs-days": stats.days.length,
                      } as CSSProperties
                    }
                  >
                    {stats.days.map((d) => {
                      const barH = Math.round((d.total / maxDayTotal) * 200);
                      const guestH = d.total > 0 ? Math.round((d.guestCount / d.total) * barH) : 0;
                      const memberH = barH - guestH;
                      return (
                        <div key={d.key} className="rs-st-daycol" style={dayColStyle}>
                          <div style={dayTotalStyle}>{d.total}</div>
                          <div style={{ ...dayBarWrapStyle, height: barH }}>
                            <div style={{ height: guestH, background: "var(--rs-fg)", opacity: 0.22 }} />
                            <div style={{ height: memberH, background: "var(--rs-accent)" }} />
                          </div>
                          <div className="rs-st-daylabel" style={dayLabelStyle}>{d.label}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <div className="rs-st-split" style={splitColumnsStyle}>
              <section className="rs-st-card" style={cardStyle}>
                <div style={cardHeaderRow}>
                  <h2 style={cardHeading}>Peak hours</h2>
                  {busiestHour && busiestHour.count > 0 && (
                    <span style={cardHint}>
                      Busiest: {hourLabel(busiestHour.hour)}–{hourLabel((busiestHour.hour + 1) % 24)}
                    </span>
                  )}
                </div>
                <div className="rs-st-chartpad" style={{ padding: "22px 20px 16px" }}>
                  <div className="rs-st-hours-wide" style={hoursRowStyle}>
                    {stats.hours.map((h) => (
                      <div key={h.hour} style={hourColStyle}>
                        <div
                          style={{
                            width: "100%",
                            height: Math.max(2, Math.round((h.count / maxHourCount) * 130)),
                            background: h.count === maxHourCount && h.count > 0 ? "var(--rs-accent)" : "var(--rs-line)",
                            borderRadius: "3px 3px 0 0",
                          }}
                        />
                        <div style={hourLabelStyle}>{h.label}</div>
                      </div>
                    ))}
                  </div>
                  {/* Two-hour buckets, shown only in the narrow layout. */}
                  <div
                    className="rs-st-hours-narrow"
                    style={{ ...hoursRowStyle, display: "none", gap: 6 }}
                    aria-hidden
                  >
                    {hourPairs.map((h) => (
                      <div key={h.hour} style={hourColStyle}>
                        <div
                          style={{
                            width: "100%",
                            height: Math.max(2, Math.round((h.count / maxHourPairCount) * 130)),
                            background:
                              h.count === maxHourPairCount && h.count > 0
                                ? "var(--rs-accent)"
                                : "var(--rs-line)",
                            borderRadius: "3px 3px 0 0",
                          }}
                        />
                        <div style={hourLabelStyle}>{h.showLabel ? h.label : " "}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="rs-st-card" style={cardStyle}>
                <div style={cardHeaderRowSimple}>
                  <h2 style={cardHeading}>Peak days</h2>
                </div>
                <div className="rs-st-chartpad" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 11 }}>
                  {stats.weekdays.map((w) => (
                    <div key={w.index} style={weekdayRowStyle}>
                      <span style={weekdayLabelStyle}>{w.label}</span>
                      <span style={weekdayTrackStyle}>
                        <span
                          style={{
                            display: "block",
                            height: "100%",
                            width: `${Math.round((w.count / maxWeekdayCount) * 100)}%`,
                            background:
                              w.count === maxWeekdayCount && w.count > 0 ? "var(--rs-accent)" : "var(--rs-line)",
                            borderRadius: 5,
                          }}
                        />
                      </span>
                      <span style={weekdayCountStyle}>{w.count}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="rs-st-card" style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
              <div style={cardHeaderRow}>
                <h2 style={cardHeading}>Most frequent visitors</h2>
                <span style={cardHint}>Top {Math.min(20, stats.topVisitors.length)} in this range</span>
              </div>
              <div className="rs-st-tophead" style={topHeadRow}>
                <span>#</span>
                <span>Name</span>
                <span>Type</span>
                <span>Status</span>
                <span>Visits</span>
              </div>
              {stats.topVisitors.map((v, i) => (
                <Link
                  key={v.personId}
                  href={personProfileHref(v.personId)}
                  className="rs-st-toprow"
                  style={topRowStyle}
                >
                  <span className="rs-st-top-rank" style={{ fontFamily: monoFont, fontSize: 12, color: "var(--rs-muted)" }}>{i + 1}</span>
                  <span className="rs-st-top-name" style={{ fontSize: 14, fontWeight: 500 }}>{v.name}</span>
                  <span className="rs-st-top-type" style={{ fontSize: 13 }}>{v.typeLabel}</span>
                  <span className="rs-st-top-status">
                    {v.status === "—" ? (
                      <span style={{ color: "var(--rs-muted)" }}>—</span>
                    ) : (
                      <span style={statusBadgeStyle(v.status === "Expired" ? "expired" : "active")}>{v.status}</span>
                    )}
                  </span>
                  <span className="rs-st-top-visits" style={{ fontFamily: monoFont, fontSize: 13 }}>{v.visits}</span>
                </Link>
              ))}
            </section>
          </>
        )
      ))}
      </div>
      </section>
      <section role="tabpanel" id="statistics-panel-renewals" aria-labelledby="statistics-tab-renewals" hidden={tab !== "renewals"} tabIndex={0}>
      {/* --- Membership Expiry Watch --- */}
      <section style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
        <header className="rs-st-subhead" style={headerRow}>
          <div>
            <h2 className="rs-st-subtitle-h" style={{ ...headingStyle, fontSize: 34 }}>Renewals</h2>
            <div style={subtitleStyle}>
              Expired memberships and those expiring in the next {threshold} days, ordered by follow-up priority.
            </div>
          </div>
          <div className="rs-st-subhead-actions" style={headerActions}>
            <button className="rs-stat-refresh" type="button" disabled={expiryList === null && !expiryError} onClick={() => { setExpiryList(null); setExpiryError(null); setRenewalsRefresh(value => value + 1); }}>Refresh renewals</button>
            <div className="rs-st-thresholds" role="group" aria-label="Upcoming expiry window" style={presetGroupStyle}>
              {THRESHOLDS.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={threshold === t}
                  onClick={() => applyThreshold(t)}
                  style={presetButtonStyle(threshold === t)}
                >
                  {t} days
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={exportExpiryCsv}
              disabled={expiryRows.length === 0 || !!expiryError}
              className="rs-st-expiry-csv"
              style={csvButtonStyle}
            >
              Download CSV
            </button>
          </div>
        </header>

        {expiryError && <p role="alert" style={errorBannerStyle}>{expiryError}</p>}

        <div className="rs-st-card" style={tableCardStyle}>
          <div className="rs-st-exphead" style={expiryHeadStyle}>
            <span>Name</span>
            <span>Phone</span>
            <span>Expiry date</span>
            <span>Days until/since</span>
            <span>Status</span>
          </div>

          {expiryError ? null : expiryList === null ? (
            <LoadingSkeleton label="Loading expiring memberships…" />
          ) : expiryRows.length === 0 ? (
            <div className="rs-st-emptysmall" style={emptyStyleSmall}>
              <div style={emptyHeadingStyleSmall}>Nothing due for renewal</div>
              <p style={emptyTextStyle}>
                No expired memberships or memberships expiring in the next {threshold} days.
              </p>
            </div>
          ) : (
            expiryRows.map(({ person, daysDelta }) => (
              <div
                key={person.id}
                className="rs-st-exprow"
                style={expiryRowStyle}
              >
                <Link href={personProfileHref(person.id)} className="rs-st-exp-name" style={{ fontSize: 14, fontWeight: 500, color: "inherit" }}>{person.name}</Link>
                <span
                  className="rs-st-exp-phone"
                  style={{ fontFamily: monoFont, fontSize: 13, color: "var(--rs-muted)" }}
                >
                  {person.phone}
                </span>
                <span className="rs-st-exp-date" style={{ fontSize: 13 }}>
                  {formatLongDate(person.membershipExpiry)}
                </span>
                <span
                  className="rs-st-exp-delta"
                  style={{
                    fontSize: 13,
                    color: daysDelta < 0 ? "var(--rs-accent-text)" : "var(--rs-fg)",
                  }}
                >
                  {formatDaysDelta(daysDelta)}
                </span>
                <span
                  className="rs-st-exp-status"
                  style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}
                >
                  <span style={statusBadgeStyle(effectiveMemberStatus(person) === "expired" ? "expired" : "active")}>
                    {effectiveMemberStatus(person) === "expired" ? "Expired" : "Active"}
                  </span>
                  <Link className="rs-membership-shortcut" href={`/dashboard/people/${person.id}/renew`} aria-label={`Renew membership for ${person.name}`} style={{ color: "var(--rs-accent-text)", fontSize: 12 }}>Renew</Link>
                </span>
              </div>
            ))
          )}
        </div>
      </section>
      </section>
      </div>
    </main>
  );
}

// --- styles -------------------------------------------------------------

const pageStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "34px 40px 60px",
  display: "flex",
  flexDirection: "column",
  gap: 22,
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
};

const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
  gap: 24,
  flexWrap: "wrap",
};

const dateKicker: CSSProperties = {
  fontFamily: monoFont,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.16em",
  color: "var(--rs-muted)",
};

const headingStyle: CSSProperties = {
  fontFamily: displayFont,
  fontSize: 46,
  lineHeight: 1,
  fontWeight: 600,
  textTransform: "uppercase",
  margin: "8px 0 0",
};

const subtitleStyle: CSSProperties = {
  fontSize: 13,
  color: "var(--rs-muted)",
  marginTop: 6,
  maxWidth: "56ch",
};

const headerActions: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
};

const presetGroupStyle: CSSProperties = {
  display: "flex",
  gap: 6,
  padding: 4,
  border: "1px solid var(--rs-line)",
  borderRadius: 8,
  flexWrap: "wrap",
};

function presetButtonStyle(active: boolean): CSSProperties {
  return {
    height: 28,
    padding: "0 12px",
    border: "none",
    borderRadius: 5,
    cursor: "pointer",
    fontSize: 12,
    background: active ? "var(--rs-accent)" : "transparent",
    color: active ? "var(--rs-on-accent)" : "var(--rs-fg)",
  };
}

const csvButtonStyle: CSSProperties = {
  height: 38,
  padding: "0 18px",
  border: "1px solid var(--rs-fg)",
  borderRadius: 6,
  background: "transparent",
  color: "var(--rs-fg)",
  fontSize: 14,
  cursor: "pointer",
};

const rangeBarStyle: CSSProperties = {
  border: "1px solid var(--rs-line)",
  borderRadius: 10,
  padding: "16px 20px",
  display: "flex",
  alignItems: "center",
  gap: 18,
  flexWrap: "wrap",
};

const rangeBarLabel: CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  color: "var(--rs-muted)",
};

const customRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginLeft: "auto",
};

function dateInputStyle(active: boolean): CSSProperties {
  return {
    height: 32,
    padding: "0 10px",
    border: `1px solid ${active ? "var(--rs-accent)" : "var(--rs-line)"}`,
    background: "var(--rs-bg)",
    color: "var(--rs-fg)",
    borderRadius: 6,
    outline: "none",
    fontFamily: monoFont,
    fontSize: 13,
  };
}

/* --- narrow-layout range control ---------------------------------------- */

/** `display: none` inline is the default state; the 860px block in globals.css
 *  turns it back on with `!important`, the same way every other override in
 *  this codebase outranks an inline style. */
const mobileBarStyle: CSSProperties = {
  display: "none",
  alignItems: "center",
  gap: 8,
};

const rangeChipStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 44,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 12px",
  border: "1px solid var(--rs-line)",
  borderRadius: 8,
  background: "var(--rs-panel)",
  color: "var(--rs-fg)",
  cursor: "pointer",
  textAlign: "left",
};

const rangeChipLabel: CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  color: "var(--rs-muted)",
  flex: "none",
};

const rangeChipValue: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 14,
  fontWeight: 500,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

function iconButtonStyle(disabled: boolean): CSSProperties {
  return {
    width: 44,
    height: 44,
    flex: "none",
    display: "grid",
    placeItems: "center",
    border: "1px solid var(--rs-line)",
    borderRadius: 8,
    background: "var(--rs-panel)",
    color: disabled ? "var(--rs-muted)" : "var(--rs-fg)",
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "default" : "pointer",
  };
}

const sheetPresetList: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
};

function sheetPresetStyle(active: boolean): CSSProperties {
  return {
    height: 48,
    padding: "0 14px",
    border: "none",
    borderRadius: 6,
    textAlign: "left",
    fontSize: 15,
    fontWeight: 500,
    cursor: "pointer",
    background: active ? "var(--rs-accent)" : "transparent",
    color: active ? "var(--rs-on-accent)" : "var(--rs-fg)",
  };
}

const sheetCustomBlock: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  borderTop: "1px solid var(--rs-line)",
  paddingTop: 14,
};

const sheetSubLabel: CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  color: "var(--rs-muted)",
};

const sheetCustomRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const errorBannerStyle: CSSProperties = {
  margin: 0,
  padding: "10px 14px",
  background: "var(--rs-accent-soft)",
  borderLeft: "2px solid var(--rs-accent)",
  fontSize: 13,
  color: "var(--rs-accent-text)",
};

const tileGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: 14,
};

const tileStyle: CSSProperties = {
  border: "1px solid var(--rs-line)",
  borderRadius: 10,
  padding: 20,
  minHeight: 136,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const zeroTileStyle: CSSProperties = {
  border: "1px dashed var(--rs-line)",
  borderRadius: 10,
  padding: 20,
  minHeight: 136,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const tileAccentStyle: CSSProperties = {
  background: "var(--rs-accent)",
  color: "var(--rs-on-accent)",
  borderColor: "var(--rs-accent)",
};

const tileLabelStyle: CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "var(--rs-muted)",
};

const tileLabelOnAccent: CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  opacity: 0.75,
};

const tileValueStyle: CSSProperties = {
  fontFamily: displayFont,
  fontSize: 52,
  lineHeight: 1,
  fontWeight: 700,
};

const tileNoteStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--rs-muted)",
};

const tileNoteOnAccent: CSSProperties = {
  fontSize: 12,
  opacity: 0.72,
};

const tileSplitRow: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 10,
  fontFamily: displayFont,
  fontWeight: 700,
  lineHeight: 1,
};

const tileSplitSecondary: CSSProperties = {
  fontSize: 20,
  color: "var(--rs-muted)",
};


const emptyPanelStyle: CSSProperties = {
  border: "1px dashed var(--rs-line)",
  borderRadius: 10,
  padding: "64px 24px",
  textAlign: "center",
};

const emptyHeadingStyle: CSSProperties = {
  fontFamily: displayFont,
  fontSize: 26,
  fontWeight: 600,
  textTransform: "uppercase",
};

const emptyTextStyle: CSSProperties = {
  fontSize: 14,
  color: "var(--rs-muted)",
  margin: "8px auto 0",
  maxWidth: "46ch",
};

const cardStyle: CSSProperties = {
  border: "1px solid var(--rs-line)",
  borderRadius: 10,
  overflow: "hidden",
};

const cardHeaderRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "16px 20px",
  borderBottom: "1px solid var(--rs-line)",
  flexWrap: "wrap",
};

const cardHeaderRowSimple: CSSProperties = {
  padding: "16px 20px",
  borderBottom: "1px solid var(--rs-line)",
};

const cardHeading: CSSProperties = {
  fontFamily: displayFont,
  fontSize: 22,
  fontWeight: 600,
  textTransform: "uppercase",
  margin: 0,
};

const cardHint: CSSProperties = {
  fontSize: 12,
  color: "var(--rs-muted)",
};

const legendRow: CSSProperties = {
  display: "flex",
  gap: 16,
  alignItems: "center",
  fontSize: 12,
  color: "var(--rs-muted)",
};

const legendItem: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
};

const legendDot: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 2,
};

const dayColStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
  height: "100%",
  justifyContent: "flex-end",
};

const dayTotalStyle: CSSProperties = {
  fontFamily: monoFont,
  fontSize: 12,
};

const dayBarWrapStyle: CSSProperties = {
  width: "100%",
  maxWidth: 62,
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-end",
  borderRadius: "4px 4px 0 0",
  overflow: "hidden",
};

const dayLabelStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--rs-muted)",
  whiteSpace: "nowrap",
};

const splitColumnsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.35fr 1fr",
  gap: 20,
  alignItems: "start",
};

const hoursRowStyle: CSSProperties = {
  display: "flex",
  gap: 5,
  alignItems: "end",
  height: 150,
};

const hourColStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 7,
  justifyContent: "flex-end",
  height: "100%",
};

const hourLabelStyle: CSSProperties = {
  fontFamily: monoFont,
  fontSize: 9,
  color: "var(--rs-muted)",
};

const weekdayRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "34px 1fr 34px",
  gap: 12,
  alignItems: "center",
};

const weekdayLabelStyle: CSSProperties = {
  fontFamily: monoFont,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "var(--rs-muted)",
};

const weekdayTrackStyle: CSSProperties = {
  height: 10,
  borderRadius: 5,
  background: "var(--rs-line)",
  display: "block",
  overflow: "hidden",
};

const weekdayCountStyle: CSSProperties = {
  fontFamily: monoFont,
  fontSize: 12,
  textAlign: "right",
};

const topHeadRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "34px 1.6fr 0.7fr 0.8fr 0.6fr",
  gap: 16,
  padding: "12px 20px",
  background: "var(--rs-panel)",
  fontFamily: monoFont,
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  color: "var(--rs-muted)",
};

const topRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "34px 1.6fr 0.7fr 0.8fr 0.6fr",
  gap: 16,
  alignItems: "center",
  padding: "14px 20px",
  borderTop: "1px solid var(--rs-line)",
  textDecoration: "none",
  color: "var(--rs-fg)",
};

const tableCardStyle: CSSProperties = {
  border: "1px solid var(--rs-line)",
  borderRadius: 10,
  overflow: "hidden",
};

const expiryHeadStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.4fr 1fr 1fr 1.1fr 0.8fr",
  gap: 16,
  padding: "12px 20px",
  background: "var(--rs-panel)",
  fontFamily: monoFont,
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  color: "var(--rs-muted)",
};

const expiryRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.4fr 1fr 1fr 1.1fr 0.8fr",
  gap: 16,
  alignItems: "center",
  padding: "14px 20px",
  borderTop: "1px solid var(--rs-line)",
  textDecoration: "none",
  color: "var(--rs-fg)",
};


const emptyStyleSmall: CSSProperties = {
  padding: "48px 24px",
  textAlign: "center",
  borderTop: "1px solid var(--rs-line)",
};

const emptyHeadingStyleSmall: CSSProperties = {
  fontFamily: displayFont,
  fontSize: 22,
  fontWeight: 600,
  textTransform: "uppercase",
};

