"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { timeLabel } from "@/lib/coaching/bookings";
import type { TimeSlot } from "@/lib/coaching/catalog";
import { philippineDate } from "@/lib/finance/rules";
import { BrandLoading } from "@/components/ui/brand-loading";
import { Schedule, dateLabel, firstOfMonth, useSchedule, type ScheduleClient, type ScheduleData, type Sheet } from "@/app/coach/schedule";
import { AdminClients } from "./coaching-admin-clients";
import { AssignSheet, ClientSheet } from "./coaching-admin-sheets";
import s from "./coaching-admin.module.css";

export type AdminClient = ScheduleClient;
export type AdminData = ScheduleData & { coaches: { id: string; name: string }[] };
/** Each coach's colour, by their order in the coach list (blue and orange first, told apart by lightness too). */
const COLORS = ["#8ab4ff", "#f2a65a", "#c4a7ff", "#7fd4c9", "#ff9db5", "#d9d36a"];
export const coachVar = (color: string) => ({ "--coach": color }) as CSSProperties;
export const SLOT_NAMES: Record<TimeSlot, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };
/** "Mon, Tue mornings" */
export const shortPreference = (client: ScheduleClient) => client.preferredSchedule
  ? `${client.preferredSchedule.weekdays.map(day => day[0].toUpperCase() + day.slice(1)).join(", ")} ${SLOT_NAMES[client.preferredSchedule.timeSlot].toLowerCase()}s` : "No preferred schedule";

type ClientSheetState = { kind: "assign"; personId: string } | { kind: "client"; personId: string } | null;

/** Admin › Coaching: every coach's Schedule as day cards (the coach portal's view, with coach badges and a coach filter), and the Clients list. */
export function AdminCoaching() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"schedule" | "clients">("schedule"), [start, setStart] = useState<{ sheet: Sheet; key: number }>({ sheet: null, key: 0 });
  const header = <header className={s.head}>
    <div><div className={s.kicker}>Clients &amp; coaches</div><h1 className={s.title}>Coaching</h1>
      <p className={s.sub}>Add sessions with each client’s coach and see every coach’s month. Sessions already done stay credited to the coach who ran them.</p></div>
  </header>;
  const tabs = <div role="group" aria-label="Coaching view" className={s.tabs}>
    <button type="button" aria-pressed={tab === "schedule"} onClick={() => setTab("schedule")}>Schedule</button>
    <button type="button" aria-pressed={tab === "clients"} onClick={() => setTab("clients")}>Clients</button>
  </div>;
  if (!user) return <main className={s.page}>{header}<BrandLoading label="Loading coaching" /></main>;
  if (tab === "schedule") return <Schedule key={start.key} user={user} admin initial={start.sheet} toolbar={<>{header}{tabs}</>} />;
  return <ClientsTab user={user} header={header} tabs={tabs} onBook={(personId, coachId) => {
    setStart(value => ({ sheet: { kind: "add", date: philippineDate(Date.now()), personId, coachId }, key: value.key + 1 })); setTab("schedule");
  }} />;
}

/** The Clients tab: one list of every coaching client, assigning coaches, freezes and session adjustments. */
function ClientsTab({ user, header, tabs, onBook }: { user: NonNullable<ReturnType<typeof useAuth>["user"]>; header: ReactNode; tabs: ReactNode; onBook(personId: string, coachId?: string): void }) {
  const [today] = useState(() => philippineDate(Date.now()));
  const { data: loaded, error, retry, send, busy, notice, actionError, clear } = useSchedule(user, "/api/admin/coach-bookings", firstOfMonth(today));
  const [sheet, setSheet] = useState<ClientSheetState>(null), [report, setReport] = useState("");
  if (!loaded) return <main className={s.page}>{header}{tabs}{error
    ? <><p className={s.error} role="alert">{error}</p><button type="button" className={s.button} style={{ alignSelf: "flex-start" }} onClick={retry}>Retry</button></>
    : <BrandLoading label="Loading coaching" />}</main>;
  const data = { ...loaded, coaches: loaded.coaches ?? [] } as AdminData;
  const colors = new Map(data.coaches.map((row, index) => [row.id, COLORS[index % COLORS.length]]));
  const colorOf = (id: string | null | undefined) => (id && colors.get(id)) || "var(--rs-muted)";
  const coachName = (id: string | null | undefined) => data.coaches.find(row => row.id === id)?.name ?? "Former coach";
  const open = (next: ClientSheetState) => { clear(); setReport(""); setSheet(next); };
  const client = sheet ? data.clients.find(row => row.id === sheet.personId) : undefined;
  return <main className={s.page}>
    {header}
    {actionError && !sheet && <p className={s.error} role="alert">{actionError}</p>}
    {(report || notice) && !sheet && <p className={s.notice} role="status" style={{ whiteSpace: "pre-line" }}>{report || notice}</p>}
    <AdminClients data={data} colorOf={colorOf} coachName={coachName} tabs={tabs} busy={busy}
      onAssign={personId => open({ kind: "assign", personId })} onBook={personId => onBook(personId)} onOpen={personId => open({ kind: "client", personId })} onChanged={retry} />
    {sheet?.kind === "assign" && client && <AssignSheet data={data} client={client} colorOf={colorOf} busy={busy} error={actionError} onClose={() => setSheet(null)}
      onAssign={async (coachId, bookNext) => {
        const result = await send("/api/admin/coach-assignments", { personId: client.id, coachId }, `${client.name} is now coached by ${coachName(coachId)}.`);
        if (!result) return;
        // Switching coach moves upcoming sessions; say which ones were cancelled because the new coach was busy.
        const cancelled = (result.cancelled ?? []) as { date: string; start: number }[], moved = Number(result.moved ?? 0), coach = firstOf(coachName(coachId));
        setReport([`${client.name} is now coached by ${coachName(coachId)}.`, moved ? `${moved} upcoming session${moved === 1 ? "" : "s"} moved to ${coach}.` : "",
          cancelled.length ? `Cancelled because ${coach} was busy: ${cancelled.map(row => `${dateLabel(row.date, { weekday: "short", month: "short", day: "numeric" })} ${timeLabel(row.start)}`).join(", ")}.` : ""].filter(Boolean).join("\n"));
        setSheet(null);
        if (bookNext) onBook(client.id, coachId);
      }} />}
    {sheet?.kind === "client" && client && <ClientSheet user={user} client={client} coachName={coachName} colorOf={colorOf}
      onClose={() => setSheet(null)} onChanged={retry} onBook={() => onBook(client.id, client.coachId ?? undefined)} onSwitch={() => open({ kind: "assign", personId: client.id })} />}
  </main>;
}
const firstOf = (name: string) => name.split(/\s+/)[0];
