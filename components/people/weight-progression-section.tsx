"use client";

import { LoadingSkeleton } from "@/components/ui/skeleton";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  createWeightEntry,
  deleteWeightEntry,
  listWeightEntries,
  updateWeightEntry,
  type WeightEntry,
} from "@/lib/db";
import {
  formatLongDate,
  fromDateInputValue,
  toDateInputValue,
  todayDateInputValue,
} from "@/lib/dates";

const displayFont =
  "var(--font-barlow-condensed), 'Barlow Condensed', sans-serif";
const monoFont = "var(--font-geist-mono), ui-monospace, monospace";

interface WeightProgressionSectionProps {
  personId: string;
  personName: string;
  notify: (message: string) => void;
}

type PendingAction =
  | { kind: "edit"; entry: WeightEntry; weight: string; date: string }
  | { kind: "delete"; entry: WeightEntry }
  | null;

interface WeightSummary {
  latest: number | null;
  previousChange: number | null;
  totalChange: number | null;
}

export function summarizeWeights(entries: WeightEntry[]): WeightSummary {
  if (entries.length === 0) {
    return { latest: null, previousChange: null, totalChange: null };
  }
  const latest = entries.at(-1)?.weightKg ?? null;
  return {
    latest,
    previousChange:
      entries.length > 1 && latest !== null
        ? roundDelta(latest - entries[entries.length - 2].weightKg)
        : null,
    totalChange:
      entries.length > 1 && latest !== null
        ? roundDelta(latest - entries[0].weightKg)
        : null,
  };
}

function roundDelta(value: number): number {
  return Number(value.toFixed(1));
}

function sortChronologically(entries: WeightEntry[]): WeightEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.measuredAt.toMillis() - b.measuredAt.toMillis() ||
      a.createdAt.toMillis() - b.createdAt.toMillis() ||
      a.id.localeCompare(b.id),
  );
}

function validateMeasurement(weightValue: string, dateValue: string): string | null {
  const weight = Number(weightValue);
  if (!weightValue.trim() || !Number.isFinite(weight) || weight <= 0) {
    return "Enter a weight greater than 0 kg.";
  }
  if (!/^\d+(?:\.\d)?$/.test(weightValue.trim())) {
    return "Enter weight in kilograms with at most one decimal place.";
  }
  const date = fromDateInputValue(dateValue);
  if (!date) return "Choose a valid measurement date.";
  if (dateValue > todayDateInputValue()) {
    return "Measurement date can be today or earlier, not in the future.";
  }
  return null;
}

function deltaCopy(delta: number | null, emptyCopy: string): string {
  if (delta === null) return emptyCopy;
  if (delta === 0) return "No change (0.0 kg)";
  return `${delta > 0 ? "Increase" : "Decrease"} of ${Math.abs(delta).toFixed(1)} kg`;
}

