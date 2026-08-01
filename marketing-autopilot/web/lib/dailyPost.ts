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
  headline: z.string().min(1).max(80),
  primaryText: z.string().min(1).max(600),
  cta: z.string().min(1).max(40),
});

export type GeneratedPost = z.infer<typeof PostSchema>;

const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  required: ['headline', 'primaryText', 'cta'],
  properties: {
    headline: { type: 'string' },
    primaryText: { type: 'string' },
    cta: { type: 'string' },
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

function buildPrompt(
  profile: ShopProfile,
  recentHeadlines: string[],
  angle: string,
): string {
  return [
    'You write one social media post per day for a small local business in India.',
    '',
    `Business: ${profile.business_name}`,
    `Sells: ${profile.category}`,
    `Location: ${profile.city ?? 'not specified'}`,
    `The owner describes the business as: ${profile.description}`,
    '',
    `Today's angle: ${angle}`,
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
    '- No hashtag spam. Two or three at most, inside primaryText if useful.',
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

export async function generateDailyPost(
  profile: ShopProfile,
  recentHeadlines: string[] = [],
): Promise<GeneratedPost> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new DailyPostError('GEMINI_API_KEY is not set');

  // Day of year, so the angle advances even if a day is skipped -- picking at
  // random would happily choose the same one twice running.
  const dayOfYear = Math.floor(
    (Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86_400_000,
  );
  const angle = ANGLES[dayOfYear % ANGLES.length];

  const configured = process.env.GEMINI_MODEL?.trim() || 'gemini-flash-latest';
  const candidates = [
    configured,
    ...FALLBACK_MODELS.filter((m) => m !== configured),
  ];

  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildPrompt(profile, recentHeadlines, angle);

  let raw: string | undefined;
  for (const model of candidates) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: RESPONSE_JSON_SCHEMA,
          // Higher than the ad-copy call: this runs daily and variety is the
          // point, where an ad is written once and wants to be safe.
          temperature: 1.0,
        },
      });
      raw = response.text;
      if (raw) break;
    } catch (err) {
      if (isModelUnavailable(err)) continue;
      throw new DailyPostError(
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  if (!raw) throw new DailyPostError('No usable Gemini model');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DailyPostError('Model did not return valid JSON');
  }

  const result = PostSchema.safeParse(parsed);
  if (!result.success) {
    throw new DailyPostError('Model output did not match the required shape');
  }
  return result.data;
}
