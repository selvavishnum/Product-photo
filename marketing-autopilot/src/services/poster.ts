import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';

/**
 * Assembles a 1080x1080 Instagram feed ad banner.
 *
 * Sharp, not node-canvas, and that is the load-bearing decision here.
 * Sharp composites SVG through librsvg, which shapes text with Pango and
 * HarfBuzz, so Tamil ligatures and combining vowel signs come out correct.
 * node-canvas draws text through Cairo's "toy" API, which has no complex
 * script shaping -- Tamil renders as disconnected glyphs in the wrong order.
 * Verified by rendering "ஸ்ரீ லக்ஷ்மி நகைக்கடை" and inspecting the output.
 *
 * No diffusion model anywhere: this is layout, not generation, and it runs in
 * tens of milliseconds rather than the tens of seconds an image model needs.
 */

export const CANVAS = 1080;

/** Font families must be installed on the host; see Dockerfile. */
const FONT_TAMIL = 'Noto Sans Tamil';
const FONT_LATIN = 'DejaVu Sans';

export interface PosterInput {
  /** Product photo. A transparent PNG cutout looks best. */
  productImage: Buffer;
  headline: string;
  /** Offer or CTA, e.g. "சிறப்பு 10% தள்ளுபடி" or "Call Now". */
  ctaText: string;
  /** Optional brand logo, placed top-right. */
  logo?: Buffer;
  theme?: PosterTheme;
}

export interface PosterTheme {
  name: string;
  /** Background gradient, top to bottom. */
  from: string;
  to: string;
  text: string;
  ctaBg: string;
  ctaText: string;
}

export const THEMES: Record<string, PosterTheme> = {
  midnight: {
    name: 'Midnight',
    from: '#1b2740',
    to: '#080c15',
    text: '#ffffff',
    ctaBg: '#f5c451',
    ctaText: '#1b1400',
  },
  saffron: {
    name: 'Saffron',
    from: '#ff9448',
    to: '#c2410c',
    text: '#ffffff',
    ctaBg: '#ffffff',
    ctaText: '#c2410c',
  },
  emerald: {
    name: 'Emerald',
    from: '#0f766e',
    to: '#052e2b',
    text: '#ffffff',
    ctaBg: '#fbbf24',
    ctaText: '#1c1300',
  },
};

/** SVG is XML: unescaped user text breaks the document, or injects into it. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Tamil block plus Tamil Supplement. */
const TAMIL_RE = /[஀-௿]/;

export function isTamil(text: string): boolean {
  return TAMIL_RE.test(text);
}

/**
 * Greedy word wrap with an approximate advance width.
 *
 * SVG has no automatic wrapping, and measuring text properly would mean
 * loading and shaping the font in-process -- which costs more than this whole
 * render. An approximation is fine because the caller auto-shrinks the font
 * until the result fits, so a slightly wrong estimate costs one extra pass,
 * not a broken layout.
 */
