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
  /** Instructions below the code; explicit newlines are preserved. */
  instructions?: string;
}

/** Poster canvas size — portrait, ~A4 proportions at print-friendly density. */
export const POSTER_WIDTH = 1240;
export const POSTER_HEIGHT = 1754;

const INK = "#0d0d0d";
const MUTED = "#6f6f6d";
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
    margin: 4,
    errorCorrectionLevel: "M",
    color: { dark: INK, light: "#ffffff" },
  });

  const canvas = document.createElement("canvas");
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // next/font exposes generated family names through CSS custom properties.
  const style = getComputedStyle(document.documentElement);
  const display = style.getPropertyValue("--font-barlow-condensed").trim() || "sans-serif";
  const body = style.getPropertyValue("--font-geist-sans").trim() || "sans-serif";
  const mono = style.getPropertyValue("--font-geist-mono").trim() || "monospace";
  await Promise.all([
    document.fonts.load(`700 108px ${display}`),
    document.fonts.load(`700 112px ${display}`),
    document.fonts.load(`400 32px ${body}`),
    document.fonts.load(`500 26px ${mono}`),
  ]);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

  // Match the check-in header: yellow band, dark circular logo badge and
  // bold dark wordmark, with the entire lockup centered as a single unit.
  const headerHeight = 280;
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, POSTER_WIDTH, headerHeight);

  const logo = new Image();
  logo.src = "/tibay-gym-mark-transparent.svg";
  await logo.decode();
  const badgeSize = 144;
  const logoW = 108;
  const logoH = logoW * 429 / 628;
  const gap = 36;
  ctx.font = `700 112px ${display}`;
  const name = opts.gymName.toUpperCase();
  const brandW = badgeSize + gap + ctx.measureText(name).width;
  const brandX = (POSTER_WIDTH - brandW) / 2;
  const brandY = headerHeight / 2;
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.arc(brandX + badgeSize / 2, brandY, badgeSize / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(logo, brandX + (badgeSize - logoW) / 2, brandY - logoH / 2, logoW, logoH);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = "#20211d";
  ctx.fillText(name, brandX + badgeSize + gap, brandY);

  const cx = POSTER_WIDTH / 2;
  ctx.textAlign = "center";
  ctx.fillStyle = INK;
  const titleLines = caption.toUpperCase().split("\n");
  // Fit long labels without distorting their letterforms.
  let titleSize = 108;
  ctx.font = `700 ${titleSize}px ${display}`;
  while (titleLines.some(line => ctx.measureText(line).width > POSTER_WIDTH - 180) && titleSize > 48) {
    ctx.font = `700 ${--titleSize}px ${display}`;
  }
  const titleStep = titleSize * 1.05;
  titleLines.forEach((line, index) => {
    ctx.fillText(line, cx, 405 + (index - (titleLines.length - 1) / 2) * titleStep);
  });

  // Four clear modules around the QR; no decorative frame or logo overlay.
  const qrY = 545;
  ctx.drawImage(qrCanvas, cx - QR_SIZE / 2, qrY, QR_SIZE, QR_SIZE);

  ctx.fillStyle = MUTED;
  ctx.font = `400 32px ${body}`;
  const instructionLines = (opts.instructions ??
    "Open your phone camera and scan.\nEnter your phone number to check in.").split("\n");
  instructionLines.forEach((line, index) => {
    drawFittedText(ctx, line, cx, 1400 + index * 50, POSTER_WIDTH - 160, 32, body, "400");
  });

  ctx.fillStyle = INK;
  drawFittedText(ctx, opts.url, cx, 1590, POSTER_WIDTH - 180, 26, mono, "500");

  return canvas;
}

/** `body-fitness-gym` → filename stem for the downloads. */
export function posterFileStem(gymName: string, destination = "check-in"): string {
  const slug = gymName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "gym"}-${destination}-qr`;
}

/** Keep long production URLs inside the printable margins. */
function drawFittedText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  maxWidth: number, size: number, family: string, weight: string,
) {
  ctx.font = `${weight} ${size}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && size > 12) {
    ctx.font = `${weight} ${--size}px ${family}`;
  }
  ctx.fillText(text, x, y);
}
