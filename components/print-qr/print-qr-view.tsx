"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { GYM_NAME } from "@/lib/checkin-url";

// Pre-rendered posters in /public: client-side canvas generation failed on some
// devices. shortcut: the QR URLs are baked in, regenerate the PNGs if the domain changes.
const POSTER_WIDTH = 1240;
const POSTER_HEIGHT = 1754;
const POSTERS = {
  checkin: {
    label: "Check-in", url: "https://tibay-gym.vercel.app/checkin", image: "/qr/checkin-poster.png",
    description: "For the entrance: members and guests scan to check in.", file: "tibay-gym-check-in-qr",
  },
  customer: {
    label: "Customer page", url: "https://tibay-gym.vercel.app/customer", image: "/qr/customer-poster.png",
    description: "For the counter: customers scan to view their membership, request a renewal, and follow payment status.", file: "tibay-gym-customer-qr",
  },
} as const;
type PosterKind = keyof typeof POSTERS;

type Notice = { tone: "info" | "error"; text: string } | null;

const displayFont =
  "var(--font-barlow-condensed), 'Barlow Condensed', sans-serif";
const monoFont = "var(--font-geist-mono), ui-monospace, monospace";

// Strip icons. Same 24-box, currentColor, hand-drawn convention as
// components/dashboard/nav-icons.tsx; they only ever show in the mobile strip.
const ICON_BASE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: "false" as const,
  width: 20,
  height: 20,
};

/** Download image — a picture frame with a horizon and a sun. */
function IconImage() {
  return (
    <svg {...ICON_BASE}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="M3.5 16.5l4.8-4.2a2 2 0 0 1 2.7.06L20.5 20" />
    </svg>
  );
}

/** Download PDF — a document with a folded corner. */
function IconDocument() {
  return (
    <svg {...ICON_BASE}>
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
      <path d="M13.5 3v5.5H19" />
      <path d="M8.5 13.5h7M8.5 17h4.5" />
    </svg>
  );
}

/** Print — a printer with paper feeding through it. */
function IconPrinter() {
  return (
    <svg {...ICON_BASE}>
      <path d="M7 9V3.5h10V9" />
      <path d="M7 17.5H5.5a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H17" />
      <rect x="7" y="14" width="10" height="6.5" rx="1" />
    </svg>
  );
}

/** Copy — one sheet offset behind another. Smaller box than the strip icons. */
function IconCopy() {
  return (
    <svg {...ICON_BASE} width={16} height={16}>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <path d="M15 5.5a2 2 0 0 0-2-2H5.5a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2" />
    </svg>
  );
}

