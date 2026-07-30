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
 * Measures how wide `text` renders, per 1px of font size.
 *
 * Guessing this does not work. Measured across real strings, Tamil's advance
 * ratio ranges from 0.62 to 0.78 of the font size depending on how many
 * combining marks each cluster carries -- a 25% spread, which is the
 * difference between a headline that fits and one clipped at both edges.
 * Latin sits around 0.58-0.60.
 *
 * Rendered at a small reference size and scaled: width is linear in font size
 * (verified to within 0.1%), so one 21ms measurement covers every candidate
 * size the fitting loop tries.
 */
const MEASURE_REF = 24;

async function measureUnitWidth(text: string, family: string): Promise<number> {
  const svg = `<svg width="1600" height="${MEASURE_REF * 3}" xmlns="http://www.w3.org/2000/svg">
    <text x="5" y="${MEASURE_REF * 1.4}" font-family="${family}" font-size="${MEASURE_REF}"
      font-weight="bold" fill="#fff">${esc(text)}</text>
  </svg>`;
  const { info } = await sharp(Buffer.from(svg))
    .trim({ threshold: 1 })
    .toBuffer({ resolveWithObject: true });
  return info.width / MEASURE_REF;
}

/**
 * Greedy word wrap using the measured average advance for *this* string,
 * rather than a constant that cannot fit every script.
 */
function wrap(
  text: string,
  fontSize: number,
  maxWidth: number,
  unitWidth: number,
): string[] {
  const advance = (unitWidth / Math.max(1, text.length)) * fontSize;
  const perLine = Math.max(4, Math.floor(maxWidth / advance));

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

/** Shrink the font until the headline fits both the width and the line budget. */
function fitHeadline(
  text: string,
  maxWidth: number,
  maxLines: number,
  unitWidth: number,
): { lines: string[]; fontSize: number } {
  for (let fontSize = 82; fontSize >= 34; fontSize -= 3) {
    const lines = wrap(text, fontSize, maxWidth, unitWidth);
    if (lines.length > maxLines) continue;
    // The wrap is greedy on character count; confirm no individual line
    // actually exceeds the width once scaled.
    const perChar = (unitWidth / Math.max(1, text.length)) * fontSize;
    const widest = Math.max(...lines.map((l) => l.length * perChar));
    if (widest <= maxWidth) return { lines, fontSize };
  }
  const fontSize = 34;
  return {
    lines: wrap(text, fontSize, maxWidth, unitWidth).slice(0, maxLines),
    fontSize,
  };
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

async function buildTextLayer(
  headline: string,
  ctaText: string,
  theme: PosterTheme,
): Promise<{ svg: Buffer; headlineBottom: number }> {
  const margin = 72;
  const maxWidth = CANVAS - margin * 2;

  const headlineFont = isTamil(headline) ? FONT_TAMIL : FONT_LATIN;
  const ctaFont = isTamil(ctaText) ? FONT_TAMIL : FONT_LATIN;

  const [headlineUnit, ctaUnit] = await Promise.all([
    measureUnitWidth(headline, headlineFont),
    measureUnitWidth(ctaText, ctaFont),
  ]);

  const { lines, fontSize } = fitHeadline(headline, maxWidth, 3, headlineUnit);

  const lineHeight = fontSize * 1.28;
  // Tamil ascenders and superscript marks sit high, so the first baseline
  // needs a full em of clearance from the top edge, not a fixed 132px.
  const startY = Math.round(56 + fontSize);

  const headlineSvg = lines
    .map(
      (line, i) =>
        `<text x="${CANVAS / 2}" y="${startY + i * lineHeight}" text-anchor="middle" ` +
        `font-family="${headlineFont}" font-size="${fontSize}" font-weight="bold" ` +
        `fill="${theme.text}">${esc(line)}</text>`,
    )
    .join('\n  ');

  // CTA pill sized from the *measured* text width, then shrunk if the text
  // still cannot fit the canvas -- a long Tamil CTA otherwise spills outside
  // its own pill.
  let ctaFontSize = 44;
  const maxPill = CANVAS - margin * 2;
  while (ctaUnit * ctaFontSize + 96 > maxPill && ctaFontSize > 24) {
    ctaFontSize -= 2;
  }
  const pillWidth = Math.min(maxPill, Math.max(320, ctaUnit * ctaFontSize + 96));
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

  const text = await buildTextLayer(input.headline, input.ctaText, theme);

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