export function WeightProgressionSection({
  personId,
  personName,
  notify,
}: WeightProgressionSectionProps) {
  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [date, setDate] = useState(todayDateInputValue());
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setEntries(sortChronologically(await listWeightEntries(personId)));
    } catch (error) {
      console.error("[WeightProgressionSection] load failed", error);
      setLoadError(
        /requires an index/i.test(error instanceof Error ? error.message : String(error))
          ? "Weight history needs a one-time database index setup. Contact whoever manages the system."
          : "Couldn't load weight history. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    let active = true;
    listWeightEntries(personId)
      .then((nextEntries) => {
        if (active) setEntries(sortChronologically(nextEntries));
      })
      .catch((error: unknown) => {
        console.error("[WeightProgressionSection] load failed", error);
        if (active) {
          setLoadError(
            /requires an index/i.test(
              error instanceof Error ? error.message : String(error),
            )
              ? "Weight history needs a one-time database index setup. Contact whoever manages the system."
              : "Couldn't load weight history. Check your connection and try again.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [personId]);

  const summary = useMemo(() => summarizeWeights(entries), [entries]);
  const reverseEntries = useMemo(() => [...entries].reverse(), [entries]);

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateMeasurement(weight, date);
    if (error) {
      setFormError(error);
      return;
    }
    const measuredAt = fromDateInputValue(date);
    if (!measuredAt) return;
    setBusy(true);
    setFormError(null);
    try {
      await createWeightEntry(personId, { weightKg: Number(weight), measuredAt });
      setWeight("");
      setDate(todayDateInputValue());
      await loadEntries();
      notify(`Added ${Number(weight).toFixed(1)} kg measurement for ${personName}.`);
    } catch (error) {
      console.error("[WeightProgressionSection] create failed", error);
      setFormError("Couldn't add the measurement. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(entry: WeightEntry) {
    setFormError(null);
    setPending({
      kind: "edit",
      entry,
      weight: entry.weightKg.toFixed(1),
      date: toDateInputValue(entry.measuredAt),
    });
  }

  async function confirmEdit() {
    if (!pending || pending.kind !== "edit") return;
    const error = validateMeasurement(pending.weight, pending.date);
    if (error) {
      setFormError(error);
      return;
    }
    const measuredAt = fromDateInputValue(pending.date);
    if (!measuredAt) return;
    setBusy(true);
    setFormError(null);
    try {
      await updateWeightEntry(pending.entry.id, {
        weightKg: Number(pending.weight),
        measuredAt,
      });
      setPending(null);
      await loadEntries();
      notify(`Corrected a weight measurement for ${personName}.`);
    } catch (error) {
      console.error("[WeightProgressionSection] update failed", error);
      setFormError("Couldn't save the correction. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pending || pending.kind !== "delete") return;
    setBusy(true);
    try {
      await deleteWeightEntry(pending.entry.id);
      setPending(null);
      await loadEntries();
      notify(`Deleted a weight measurement for ${personName}.`);
    } catch (error) {
      console.error("[WeightProgressionSection] delete failed", error);
      setFormError("Couldn't delete the measurement. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rs-weight" style={sectionStyle} aria-labelledby="weight-heading">
      <div className="rs-weight-head" style={sectionHeaderStyle}>
        <div>
          <h2 id="weight-heading" style={sectionHeadingStyle}>Weight progression</h2>
          <p style={adminHintStyle}>Admin-only measurement history · kilograms</p>
        </div>
        {entries.length > 0 && <span style={entryCountStyle}>{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>}
      </div>

      <form className="rs-weight-form" style={formStyle} onSubmit={handleAdd} noValidate>
        <label style={fieldStyle}>
          <span style={labelStyle}>Weight (kg)</span>
          <input
            type="number"
            inputMode="decimal"
            min="0.1"
            step="0.1"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
            placeholder="72.5"
            disabled={busy}
            style={inputStyle}
          />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Measurement date</span>
          <input
            type="date"
            max={todayDateInputValue()}
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        </label>
        <button type="submit" disabled={busy || loading || Boolean(loadError)} style={addButtonStyle}>
          {busy ? "Saving…" : "Add measurement"}
        </button>
      </form>
      {formError && !pending && <p role="alert" style={errorStyle}>{formError}</p>}

      {loading ? (
        <LoadingSkeleton label="Loading weight history…" variant="chart" count={6} />
      ) : loadError ? (
        <div role="alert" style={stateStyle}>
          <p style={{ margin: 0 }}>{loadError}</p>
          <button type="button" onClick={() => void loadEntries()} style={retryButtonStyle}>Try again</button>
        </div>
      ) : (
        <>
          <div className="rs-weight-summary" style={summaryGridStyle}>
            <SummaryCell label="Latest weight" value={summary.latest === null ? "No measurement" : `${summary.latest.toFixed(1)} kg`} />
            <SummaryCell label="From previous" value={deltaCopy(summary.previousChange, "Add a second entry")} />
            <SummaryCell label="From earliest" value={deltaCopy(summary.totalChange, "Add a second entry")} />
          </div>

          <WeightChart entries={entries} />

          <div style={historyWrapStyle}>
            <div style={historyHeaderStyle}>
              <h3 style={historyHeadingStyle}>Measurement history</h3>
              {entries.length > 0 && <span style={historyHintStyle}>Newest first</span>}
            </div>
            {reverseEntries.length === 0 ? (
              <div style={emptyStyle}>
                <strong style={emptyHeadingStyle}>No measurements yet</strong>
                <p style={emptyTextStyle}>Add the first measurement above to start tracking progress.</p>
              </div>
            ) : (
              reverseEntries.map((entry) => (
                <div className="rs-weight-row" key={entry.id} style={historyRowStyle}>
                  <span style={historyDateStyle}>{formatLongDate(entry.measuredAt)}</span>
                  <strong style={historyWeightStyle}>{entry.weightKg.toFixed(1)} kg</strong>
                  <div style={rowActionsStyle}>
                    <button type="button" disabled={busy} onClick={() => beginEdit(entry)} style={rowButtonStyle}>Edit</button>
                    <button type="button" disabled={busy} onClick={() => { setFormError(null); setPending({ kind: "delete", entry }); }} style={deleteButtonStyle}>Delete</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {pending?.kind === "edit" && (
        <ModalShell onCancel={() => { if (!busy) { setFormError(null); setPending(null); } }}>
          <h3 style={modalHeadingStyle}>Correct this measurement?</h3>
          <p style={modalCopyStyle}>Update the weight or date below, then confirm the correction. The chart and summaries will be recalculated.</p>
          <div style={modalFieldsStyle}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Weight (kg)</span>
              <input type="number" inputMode="decimal" min="0.1" step="0.1" value={pending.weight} onChange={(event) => setPending({ ...pending, weight: event.target.value })} disabled={busy} style={inputStyle} />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Measurement date</span>
              <input type="date" max={todayDateInputValue()} value={pending.date} onChange={(event) => setPending({ ...pending, date: event.target.value })} disabled={busy} style={inputStyle} />
            </label>
          </div>
          {formError && <p role="alert" style={errorStyle}>{formError}</p>}
          <ModalActions busy={busy} confirmLabel="Save correction" onCancel={() => { setFormError(null); setPending(null); }} onConfirm={() => void confirmEdit()} />
        </ModalShell>
      )}

      {pending?.kind === "delete" && (
        <ModalShell onCancel={() => { if (!busy) { setFormError(null); setPending(null); } }}>
          <h3 style={modalHeadingStyle}>Delete this measurement?</h3>
          <p style={modalCopyStyle}>Permanently delete {pending.entry.weightKg.toFixed(1)} kg from {formatLongDate(pending.entry.measuredAt)} for {personName}. The chart and summaries will be recalculated. This can&apos;t be undone.</p>
          {formError && <p role="alert" style={errorStyle}>{formError}</p>}
          <ModalActions busy={busy} destructive confirmLabel="Delete measurement" onCancel={() => { setFormError(null); setPending(null); }} onConfirm={() => void confirmDelete()} />
        </ModalShell>
      )}
    </section>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return <div style={summaryCellStyle}><span style={summaryLabelStyle}>{label}</span><strong style={summaryValueStyle}>{value}</strong></div>;
}

function WeightChart({ entries }: { entries: WeightEntry[] }) {
  if (entries.length === 0) {
    return <div style={chartEmptyStyle}><strong style={emptyHeadingStyle}>Your chart starts here</strong><p style={emptyTextStyle}>A trend appears after two measurements.</p></div>;
  }
  if (entries.length === 1) {
    return <div style={singlePointStyle}><span style={singleValueStyle}>{entries[0].weightKg.toFixed(1)} kg</span><span style={historyHintStyle}>{formatLongDate(entries[0].measuredAt)} · One measurement, so no trend is shown.</span></div>;
  }

  const width = 800;
  const height = 260;
  const left = 58;
  const right = 24;
  const top = 28;
  const bottom = 50;
  const values = entries.map((entry) => entry.weightKg);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const padding = Math.max((maxValue - minValue) * 0.18, 1);
  const yMin = minValue - padding;
  const yMax = maxValue + padding;
  const x = (index: number) => left + (index / (entries.length - 1)) * (width - left - right);
  const y = (value: number) => top + ((yMax - value) / (yMax - yMin)) * (height - top - bottom);
  const points = entries.map((entry, index) => `${x(index)},${y(entry.weightKg)}`).join(" ");
  const ticks = [yMax, (yMax + yMin) / 2, yMin];
  const labelIndexes = [...new Set([0, Math.floor((entries.length - 1) / 2), entries.length - 1])];

  return (
    <div style={chartWrapStyle}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="weight-chart-title weight-chart-desc" style={chartStyle}>
        <title id="weight-chart-title">Chronological weight chart</title>
        <desc id="weight-chart-desc">{entries.map((entry) => `${formatLongDate(entry.measuredAt)}: ${entry.weightKg.toFixed(1)} kilograms`).join("; ")}</desc>
        {ticks.map((tick) => <g key={tick}><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="var(--rs-line)" strokeWidth="1" /><text x={left - 10} y={y(tick) + 4} textAnchor="end" fill="var(--rs-muted)" fontSize="11" fontFamily={monoFont}>{tick.toFixed(1)}</text></g>)}
        <polyline points={points} fill="none" stroke="var(--rs-accent)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {entries.map((entry, index) => <circle key={entry.id} cx={x(index)} cy={y(entry.weightKg)} r="5" fill="var(--rs-bg)" stroke="var(--rs-accent)" strokeWidth="3"><title>{formatLongDate(entry.measuredAt)}: {entry.weightKg.toFixed(1)} kg</title></circle>)}
        {labelIndexes.map((index) => <text key={index} x={x(index)} y={height - 18} textAnchor={index === 0 ? "start" : index === entries.length - 1 ? "end" : "middle"} fill="var(--rs-muted)" fontSize="11" fontFamily={monoFont}>{toDateInputValue(entries[index].measuredAt)}</text>)}
      </svg>
      <p style={chartCaptionStyle}>Measurements are ordered by date. Multiple measurements on the same date remain separate points in entry order.</p>
    </div>
  );
}

function ModalShell({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  return <div role="presentation" style={overlayStyle} onClick={onCancel}><div role="dialog" aria-modal="true" style={modalStyle} onClick={(event) => event.stopPropagation()}>{children}</div></div>;
}

function ModalActions({ busy, confirmLabel, destructive = false, onCancel, onConfirm }: { busy: boolean; confirmLabel: string; destructive?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div style={modalActionsStyle}><button type="button" disabled={busy} onClick={onCancel} style={cancelButtonStyle}>Cancel</button><button type="button" disabled={busy} onClick={onConfirm} style={{ ...confirmButtonStyle, background: destructive ? "var(--rs-accent)" : "var(--rs-fg)", color: destructive ? "var(--rs-on-accent)" : "var(--rs-bg)" }}>{busy ? "Saving…" : confirmLabel}</button></div>;
}

const sectionStyle: CSSProperties = { border: "1px solid var(--rs-line)", borderRadius: 10, overflow: "hidden" };
const sectionHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, padding: "20px 20px 16px" };
const sectionHeadingStyle: CSSProperties = { margin: 0, fontFamily: displayFont, fontSize: 25, fontWeight: 600, textTransform: "uppercase" };
const adminHintStyle: CSSProperties = { margin: "4px 0 0", color: "var(--rs-muted)", fontSize: 12 };
const entryCountStyle: CSSProperties = { fontFamily: monoFont, color: "var(--rs-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" };
const formStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(130px, .7fr) minmax(180px, 1fr) auto", gap: 12, alignItems: "end", padding: "18px 20px", background: "var(--rs-panel)", borderTop: "1px solid var(--rs-line)", borderBottom: "1px solid var(--rs-line)" };
const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 7 };
const labelStyle: CSSProperties = { fontFamily: monoFont, color: "var(--rs-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em" };
const inputStyle: CSSProperties = { width: "100%", height: 42, boxSizing: "border-box", border: "1px solid var(--rs-line)", borderRadius: 6, background: "var(--rs-bg)", color: "var(--rs-fg)", padding: "0 12px", fontFamily: monoFont, fontSize: 13 };
const addButtonStyle: CSSProperties = { height: 42, padding: "0 17px", border: 0, borderRadius: 6, background: "var(--rs-accent)", color: "var(--rs-on-accent)", fontFamily: displayFont, fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer", whiteSpace: "nowrap" };
const errorStyle: CSSProperties = { margin: 0, padding: "10px 20px", background: "var(--rs-accent-soft)", color: "var(--rs-accent-text)", fontSize: 13 };
const stateStyle: CSSProperties = { padding: "42px 20px", color: "var(--rs-muted)", textAlign: "center", fontSize: 14 };
const retryButtonStyle: CSSProperties = { marginTop: 14, height: 36, padding: "0 14px", border: "1px solid var(--rs-line)", borderRadius: 6, background: "transparent", color: "var(--rs-fg)", cursor: "pointer" };
const summaryGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderBottom: "1px solid var(--rs-line)" };
const summaryCellStyle: CSSProperties = { minWidth: 0, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 7, borderRight: "1px solid var(--rs-line)" };
const summaryLabelStyle: CSSProperties = { fontFamily: monoFont, color: "var(--rs-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em" };
const summaryValueStyle: CSSProperties = { fontFamily: displayFont, fontSize: 22, fontWeight: 600, textTransform: "uppercase" };
const chartWrapStyle: CSSProperties = { padding: "18px 20px 12px", borderBottom: "1px solid var(--rs-line)", overflowX: "auto" };
const chartStyle: CSSProperties = { display: "block", width: "100%", minWidth: 520, height: "auto" };
const chartCaptionStyle: CSSProperties = { margin: "6px 0 0", color: "var(--rs-muted)", fontSize: 11 };
const chartEmptyStyle: CSSProperties = { padding: "44px 20px", textAlign: "center", borderBottom: "1px solid var(--rs-line)" };
const singlePointStyle: CSSProperties = { padding: "30px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, borderBottom: "1px solid var(--rs-line)", background: "var(--rs-panel)" };
const singleValueStyle: CSSProperties = { fontFamily: displayFont, fontSize: 42, fontWeight: 600 };
const historyWrapStyle: CSSProperties = { display: "flex", flexDirection: "column" };
const historyHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "15px 20px", background: "var(--rs-panel)" };
const historyHeadingStyle: CSSProperties = { margin: 0, fontFamily: displayFont, fontSize: 17, fontWeight: 600, textTransform: "uppercase" };
const historyHintStyle: CSSProperties = { color: "var(--rs-muted)", fontSize: 12 };
const historyRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 18, padding: "13px 20px", borderTop: "1px solid var(--rs-line)" };
const historyDateStyle: CSSProperties = { fontFamily: monoFont, fontSize: 13 };
const historyWeightStyle: CSSProperties = { fontFamily: monoFont, fontSize: 14 };
const rowActionsStyle: CSSProperties = { display: "flex", gap: 7 };
const rowButtonStyle: CSSProperties = { height: 30, padding: "0 10px", border: "1px solid var(--rs-line)", borderRadius: 6, background: "transparent", color: "var(--rs-fg)", fontSize: 12, cursor: "pointer" };
const deleteButtonStyle: CSSProperties = { ...rowButtonStyle, color: "var(--rs-accent-text)" };
const emptyStyle: CSSProperties = { padding: "38px 20px", textAlign: "center" };
const emptyHeadingStyle: CSSProperties = { display: "block", fontFamily: displayFont, fontSize: 20, textTransform: "uppercase" };
const emptyTextStyle: CSSProperties = { margin: "6px 0 0", color: "var(--rs-muted)", fontSize: 13 };
const overlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", padding: 22, background: "rgba(10, 10, 10, .58)" };
const modalStyle: CSSProperties = { width: "100%", maxWidth: 450, padding: 25, border: "1px solid var(--rs-line)", borderRadius: 12, background: "var(--rs-bg)", boxShadow: "0 30px 80px rgba(10, 10, 10, .28)" };
const modalHeadingStyle: CSSProperties = { margin: "0 0 8px", fontFamily: displayFont, fontSize: 26, fontWeight: 600, textTransform: "uppercase" };
const modalCopyStyle: CSSProperties = { margin: "0 0 20px", color: "var(--rs-muted)", fontSize: 14, lineHeight: 1.55 };
const modalFieldsStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
const modalActionsStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 22 };
const cancelButtonStyle: CSSProperties = { height: 40, padding: "0 15px", border: "1px solid var(--rs-line)", borderRadius: 6, background: "transparent", color: "var(--rs-fg)", cursor: "pointer" };
const confirmButtonStyle: CSSProperties = { height: 40, padding: "0 17px", border: 0, borderRadius: 6, fontWeight: 600, cursor: "pointer" };
