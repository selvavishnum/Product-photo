/**
 * Draws a 1080x1080 ad poster in the browser.
 *
 * A port of the layout in `../src/services/poster.ts`, moved client-side for
 * one reason: that renderer shapes Tamil through Sharp -> librsvg -> Pango ->
 * HarfBuzz, which needs fonts installed system-wide, and a serverless
 * function has no system to install them on.
 *
 * The browser already is that stack. Canvas 2D `fillText` goes through the
 * same shaping engine the page itself uses, so Tamil ligatures and combining
 * marks come out correct with nothing to configure. It is also free, instant,
 * and works offline once the page has loaded.
 *
 * **Not an AI image model.** Those cannot write Tamil -- they produce
 * convincing-looking gibberish -- so any generated poster would need real
 * text composited on top regardless, at which point the model is only drawing
 * a background, and a gradient does that for nothing.
 */

export const CANVAS = 1080;

export interface PosterTheme {
  key: string;
  name: string;
  /** Background gradient, top to bottom. */
  from: string;
  to: string;
  text: string;
  ctaBg: string;
  ctaText: string;
}

export const THEMES: PosterTheme[] = [
  {
    key: 'midnight',
    name: 'Midnight',
    from: '#1b2740',
    to: '#080c15',
    text: '#ffffff',
    ctaBg: '#f5c451',
    ctaText: '#1b1400',
  },
  {
    key: 'saffron',
    name: 'Saffron',
    from: '#ff9448',
    to: '#c2410c',
    text: '#ffffff',
    ctaBg: '#ffffff',
    ctaText: '#c2410c',
  },
  {
    key: 'emerald',
    name: 'Emerald',
    from: '#0f766e',
    to: '#052e2b',
    text: '#ffffff',
    ctaBg: '#fbbf24',
    ctaText: '#1c1300',
  },
  {
    key: 'paper',
    name: 'Paper',
    from: '#f8f7f4',
    to: '#e7e3dc',
    text: '#141414',
    ctaBg: '#141414',
    ctaText: '#ffffff',
  },
];

export interface PosterInput {
  headline: string;
  cta: string;
  theme: PosterTheme;
  /** The product photo. Without one the poster is text on a gradient. */
  image?: HTMLImageElement | ImageBitmap | null;
}

const MARGIN = 88;
const MAX_HEADLINE_LINES = 3;

/**
 * Wraps by measuring, not by counting characters.
 *
 * The server version estimates from an average advance because measuring in
 * SVG means rendering. Here `measureText` is exact and free, which matters
 * more for Tamil than it sounds: its advance per character ranges roughly
 * 0.62-0.78 of the font size depending on combining marks, and a fixed
 * estimate clipped headlines at both ends.
 */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);

    // A single word wider than the line -- common in Tamil compounds -- is
    // broken rather than allowed to run off the canvas.
    if (ctx.measureText(word).width > maxWidth) {
      let rest = word;
      while (ctx.measureText(rest).width > maxWidth && rest.length > 1) {
        let cut = rest.length;
        while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxWidth) {
          cut--;
        }
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    } else {
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Shrinks the font until the headline fits both the width and the line budget. */
function fitHeadline(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fontFamily: string,
): { lines: string[]; fontSize: number } {
  for (let fontSize = 82; fontSize >= 34; fontSize -= 2) {
    ctx.font = `800 ${fontSize}px ${fontFamily}`;
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length <= MAX_HEADLINE_LINES) return { lines, fontSize };
  }
  const fontSize = 34;
  ctx.font = `800 ${fontSize}px ${fontFamily}`;
  return {
    lines: wrap(ctx, text, maxWidth).slice(0, MAX_HEADLINE_LINES),
    fontSize,
  };
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * The font stack the page itself uses.
 *
 * Read from the document rather than hardcoded so the canvas cannot drift
 * from the UI, and so the Tamil fallback that `globals.css` sets up applies
 * here too -- neither Latin face contains Tamil glyphs, and the browser falls
 * through per character.
 */
function fontStack(): string {
  if (typeof document === 'undefined') return 'sans-serif';
  const family = getComputedStyle(document.body).fontFamily;
  return family || 'sans-serif';
}

/**
 * Renders the poster and returns it as a PNG blob.
 *
 * Waits on `document.fonts.ready` first. Without it the first render can land
 * before the webfonts have loaded and silently fall back to a system face --
 * which for Tamil often means no glyphs at all, and a poster of empty boxes
 * that looked fine in testing.
 */
export async function renderPoster(input: PosterInput): Promise<Blob> {
  if (typeof document !== 'undefined' && document.fonts) {
    await document.fonts.ready;
  }

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS;
  canvas.height = CANVAS;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not draw the poster on this browser.');

  const { theme } = input;
  const family = fontStack();

  // ---- background ----
  const bg = ctx.createLinearGradient(0, 0, 0, CANVAS);
  bg.addColorStop(0, theme.from);
  bg.addColorStop(1, theme.to);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS, CANVAS);

  // ---- product photo ----
  // Cover-cropped into the lower two thirds: the headline needs the top, and
  // a product squeezed to fit whole reads as a catalogue thumbnail rather
  // than an advert.
  if (input.image) {
    const boxY = CANVAS * 0.3;
    const boxH = CANVAS - boxY;
    const iw = input.image.width;
    const ih = input.image.height;
    const scale = Math.max(CANVAS / iw, boxH / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(
      input.image as CanvasImageSource,
      (CANVAS - dw) / 2,
      boxY + (boxH - dh) / 2,
      dw,
      dh,
    );
  }

  // ---- scrim ----
  // Over the product, under the text. Without it a pale product behind white
  // headline text is unreadable, which is the most common way an
  // auto-generated banner fails.
  const scrim = ctx.createLinearGradient(0, 0, 0, CANVAS);
  const dark = theme.text === '#ffffff';
  scrim.addColorStop(0, dark ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.82)');
  scrim.addColorStop(0.45, dark ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.35)');
  scrim.addColorStop(0.72, 'rgba(0,0,0,0)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, CANVAS, CANVAS);

  // ---- headline ----
  const maxWidth = CANVAS - MARGIN * 2;
  const { lines, fontSize } = fitHeadline(ctx, input.headline, maxWidth, family);

  ctx.fillStyle = theme.text;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  // Tamil needs more leading than Latin: its marks sit well above and below
  // the baseline and collide at tighter spacing.
  const lineHeight = fontSize * 1.32;
  let y = MARGIN;
  for (const line of lines) {
    ctx.fillText(line, MARGIN, y);
    y += lineHeight;
  }

  // ---- CTA pill ----
  const ctaFontSize = 40;
  ctx.font = `700 ${ctaFontSize}px ${family}`;
  const ctaText = input.cta.trim();
  const textWidth = ctx.measureText(ctaText).width;
  const padX = 44;
  const padY = 26;
  const pillW = Math.min(textWidth + padX * 2, maxWidth);
  const pillH = ctaFontSize + padY * 2;
  const pillY = CANVAS - MARGIN - pillH;

  ctx.fillStyle = theme.ctaBg;
  roundedRect(ctx, MARGIN, pillY, pillW, pillH, pillH / 2);
  ctx.fill();

  ctx.fillStyle = theme.ctaText;
  ctx.textAlign = 'center';
  ctx.fillText(ctaText, MARGIN + pillW / 2, pillY + padY);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Could not encode the poster.')),
      'image/png',
    );
  });
}

/** Decodes a picked file into something drawable. */
export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Revoked once decoded: the bitmap is retained, the URL is not, and
      // leaking one per generated poster adds up over a session.
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that photo.'));
    };
    img.src = url;
  });
}
