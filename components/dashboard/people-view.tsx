"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  effectiveMemberStatus,
  watchAllPersons,
  type Person,
} from "@/lib/db";
import { formatShortDateTime } from "@/lib/dates";
import { statusBadgeStyle } from "@/lib/status-badge";
import styles from "./people-filter-select.module.css";

// TASKLIST Phase 8 - Admin Dashboard: People tab.
//
// Members and guests in one searchable / filterable / sortable list
// (admin-dashboard-content.md §2). The roster rides the live `watchAllPersons`
// listener so a create / edit / delete elsewhere reflects without a reload; the
// "last visit" column reads the denormalized `Person.lastVisitAt` field
// (bumped by `recordCheckIn` alongside `visitCount`), so it's exact and O(1)
// per person rather than a capped scan of `attendanceLogs`.

const displayFont =
  "var(--font-barlow-condensed), 'Barlow Condensed', sans-serif";
const monoFont = "var(--font-geist-mono), ui-monospace, monospace";


type TypeFilter = "all" | "member" | "guest";
type StatusFilter = "all" | "active" | "expired";
type SortKey = "lastVisit" | "name" | "joinDate";

type FilterOption<T extends string> = {
  value: T;
  label: string;
};

type FilterSelectProps<T extends string> = {
  label: string;
  value: T;
  options: readonly FilterOption<T>[];
  onChange: (value: T) => void;
  align?: "start" | "end";
};

const GRID_COLUMNS = "1.5fr 1fr 0.7fr 0.8fr 1fr 0.6fr";

const typeOptions: readonly FilterOption<TypeFilter>[] = [
  { value: "all", label: "All types" },
  { value: "member", label: "Members" },
  { value: "guest", label: "Guests" },
];

const statusOptions: readonly FilterOption<StatusFilter>[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
];