function wrap(text: string, fontSize: number, maxWidth: number): string[] {
  // Tamil glyphs carry more above and below the baseline and run wider than
  // Latin at the same point size.
  const advance = (isTamil(text) ? 0.62 : 0.54) * fontSize;
  const perLine = Math.max(6, Math.floor(maxWidth / advance));

  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= perLine) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      // A single word longer than a line (common in Tamil compounds) is hard
      // broken rather than allowed to overflow the canvas.
      if (word.length > perLine) {
        let rest = word;
        while (rest.length > perLine) {
          lines.push(rest.slice(0, perLine));
          rest = rest.slice(perLine);
        }
        line = rest;
      } else {
        line = word;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Shrink the font until the headline fits the allowed number of lines. */
function fitHeadline(
  text: string,
  maxWidth: number,
  maxLines: number,
): { lines: string[]; fontSize: number } {
  for (let fontSize = 82; fontSize >= 40; fontSize -= 4) {
    const lines = wrap(text, fontSize, maxWidth);
    if (lines.length <= maxLines) return { lines, fontSize };
  }
  const fontSize = 40;
  return { lines: wrap(text, fontSize, maxWidth).slice(0, maxLines), fontSize };
}

function buildBackground(theme: PosterTheme): Buffer {
  return Buffer.from(`<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${theme.from}"/>
      <stop offset="100%" stop-color="${theme.to}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="58%" r="46%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${CANVAS}" height="${CANVAS}" fill="url(#bg)"/>
  <ellipse cx="${CANVAS / 2}" cy="${CANVAS * 0.58}" rx="${CANVAS * 0.46}" ry="${CANVAS * 0.4}" fill="url(#glow)"/>
</svg>`);
}

/**
 * Scrim behind the text, composited *over* the product.
 *
 * Without it, a light product behind white headline text makes the headline
 * unreadable -- the single most common way an auto-generated banner fails.
 */
function buildScrim(): Buffer {
  return Buffer.from(`<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.62"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottom" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${CANVAS}" height="${CANVAS * 0.34}" fill="url(#top)"/>
  <rect y="${CANVAS * 0.64}" width="${CANVAS}" height="${CANVAS * 0.36}" fill="url(#bottom)"/>
</svg>`);
}

function buildTextLayer(
  headline: string,
  ctaText: string,
  theme: PosterTheme,
): { svg: Buffer; headlineBottom: number } {
  const margin = 72;
  const maxWidth = CANVAS - margin * 2;

  const { lines, fontSize } = fitHeadline(headline, maxWidth, 3);
  const headlineFont = isTamil(headline) ? FONT_TAMIL : FONT_LATIN;
  const ctaFont = isTamil(ctaText) ? FONT_TAMIL : FONT_LATIN;

  const lineHeight = fontSize * 1.28;
  const startY = 132;

  const headlineSvg = lines
    .map(
      (line, i) =>
        `<text x="${CANVAS / 2}" y="${startY + i * lineHeight}" text-anchor="middle" ` +
        `font-family="${headlineFont}" font-size="${fontSize}" font-weight="bold" ` +
        `fill="${theme.text}">${esc(line)}</text>`,
    )
    .join('\n  ');

  // CTA pill, sized from the text rather than fixed, so a long Tamil CTA does
  // not spill outside its own box.
  const ctaFontSize = 44;
  const ctaAdvance = (isTamil(ctaText) ? 0.62 : 0.54) * ctaFontSize;
  const pillWidth = Math.min(
    CANVAS - margin * 2,
    Math.max(320, ctaText.length * ctaAdvance + 96),
  );
  const pillHeight = 108;
  const pillX = (CANVAS - pillWidth) / 2;
  const pillY = CANVAS - 168;

  const svg = Buffer.from(`<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">
  ${headlineSvg}
  <rect x="${pillX}" y="${pillY}" width="${pillWidth}" height="${pillHeight}" rx="${pillHeight / 2}" fill="${theme.ctaBg}"/>
  <text x="${CANVAS / 2}" y="${pillY + pillHeight / 2 + ctaFontSize * 0.36}" text-anchor="middle"
    font-family="${ctaFont}" font-size="${ctaFontSize}" font-weight="bold"
    fill="${theme.ctaText}">${esc(ctaText)}</text>
</svg>`);

  // Baseline of the last line plus its descender.
  const headlineBottom = startY + (lines.length - 1) * lineHeight + fontSize * 0.3;
  return { svg, headlineBottom };
}

/**
 * Renders the banner. Returns PNG bytes.
 *
 * Layer order matters: product, then scrim, then text. Scrim over product is
 * what keeps the headline legible regardless of what the photo looks like.
 */
export async function renderPoster(input: PosterInput): Promise<Buffer> {
  const theme = input.theme ?? THEMES.midnight!;

  const text = buildTextLayer(input.headline, input.ctaText, theme);

  // Product sits between the headline and the CTA. Both edges are computed
  // rather than fixed: a three-line Tamil headline is far taller than a
  // one-line English one, and a fixed product position lets the tall case
  // overlap the product.
  const topLimit = text.headlineBottom + 28;
  const bottomLimit = CANVAS - 200;
  const productBox = Math.round(
    Math.min(CANVAS * 0.58, Math.max(320, bottomLimit - topLimit)),
  );
  const product = await sharp(input.productImage)
    .resize(productBox, productBox, {
      fit: 'inside',
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();
  const productMeta = await sharp(product).metadata();

  const productHeight = productMeta.height ?? productBox;
  const layers: OverlayOptions[] = [
    {
      input: product,
      left: Math.round((CANVAS - (productMeta.width ?? productBox)) / 2),
      // Centred in the gap left between headline and CTA.
      top: Math.round(
        Math.max(topLimit, topLimit + (bottomLimit - topLimit - productHeight) / 2),
      ),
    },
    { input: buildScrim(), left: 0, top: 0 },
    { input: text.svg, left: 0, top: 0 },
  ];

  if (input.logo) {
    const logoSize = 120;
    const logo = await sharp(input.logo)
      .resize(logoSize, logoSize, {
        fit: 'inside',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .toBuffer();
    const logoMeta = await sharp(logo).metadata();
    layers.push({
      input: logo,
      left: CANVAS - (logoMeta.width ?? logoSize) - 56,
      top: 44,
    });
  }

  return sharp(buildBackground(theme))
    .composite(layers)
    .png({ compressionLevel: 9 })
    .toBuffer();
}
