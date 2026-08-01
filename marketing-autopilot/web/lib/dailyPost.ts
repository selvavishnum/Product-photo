import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

import type { ShopProfile } from './db';

/**
 * Writes one day's social post.
 *
 * Separate from `adPlan.ts` because the two are not the same job. An ad plan
 * carries targeting and runs once with money behind it; this runs every day
 * for free, and its only real enemy is sameness. A feed of near-identical
 * posts gets less reach, not more, so most of the work here is making
 * today's post different from the last fortnight's.
 */

const PostSchema = z.object({
  /** The first line, which decides whether the rest is read. */
  hook: z.string().min(1).max(90),
  headline: z.string().min(1).max(80),
  primaryText: z.string().min(1).max(600),
  cta: z.string().min(1).max(40),
  /** Without the '#'. */
  hashtags: z.array(z.string().min(1).max(40)).max(12).default([]),
});

const PlanSchema = z.object({
  posts: z.array(PostSchema).min(1).max(14),
});

export type GeneratedPost = z.infer<typeof PostSchema>;

const POST_JSON_SCHEMA = {
  type: 'object',
  required: ['hook', 'headline', 'primaryText', 'cta', 'hashtags'],
  properties: {
    hook: { type: 'string' },
    headline: { type: 'string' },
    primaryText: { type: 'string' },
    cta: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
} as const;

const PLAN_JSON_SCHEMA = {
  type: 'object',
  required: ['posts'],
  properties: {
    posts: { type: 'array', items: POST_JSON_SCHEMA },
  },
} as const;

/**
 * Angles the post can take, rotated by day.
 *
 * Pinned rather than left to the model: asked for "a post about the shop"
 * fifteen days running, an LLM converges on the same few sentences. Handing
 * it a different job each day is what actually produces variety, and the
 * rotation means it cannot drift back to a favourite.
 */
const ANGLES = [
  'what arrived fresh or new today',
  'one specific product, described in detail',
  'why people in the neighbourhood keep coming back',
  'a practical tip related to what the shop sells',
  'the people behind the shop and how long it has been running',
  'what is worth buying this week and why',
  'a question to the reader that invites a reply',
];

function buildPlanPrompt(
  profile: ShopProfile,
  recentHeadlines: string[],
  angles: string[],
): string {
  return [
    `You write social media posts for a small local business in India.`,
    `Write ${angles.length} posts, one per day, in order.`,
    '',
    `Business: ${profile.business_name}`,
    `Sells: ${profile.category}`,
    `Location: ${profile.city ?? 'not specified'}`,
    `The owner describes the business as: ${profile.description}`,
    '',
    'Each post has its own job. Keep to them -- this is what stops a week of',
    'posts reading as the same post rewritten, which is what actually costs',
    'reach:',
    ...angles.map((a, i) => `  Day ${i + 1}: ${a}`),
    '',
    `Write in ${
      profile.language === 'TANGLISH'
        ? 'Tanglish (Tamil written in Latin script, as people actually text)'
        : profile.language.toLowerCase()
    }.`,
    '',
    'Rules:',
    '- Write the way the shop owner speaks, not like a brand account.',
    '- No invented claims: no prices, discounts, guarantees, awards or',
    '  delivery promises the description does not state. This is published',
    '  publicly under the owner\'s name and a false claim is their liability.',
    '- Tamil must be real Tamil script, not transliteration.',
    '- Keep the headline under 80 characters.',
    '',
    'The hook is the first line someone reads while scrolling, and it has',
    'about two seconds to earn the next two. Specifics work for a local shop,',
    'adjectives do not: name the thing, the place, the day. No clickbait the',
    'post does not deliver -- these are the owner\'s own neighbours.',
    '',
    'Hashtags: 5-8 per post, without the #. Mix the category and the town.',
    'Thirty generic tags reach nobody; a few a nearby person would search do.',
    ...(recentHeadlines.length
      ? [
          '',
          'Do NOT repeat or lightly reword any of these recent posts:',
          ...recentHeadlines.map((h) => `- ${h}`),
        ]
      : []),
  ].join('\n');
}

const FALLBACK_MODELS = [
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
];

function isModelUnavailable(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return (
    /\b404\b/.test(text) ||
    /NOT_FOUND/i.test(text) ||
    /no longer available/i.test(text) ||
    /is not found/i.test(text)
  );
}

export class DailyPostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailyPostError';
  }
}

/** ISO date, n days after today, in the shop's own timezone. */
export function isoDate(offsetDays: number, timeZone = 'Asia/Kolkata'): string {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  // en-CA formats as YYYY-MM-DD, which is what Postgres wants and what
  // hand-assembling from getFullYear/getMonth gets wrong across a timezone.
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

export interface PlannedPost extends GeneratedPost {
  /** ISO date this post is for. */
  scheduledFor: string;
  /** Poster theme, rotated so a week of posts does not look identical. */
  theme: string;
}

const THEME_KEYS = ['midnight', 'saffron', 'emerald', 'paper'];

/**
 * Writes a run of posts, one per day, each with a different job.
 *
 * Generated in a single call rather than one per day: the model can see the
 * whole week at once and vary it deliberately, where seven independent calls
 * each pick their own favourite phrasing and converge. It is also six fewer
 * round trips.
 */
export async function generateCalendar(
  profile: ShopProfile,
  days: number,
  recentHeadlines: string[] = [],
  startOffset = 0,
): Promise<PlannedPost[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new DailyPostError('GEMINI_API_KEY is not set');

  const count = Math.max(1, Math.min(14, days));

  // Rotated from the day of year rather than always starting at zero, so two
  // weeks generated a fortnight apart do not open with the same angle.
  const dayOfYear = Math.floor(
    (Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86_400_000,
  );
  const angles = Array.from(
    { length: count },
    (_, i) => ANGLES[(dayOfYear + i) % ANGLES.length],
  );

  const configured = process.env.GEMINI_MODEL?.trim() || 'gemini-flash-latest';
  const candidates = [
    configured,
    ...FALLBACK_MODELS.filter((m) => m !== configured),
  ];

  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildPlanPrompt(profile, recentHeadlines, angles);

  let raw: string | undefined;
  for (const model of candidates) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: PLAN_JSON_SCHEMA,
          // Higher than the ad-copy call: this runs every day and variety is
          // the point, where an ad is written once and wants to be safe.
          temperature: 1.0,
        },
      });
      raw = response.text;
      if (raw) break;
    } catch (err) {
      if (isModelUnavailable(err)) continue;
      throw new DailyPostError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!raw) throw new DailyPostError('No usable Gemini model');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DailyPostError('Model did not return valid JSON');
  }

  const result = PlanSchema.safeParse(parsed);
  if (!result.success) {
    throw new DailyPostError('Model output did not match the required shape');
  }

  // Trimmed rather than trusted: asked for seven the model occasionally
  // returns eight, and an extra post would land on a date already covered.
  return result.data.posts.slice(0, count).map((post, i) => ({
    ...post,
    scheduledFor: isoDate(startOffset + i),
    theme: THEME_KEYS[(dayOfYear + i) % THEME_KEYS.length],
  }));
}