const sortOptions: readonly FilterOption<SortKey>[] = [
  { value: "lastVisit", label: "Last visit" },
  { value: "name", label: "Name" },
  { value: "joinDate", label: "Join date" },
];

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  align = "start",
}: FilterSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, options.findIndex((option) => option.value === value)),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const selectedOption =
    options.find((option) => option.value === value) ?? options[0];
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  useEffect(() => {
    if (!open) return;

    const frame = requestAnimationFrame(() => {
      optionRefs.current[selectedIndex]?.focus();
    });

    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [open, selectedIndex]);

  function toggleMenu() {
    if (!open) setActiveIndex(selectedIndex);
    setOpen((current) => !current);
  }

  function openFromKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    setActiveIndex(selectedIndex);
    setOpen(true);
  }

  function handleOptionKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex = index;

    if (event.key === "ArrowDown") nextIndex = (index + 1) % options.length;
    else if (event.key === "ArrowUp") {
      nextIndex = (index - 1 + options.length) % options.length;
    } else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = options.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    } else if (event.key === "Tab") {
      setOpen(false);
      return;
    } else {
      return;
    }

    event.preventDefault();
    setActiveIndex(nextIndex);
    optionRefs.current[nextIndex]?.focus();
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={`${label}: ${selectedOption.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={toggleMenu}
        onKeyDown={openFromKeyboard}
      >
        <span className={styles.triggerCopy}>
          <span className={styles.label}>{label}</span>
          <span className={styles.value}>{selectedOption.label}</span>
        </span>
        <span className={styles.chevron} aria-hidden="true" />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className={`${styles.menu} ${
            align === "end" ? styles.menuEnd : ""
          }`}
        >
          <div className={styles.menuLabel} aria-hidden="true">
            {label}
          </div>
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={activeIndex === index ? 0 : -1}
                className={`${styles.option} ${
                  selected ? styles.optionSelected : ""
                }`}
                onFocus={() => setActiveIndex(index)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <span>{option.label}</span>
                <span className={styles.optionMark} aria-hidden="true">
                  {selected ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PeopleView() {
  const [people, setPeople] = useState<Person[]>([]);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [listenerError, setListenerError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("lastVisit");

  useEffect(() => {
    const unsub = watchAllPersons(
      (list) => {
        setPeople(list);
        setPeopleLoaded(true);
      },
      (err) => {
        console.error("[PeopleView] persons listener failed", err);
        setListenerError(true);
      },
    );
    return unsub;
  }, [retryKey]);

  function retryLiveUpdates() {
    setListenerError(false);
    setPeopleLoaded(false);
    setRetryKey((k) => k + 1);
  }

  const filtersActive =
    search.trim() !== "" || typeFilter !== "all" || statusFilter !== "all";

  function clearFilters() {
    setSearch("");
    setTypeFilter("all");
    setStatusFilter("all");
  }

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();

    const matched = people.filter((p) => {
      if (term) {
        const hitName = p.name.toLowerCase().includes(term);
        const hitPhone = p.phone.toLowerCase().includes(term);
        if (!hitName && !hitPhone) return false;
      }
      if (typeFilter !== "all" && p.type !== typeFilter) return false;
      if (statusFilter !== "all") {
        // Status is a members-only concept; a status filter excludes guests.
        if (p.type !== "member") return false;
        const status = effectiveMemberStatus(p);
        if (statusFilter === "expired" && status !== "expired") return false;
        if (statusFilter === "active" && status === "expired") return false;
      }
      return true;
    });

    const lastVisitMillis = (p: Person) => p.lastVisitAt?.toMillis() ?? 0;

    matched.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "joinDate") {
        return (
          (b.joinDate?.toMillis() ?? 0) - (a.joinDate?.toMillis() ?? 0)
        );
      }
      // lastVisit: most recent first, never-visited sinks to the bottom.
      return lastVisitMillis(b) - lastVisitMillis(a);
    });

    return matched;
  }, [people, search, typeFilter, statusFilter, sortKey]);

  const loading = !peopleLoaded;
  const noneAtAll = !loading && people.length === 0;
  const noMatches = !loading && people.length > 0 && rows.length === 0;

  return (
    <main className="rs-ppl" style={pageStyle}>
      <header className="rs-ppl-head" style={headerRow}>
        <div>
          <div className="rs-ppl-kicker" style={kickerStyle}>
            {loading
              ? "Loading profiles…"
              : `${people.length} ${
                  people.length === 1 ? "profile" : "profiles"
                }`}
          </div>
          <h1 className="rs-ppl-title" style={headingStyle}>
            People
          </h1>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Link
            href="/dashboard/people/unverified"
            style={{ ...newButtonStyle, background: "var(--rs-panel)", color: "var(--rs-fg)", border: "1px solid var(--rs-line)" }}
          >
            Unverified members
          </Link>
          <Link
            href="/dashboard/people/new"
            className="rs-ppl-new"
            style={newButtonStyle}
          >
            New profile
          </Link>
        </div>
      </header>

      {listenerError && (
        <div style={errorBannerStyle}>
          <span>Live updates dropped out.</span>
          <button type="button" onClick={retryLiveUpdates} style={retryButtonStyle}>
            Retry
          </button>
        </div>
      )}

      <div className="rs-ppl-controls" style={controlsRow}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone"
          aria-label="Search people by name or phone"
          className="rs-ppl-search"
          style={searchInputStyle}
        />
        <FilterSelect
          label="Type"
          value={typeFilter}
          options={typeOptions}
          onChange={setTypeFilter}
        />
        <FilterSelect
          label="Status"
          value={statusFilter}
          options={statusOptions}
          onChange={setStatusFilter}
        />
        <FilterSelect
          label="Sort"
          value={sortKey}
          options={sortOptions}
          onChange={setSortKey}
          align="end"
        />
        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="rs-ppl-clear"
            style={clearButtonStyle}
          >
            Clear filters
          </button>
        )}
      </div>

      <section
        className="rs-ppl-list"
        style={tableCardStyle}
        aria-label="People list"
        tabIndex={0}
      >
        <div className="rs-ppl-thead" style={tableHeadStyle}>
          <span>Name</span>
          <span>Phone</span>
          <span>Type</span>
          <span>Status</span>
          <span>Last visit</span>
          <span>Visits</span>
        </div>

        {loading ? (
          [0, 1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="rs-ppl-skel" style={skeletonRowStyle}>
              {[0, 1, 2, 3, 4, 5].map((c) => (
                <div key={c} style={skelBar} />
              ))}
            </div>
          ))
        ) : noneAtAll ? (
          <div className="rs-ppl-empty" style={emptyStyle}>
            <div style={emptyHeadingStyle}>No profiles yet</div>
            <p style={emptyTextStyle}>
              Create your first member or guest profile.
            </p>
            <Link href="/dashboard/people/new" style={newButtonStyle}>
              New profile
            </Link>
          </div>
        ) : noMatches ? (
          <div className="rs-ppl-empty" style={emptyStyle}>
            <div style={emptyHeadingStyle}>No matches</div>
            <p style={emptyTextStyle}>
              No matches for{" "}
              {search.trim() ? (
                <strong>&ldquo;{search.trim()}&rdquo;</strong>
              ) : (
                "the current filters"
              )}{"."} Try a different search or clear filters.
            </p>
            <button
              type="button"
              onClick={clearFilters}
              style={clearButtonStyle}
            >
              Clear filters
            </button>
          </div>
        ) : (
          rows.map((p) => {
            const isMember = p.type === "member";
            const lastVisit = p.lastVisitAt;
            return (
              <div
                key={p.id}
                className="rs-ppl-row"
                style={rowStyle}
              >
                <Link href={`/dashboard/people/${p.id}`} className="rs-ppl-name" style={{ ...nameCellStyle, color: "inherit" }}>
                  {p.name}
                </Link>
                <span className="rs-ppl-phone" style={phoneCellStyle}>
                  {p.phone}
                </span>
                <span className="rs-ppl-type" style={typeCellStyle}>
                  {isMember ? "Member" : "Guest"}
                </span>
                <span className="rs-ppl-status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  {isMember ? (
                    <span
                      style={statusBadgeStyle(
                        effectiveMemberStatus(p) === "expired"
                          ? "expired"
                          : "active",
                      )}
                    >
                      {effectiveMemberStatus(p) === "expired"
                        ? "Expired"
                        : "Active"}
                    </span>
                  ) : (
                    <span style={{ color: "var(--rs-muted)" }}>-</span>
                  )}
                  <Link className="rs-membership-shortcut" href={`/dashboard/people/${p.id}/${isMember ? "renew" : "convert"}`} aria-label={`${isMember ? "Renew membership" : "Add membership"} for ${p.name}`} style={{ color: "var(--rs-accent-text)", fontSize: 12 }}>
                    {isMember ? "Renew" : "Add membership"}
                  </Link>
                </span>
                <span className="rs-ppl-visit" style={lastVisitCellStyle}>
                  {lastVisit ? formatShortDateTime(lastVisit) : "No visits yet"}
                </span>
                <span className="rs-ppl-count" style={visitsCellStyle}>
                  {p.visitCount}
                  <span className="rs-ppl-count-unit">
                    {p.visitCount === 1 ? " visit" : " visits"}
                  </span>
                </span>
              </div>
            );
          })
        )}
      </section>
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

const headingStyle: CSSProperties = {
  fontFamily: displayFont,
  fontSize: 46,
  lineHeight: 1,
  fontWeight: 600,
  textTransform: "uppercase",
  margin: "8px 0 0",
};

// Matches the Overview tab's date kicker so the two headers read as one system.
const kickerStyle: CSSProperties = {
  fontFamily: monoFont,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.16em",
  color: "var(--rs-muted)",
};

const newButtonStyle: CSSProperties = {
  height: 38,
  display: "inline-flex",
  alignItems: "center",
  padding: "0 18px",
  borderRadius: 6,
  background: "var(--rs-accent)",
  color: "var(--rs-on-accent)",
  fontSize: 14,
  fontWeight: 600,
  textDecoration: "none",
  fontFamily: displayFont,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const errorBannerStyle: CSSProperties = {
  margin: 0,
  padding: "10px 14px",
  background: "var(--rs-accent-soft)",
  borderLeft: "2px solid var(--rs-accent)",
  fontSize: 13,
  color: "var(--rs-accent-text)",
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const retryButtonStyle: CSSProperties = {
  height: 26,
  padding: "0 12px",
  border: "1px solid var(--rs-accent)",
  borderRadius: 5,
  background: "transparent",
  color: "var(--rs-accent-text)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const controlsRow: CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  alignItems: "center",
};

const searchInputStyle: CSSProperties = {
  height: 38,
  width: 280,
  padding: "0 12px",
  border: "1px solid var(--rs-line)",
  background: "var(--rs-bg)",
  color: "var(--rs-fg)",
  borderRadius: 6,
  outline: "none",
  fontSize: 14,
};

const clearButtonStyle: CSSProperties = {
  height: 38,
  padding: "0 14px",
  border: "1px solid var(--rs-line)",
  borderRadius: 6,
  background: "transparent",
  color: "var(--rs-fg)",
  fontSize: 13,
  cursor: "pointer",
};

const tableCardStyle: CSSProperties = {
  border: "1px solid var(--rs-line)",
  borderRadius: 10,
  overflow: "hidden",
};

const tableHeadStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: GRID_COLUMNS,
  gap: 16,
  padding: "12px 20px",
  background: "var(--rs-panel)",
  fontFamily: monoFont,
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  color: "var(--rs-muted)",
};

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: GRID_COLUMNS,
  gap: 16,
  alignItems: "center",
  padding: "14px 20px",
  borderTop: "1px solid var(--rs-line)",
  textDecoration: "none",
  color: "var(--rs-fg)",
};

const skeletonRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: GRID_COLUMNS,
  gap: 16,
  padding: "16px 20px",
  borderTop: "1px solid var(--rs-line)",
  animation: "shimmer 1.4s ease-in-out infinite",
};

const skelBar: CSSProperties = {
  height: 11,
  background: "var(--rs-line)",
  borderRadius: 3,
};

const nameCellStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const phoneCellStyle: CSSProperties = {
  fontFamily: monoFont,
  fontSize: 13,
  color: "var(--rs-muted)",
  whiteSpace: "nowrap",
};

const typeCellStyle: CSSProperties = {
  fontSize: 13,
};

const lastVisitCellStyle: CSSProperties = {
  fontSize: 13,
  color: "var(--rs-muted)",
  whiteSpace: "nowrap",
};

const visitsCellStyle: CSSProperties = {
  fontFamily: monoFont,
  fontSize: 13,
};

const emptyStyle: CSSProperties = {
  padding: "56px 24px",
  textAlign: "center",
  borderTop: "1px solid var(--rs-line)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 10,
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
  margin: 0,
  maxWidth: "48ch",
};