/** Copied — the confirmation the copy button swaps to. */
function IconCheck() {
  return (
    <svg {...ICON_BASE} width={16} height={16}>
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

/** Open — an arrow leaving its frame. */
function IconExternal() {
  return (
    <svg {...ICON_BASE} width={16} height={16}>
      <path d="M18.5 13.5v5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2h5" />
      <path d="M14 3.5h6.5V10" />
      <path d="M20.5 3.5L11 13" />
    </svg>
  );
}

export function PrintQrView() {
  const [kind, setKind] = useState<PosterKind>("checkin");
  return <main className="rs-qr" style={pageStyle}>
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <header className="rs-qr-head" style={headerRow}>
        <div><div className="rs-qr-kicker" style={kickerStyle}>{GYM_NAME}</div>
          <h1 className="rs-qr-title" style={headingStyle}>QR codes</h1></div>
      </header>
      <p className="rs-qr-lead" style={leadStyle}>Choose a destination, then download or print its poster.</p>
      <div className="rs-qr-selector" role="group" aria-label="QR destination">
        {(Object.keys(POSTERS) as PosterKind[]).map(value =>
          <button type="button" key={value} aria-pressed={kind === value}
            onClick={() => setKind(value)}>{POSTERS[value].label}</button>)}
      </div>
      <QrPoster key={kind} kind={kind} />
    </div>
  </main>;
}

function QrPoster({ kind }: { kind: PosterKind }) {
  const poster = POSTERS[kind];
  const { url, image, file: fileStem } = poster;
  const [busy, setBusy] = useState<null | "pdf" | "print">(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const downloadPdf = useCallback(async () => {
    setBusy("pdf");
    setNotice(null);
    try {
      const img = new Image();
      img.src = image;
      await img.decode();
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 36;
      const maxW = pageW - margin * 2;
      const maxH = pageH - margin * 2;
      const scale = Math.min(maxW / POSTER_WIDTH, maxH / POSTER_HEIGHT);
      const w = POSTER_WIDTH * scale;
      const h = POSTER_HEIGHT * scale;
      pdf.addImage(
        img,
        "PNG",
        (pageW - w) / 2,
        (pageH - h) / 2,
        w,
        h,
      );
      pdf.save(`${fileStem}.pdf`);
      setNotice({ tone: "info", text: "Poster PDF downloaded." });
    } catch (err) {
      console.error("[print-qr] PDF download failed", err);
      setNotice({ tone: "error", text: "Couldn't create the PDF file." });
    } finally {
      setBusy(null);
    }
  }, [fileStem, image]);

  const printPoster = useCallback(() => {
    setBusy("print");
    setNotice(null);
    try {
      // The blank pop-up has no base URL, so the image path must be absolute.
      const src = new URL(image, window.location.origin).href;
      const win = window.open("", "_blank", "width=900,height=1200");
      if (!win) {
        setNotice({
          tone: "error",
          text: "Allow pop-ups for this site to print the poster.",
        });
        return;
      }
      win.document.write(
        `<!doctype html><html><head><meta charset="utf-8">` +
          `<title>${GYM_NAME} — ${poster.label} QR</title>` +
          `<style>@page{margin:12mm}html,body{margin:0;padding:0}` +
          `img{display:block;width:100%;height:auto}</style></head>` +
          `<body><img src="${src}" alt="${poster.label} QR poster"` +
          ` onload="setTimeout(function(){window.focus();window.print();},150)"></body></html>`,
      );
      win.document.close();
      setNotice({ tone: "info", text: "Print dialog opened in a new tab." });
    } catch (err) {
      console.error("[print-qr] print failed", err);
      setNotice({ tone: "error", text: "Couldn't open the print view." });
    } finally {
      setBusy(null);
    }
  }, [poster.label, image]);

  // Copying the target is the one thing anyone wants to *do* with this string —
  // send it to a member, paste it into a message. The confirmation lives on the
  // button itself (icon swaps to a tick for two seconds) rather than in the
  // shared notice line, so it reads as feedback for that control.
  const copyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Insecure origins and older browsers have no clipboard API at all.
      console.error("[print-qr] copy failed", err);
      setNotice({ tone: "error", text: "Couldn't copy the link." });
    }
  }, [url]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const actionsDisabled = busy !== null;

  return (
    <section aria-label={`${poster.label} QR poster`}>
        <p style={leadStyle}>{poster.description}</p>

        <div className="rs-qr-layout" style={layoutStyle}>
          <div className="rs-qr-preview" style={previewFrameStyle}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt={`${poster.label} QR poster`}
              width={POSTER_WIDTH}
              height={POSTER_HEIGHT}
              className="rs-qr-poster"
              style={{ width: "100%", maxWidth: 440, height: "auto", display: "block" }}
            />
          </div>

          <div className="rs-qr-actions" style={actionsColStyle}>
            {/* A wrapper rather than three loose children: it stacks
                identically to the column it sits in on desktop (same
                direction, same gap), and it is the single element the narrow
                layout turns into a 3-up grid. */}
            <div className="rs-qr-btnrow" style={buttonRowStyle}>
              {/* A real link, not a scripted click: mobile Safari only honours downloads from a direct tap. */}
              <a
                href={image}
                download={`${fileStem}.png`}
                onClick={() => setNotice({ tone: "info", text: "Poster image downloaded." })}
                className="rs-qr-btn rs-qr-btn-primary"
                style={{ ...primaryButtonStyle(false), textDecoration: "none" }}
              >
                <span className="rs-qr-btn-icon" style={btnIconStyle}>
                  <IconImage />
                </span>
                <span className="rs-qr-btn-full">
                  Download image
                </span>
                <span className="rs-qr-btn-short" style={btnShortStyle}>
                  Image
                </span>
              </a>
              <button
                type="button"
                onClick={downloadPdf}
                disabled={actionsDisabled}
                className="rs-qr-btn rs-qr-btn-secondary"
                style={secondaryButtonStyle(actionsDisabled)}
              >
                <span className="rs-qr-btn-icon" style={btnIconStyle}>
                  <IconDocument />
                </span>
                <span className="rs-qr-btn-full">
                  {busy === "pdf" ? "Preparing…" : "Download PDF"}
                </span>
                <span className="rs-qr-btn-short" style={btnShortStyle}>
                  {busy === "pdf" ? "Preparing…" : "PDF"}
                </span>
              </button>
              <button
                type="button"
                onClick={printPoster}
                disabled={actionsDisabled}
                className="rs-qr-btn rs-qr-btn-secondary"
                style={secondaryButtonStyle(actionsDisabled)}
              >
                <span className="rs-qr-btn-icon" style={btnIconStyle}>
                  <IconPrinter />
                </span>
                <span className="rs-qr-btn-full">
                  {busy === "print" ? "Opening…" : "Print"}
                </span>
                <span className="rs-qr-btn-short" style={btnShortStyle}>
                  {busy === "print" ? "Opening…" : "Print"}
                </span>
              </button>
            </div>

            <div className="rs-qr-url" style={urlBoxStyle}>
              <div style={urlLabelStyle}>QR target</div>
              <div className="rs-qr-url-row" style={urlRowStyle}>
                <code style={urlValueStyle}>{url}</code>
                <div style={urlActionsStyle}>
                  <button
                    type="button"
                    onClick={copyUrl}
                    className="rs-qr-url-btn"
                    aria-label={copied ? "Link copied" : "Copy link"}
                    title={copied ? "Copied" : "Copy link"}
                    style={urlButtonStyle(false, copied)}
                  >
                    {copied ? <IconCheck /> : <IconCopy />}
                  </button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="rs-qr-url-btn"
                    aria-label={`Open the ${poster.label.toLowerCase()} in a new tab`}
                    title={`Open ${poster.label.toLowerCase()}`}
                    style={urlButtonStyle(false, false)}
                  >
                    <IconExternal />
                  </a>
                </div>
              </div>
            </div>

            {notice && (
              <p
                style={{
                  ...noticeStyle,
                  color:
                    notice.tone === "error"
                      ? "var(--rs-accent-text)"
                      : "var(--rs-muted)",
                }}
              >
                {notice.text}
              </p>
            )}
          </div>
        </div>
    </section>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "var(--rs-bg)",
  color: "var(--rs-fg)",
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  padding: "40px 20px 80px",
};

const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
  gap: 24,
  flexWrap: "wrap",
};

const kickerStyle: CSSProperties = {
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
  letterSpacing: "0.01em",
  margin: "8px 0 0",
};

const leadStyle: CSSProperties = {
  margin: "10px 0 0",
  fontSize: 14,
  lineHeight: 1.6,
  color: "var(--rs-muted)",
  maxWidth: "60ch",
};

const layoutStyle: CSSProperties = {
  marginTop: 26,
  display: "flex",
  flexWrap: "wrap",
  gap: 24,
  alignItems: "flex-start",
};

const previewFrameStyle: CSSProperties = {
  flex: "1 1 360px",
  padding: 32,
  border: "1px solid var(--rs-line)",
  borderRadius: 10,
  background: "var(--rs-panel)",
  display: "grid",
  placeItems: "center",
};

const actionsColStyle: CSSProperties = {
  flex: "0 1 300px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

/** Wide-layout defaults the 860px block flips on: strip-only affordances. */
const btnIconStyle: CSSProperties = { display: "none" };
const btnShortStyle: CSSProperties = { display: "none" };

const urlBoxStyle: CSSProperties = {
  marginTop: 6,
  padding: 14,
  border: "1px solid var(--rs-line)",
  borderRadius: 8,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const urlLabelStyle: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "var(--rs-muted)",
};

const urlRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const urlValueStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontFamily: monoFont,
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--rs-fg)",
  wordBreak: "break-all",
};

const urlActionsStyle: CSSProperties = {
  display: "flex",
  gap: 6,
  flexShrink: 0,
};

/** Square icon control shared by the copy button and the open link. */
function urlButtonStyle(disabled: boolean, active: boolean): CSSProperties {
  return {
    width: 34,
    height: 34,
    display: "grid",
    placeItems: "center",
    border: "1px solid var(--rs-line)",
    borderRadius: 7,
    background: "transparent",
    color: active ? "var(--rs-accent-text)" : "var(--rs-muted)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    textDecoration: "none",
    flexShrink: 0,
  };
}

const noticeStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: 13,
};

function baseButtonStyle(disabled: boolean): CSSProperties {
  return {
    height: 42,
    padding: "0 22px",
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: displayFont,
    fontSize: 15,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}

function primaryButtonStyle(disabled: boolean): CSSProperties {
  return {
    ...baseButtonStyle(disabled),
    border: "none",
    background: "var(--rs-accent)",
    color: "var(--rs-on-accent)",
  };
}

function secondaryButtonStyle(disabled: boolean): CSSProperties {
  return {
    ...baseButtonStyle(disabled),
    border: "1px solid var(--rs-fg)",
    background: "transparent",
    color: "var(--rs-fg)",
  };
}
