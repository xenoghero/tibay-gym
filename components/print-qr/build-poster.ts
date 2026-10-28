import QRCode from "qrcode";

// TASKLIST Phase 6 — composes the printable entrance poster (QR + caption) onto
// a single high-resolution canvas. One build path feeds all three outputs: the
// on-screen preview, the PNG/PDF downloads, and the print window — so what the
// admin sees is exactly what prints.

export interface PosterOptions {
  /** Absolute check-in URL to encode. */
  url: string;
  /** Gym name shown above the caption. */
  gymName: string;
  /** Instructional caption; defaults to "Scan to check in". */
  caption?: string;
}

/** Poster canvas size — portrait, ~A4 proportions at print-friendly density. */
export const POSTER_WIDTH = 1240;
export const POSTER_HEIGHT = 1754;

const INK = "#0d0d0d";
const MUTED = "#6f6f6d";
const LINE = "#e4e4e2";
const ACCENT = "#ffcc00";
const QR_SIZE = 780;

export async function buildPosterCanvas(
  opts: PosterOptions,
): Promise<HTMLCanvasElement> {
  const caption = (opts.caption ?? "Scan to check in").trim();

  // Render the QR to its own canvas first, then blit it into the poster so it
  // stays crisp (no bilinear scaling of a small bitmap).
  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, opts.url, {
    width: QR_SIZE,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: INK, light: "#ffffff" },
  });

  const canvas = document.createElement("canvas");
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // Wait for the webfonts (Barlow Condensed / Geist, loaded via next/font) so
  // the poster text isn't painted in a fallback face on first render.
  try {
    await document.fonts.ready;
  } catch {
    /* Font Loading API unsupported — fall through to system fallback stacks. */
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

  // Brand rules top and bottom, framing the content block on the page.
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, POSTER_WIDTH, 16);
  ctx.fillRect(0, POSTER_HEIGHT - 16, POSTER_WIDTH, 16);

  const cx = POSTER_WIDTH / 2;
  const logo = new Image();
  logo.src = "/tibay-gym-logo.svg";
  await logo.decode();
  ctx.drawImage(logo, cx - 100, 58, 200, 140);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = INK;
  ctx.font = "600 60px 'Barlow Condensed', system-ui, sans-serif";
  ctx.fillText(opts.gymName.toUpperCase(), cx, 250);

  ctx.font = "700 116px 'Barlow Condensed', system-ui, sans-serif";
  ctx.fillText(caption.toUpperCase(), cx, 392);

  const qrX = cx - QR_SIZE / 2;
  const qrY = 520;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.strokeRect(qrX - 28, qrY - 28, QR_SIZE + 56, QR_SIZE + 56);
  ctx.drawImage(qrCanvas, qrX, qrY, QR_SIZE, QR_SIZE);

  ctx.fillStyle = MUTED;
  ctx.font = "400 32px 'Geist', system-ui, sans-serif";
  ctx.fillText(
    "Open your phone camera, scan, then enter your phone number.",
    cx,
    qrY + QR_SIZE + 110,
  );

  ctx.fillStyle = INK;
  ctx.font = "500 28px 'Geist Mono', ui-monospace, monospace";
  ctx.fillText(opts.url, cx, qrY + QR_SIZE + 172);

  return canvas;
}

/** `body-fitness-gym` → filename stem for the downloads. */
export function posterFileStem(gymName: string): string {
  const slug = gymName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "gym"}-check-in-qr`;
}
