"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { statusBadgeStyle } from "@/lib/status-badge";

export interface CheckInRow {
  logId: string;
  personId: string | null;
  name: string;
  phone: string;
  typeLabel: string;
  sourceLabel: string;
  time: string;
  badge: { text: string; kind: "active" | "expired" | "guest" };
}

export function CheckInFeed({ rows, loading }: { rows: CheckInRow[]; loading: boolean }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  // A live deletion can remove the last page. Clamp the stored selection as
  // well as the rendered page so a later arrival cannot jump it forward again.
  const currentPage = Math.min(page, pageCount);
  if (page !== currentPage) setPage(currentPage);
  const start = (currentPage - 1) * pageSize;
  const visibleRows = rows.slice(start, start + pageSize);
  const pageNumbers = pageCount <= 7
    ? Array.from({ length: pageCount }, (_, i) => i + 1)
    : [...new Set([1, currentPage - 1, currentPage, currentPage + 1, pageCount])]
      .filter(n => n >= 1 && n <= pageCount).sort((a, b) => a - b);

  function goTo(next: number) {
    setPage(next);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }

  return <section className="rs-ov-feed" aria-labelledby="check-in-heading">
    <header className="rs-ov-feed-head">
      <h2 id="check-in-heading">Recent check-ins</h2>
      <span>{loading ? "Connecting…" : `${rows.length} today · Live updates`}</span>
    </header>
    <div className="rs-ov-feed-columns" aria-hidden="true"><span>Person / source</span><span>Check-in time</span></div>
    <div ref={scrollRef} className="rs-ov-feed-scroll" role="region" aria-label="Check-in rows" tabIndex={0} aria-busy={loading}>
      {loading ? <div className="rs-ov-feed-loading" role="status">Loading check-ins…</div> : !rows.length ?
        <div className="rs-ov-feed-empty"><h3>No check-ins yet today</h3><p>The first QR scan or RFID tap will appear here automatically.</p></div> :
        visibleRows.map(row => <Link key={row.logId} href={row.personId ? `/dashboard/people/${row.personId}` : "/dashboard/people"} className="rs-ov-checkin">
          <span className="rs-ov-avatar" aria-hidden="true">{row.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("")}</span>
          <span className="rs-ov-person"><strong>{row.name}</strong><span>{row.phone} · {row.typeLabel} · {row.sourceLabel}</span></span>
          <span className="rs-ov-checkin-status"><span style={statusBadgeStyle(row.badge.kind)}>{row.badge.text}</span><time>{row.time}</time></span>
        </Link>)}
    </div>
    <footer className="rs-ov-feed-footer">
      <div className="rs-ov-feed-range"><span role="status" aria-live="polite">{loading ? "Loading…" : `Showing ${rows.length ? start + 1 : 0}–${Math.min(start + pageSize, rows.length)} of ${rows.length}`}</span>
        <label>Per page<select disabled={loading} value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); goTo(1); }}>
          <option value={5}>5</option><option value={10}>10</option><option value={25}>25</option>
        </select></label>
      </div>
      <nav className="rs-ov-pagination" aria-label="Check-in pagination">
        <button type="button" disabled={loading || currentPage === 1} onClick={() => goTo(currentPage - 1)} aria-label="Previous check-in page">Previous</button>
        {pageNumbers.map((n, index) => <span className="rs-ov-page-item" key={n}>
          {index > 0 && n - pageNumbers[index - 1] > 1 && <span className="rs-ov-page-gap" aria-hidden="true">…</span>}
          <button type="button" disabled={loading || rows.length === 0} aria-label={`Check-in page ${n}`} aria-current={n === currentPage ? "page" : undefined} onClick={() => goTo(n)}>{n}</button>
        </span>)}
        <button type="button" disabled={loading || currentPage === pageCount} onClick={() => goTo(currentPage + 1)} aria-label="Next check-in page">Next</button>
      </nav>
    </footer>
  </section>;
}
