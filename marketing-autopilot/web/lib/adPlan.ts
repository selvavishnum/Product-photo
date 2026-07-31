import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

/**
 * Ad plan generation, running inside the Next.js app.
 *
 * This is a deliberate port of `../../src/services/adCopy.ts` rather than an
 * import of it. The Express API is a separate npm package with its own build,
 * its own Prisma client and a `config/env.ts` that throws at import time --
 * none of which this route needs, and all of which would have to be dragged
 * into the Vercel bundle to reuse one function.
 *
 * What made the port worth it: this endpoint only calls Gemini. No Sharp, no
 * fonts, no database, no ad platform. Everything that genuinely needs a
 * long-lived server with system fonts installed -- poster rendering, Meta
 * publishing -- stays in the Express app for when it is wired up.
 *
 * If the prompt or schema changes, change it in both places. They are small
 * and they are both listed here so neither goes stale silently.
 */

export const AdPlanSchema = z.object({
  targeting: z.object({
    ageMin: z.number().int().min(18).max(65),
    ageMax: z.number().int().min(18).max(65),
    genders: z.array(z.enum(['male', 'female', 'all'])).min(1),
    /** Kilometres around the business. Meta caps local radius at 80km. */
    locationRadiusKm: z.number().int().min(1).max(80),
    locationName: z.string().min(1),
    interests: z.array(z.string().min(1)).min(1).max(12),
    rationale: z.string().min(1),
  }),
  copies: z
    .array(
      z.object({
        language: z.enum(['TAMIL', 'ENGLISH', 'TANGLISH']),
        headline: z.string().min(1).max(60),
        primaryText: z.string().min(1).max(300),
        cta: z.string().min(1).max(30),
      }),
    )
    .min(1)
    .max(6),
});

export type AdPlan = z.infer<typeof AdPlanSchema>;

/**
 * Handed to the provider so it constrains generation, rather than us hoping
 * prose instructions are obeyed. Validated by Zod afterwards regardless --
 * structured output reduces malformed responses but does not eliminate them.
 */
const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  required: ['targeting', 'copies'],
  properties: {
    targeting: {
      type: 'object',
      required: [
        'ageMin',
        'ageMax',
        'genders',
        'locationRadiusKm',
        'locationName',
        'interests',
        'rationale',
      ],
      properties: {
        ageMin: { type: 'integer', minimum: 18, maximum: 65 },
        ageMax: { type: 'integer', minimum: 18, maximum: 65 },
        genders: {
          type: 'array',
          items: { type: 'string', enum: ['male', 'female', 'all'] },
        },
        locationRadiusKm: { type: 'integer', minimum: 1, maximum: 80 },
        locationName: { type: 'string' },
        interests: { type: 'array', items: { type: 'string' } },
        rationale: { type: 'string' },
      },
    },
    copies: {
      type: 'array',
      items: {
        type: 'object',
        required: ['language', 'headline', 'primaryText', 'cta'],
        properties: {
          language: { type: 'string', enum: ['TAMIL', 'ENGLISH', 'TANGLISH'] },
          headline: { type: 'string' },
          primaryText: { type: 'string' },
          cta: { type: 'string' },
        },
      },
    },
  },
} as const;

export interface AdBrief {
  businessName: string;
  businessCategory: string;
  description: string;
  city?: string;
  language: 'TAMIL' | 'ENGLISH' | 'TANGLISH';
  dailyBudgetInr: number;
}

function buildPrompt(brief: AdBrief): string {
  return [
    'You plan advertising campaigns for small local businesses in India.',
    '',
    'Business name: ' + brief.businessName,
    'Category: ' + brief.businessCategory,
    'Location: ' + (brief.city ?? 'not specified'),
    'Daily budget: INR ' + brief.dailyBudgetInr,
    'Owner describes the business as: ' + brief.description,
    '',
    'Produce:',
    '1. A target audience. Be specific and realistic for a LOCAL business:',
    '   a small shop should target a tight radius, not a whole state. Base the',
    '   radius on the budget -- a small daily budget spread over a wide radius',
    '   reaches nobody often enough to convert.',
    '2. Ad copies in ' +
      (brief.language === 'TANGLISH'
        ? 'Tanglish (Tamil written in Latin script, as people actually text)'
        : brief.language.toLowerCase()) +
      '.',
    '',
    'Rules:',
    '- Write the way a local shop owner speaks, not like a corporate brochure.',
    '- No invented claims: no discounts, prices, guarantees, awards or',
    '  delivery promises that the description does not state. This copy runs',
    '  as a real advert and false claims are the business owner\'s legal',
    '  liability, not ours.',
    '- Tamil copy must be real Tamil script, not transliteration.',
    '- Headlines under 60 characters so they are not truncated in feed.',
  ].join('\n');
}

/**
 * Models tried, in order, when the configured one is unavailable.
 *
 * Google retires model versions and closes older ones to new API keys, which
 * no deploy can predict -- `gemini-2.5-flash` started returning 404 "no longer
 * available to new users" in production with no code change on our side.
 * Aliases like `gemini-flash-latest` track the current model and do not go
 * stale, so they lead; pinned versions follow as a backstop.
 */
const FALLBACK_MODELS = [
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
];

/** True for "this model does not exist / not available to you" responses. */
function isModelUnavailable(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return (
    /\b404\b/.test(text) ||
    /NOT_FOUND/i.test(text) ||
    /no longer available/i.test(text) ||
    /is not found/i.test(text)
  );
}

export class AdPlanError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'AdPlanError';
  }
}

/** Turn a business brief into a validated targeting plan and ad copies. */
export async function generateAdPlan(brief: AdBrief): Promise<AdPlan> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // 500, not 400: the caller did nothing wrong, the deploy is misconfigured.
    throw new AdPlanError('GEMINI_API_KEY is not set on the server', 500);
  }

  const configured = process.env.GEMINI_MODEL?.trim() || 'gemini-flash-latest';
  const candidates = [
    configured,
    ...FALLBACK_MODELS.filter((m) => m !== configured),
  ];

  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildPrompt(brief);

  let raw: string | undefined;
  let lastError: unknown;

  for (const model of candidates) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: RESPONSE_JSON_SCHEMA,
          temperature: 0.8,
        },
      });
      raw = response.text;
      if (!raw) throw new AdPlanError('Gemini returned an empty response', 502);
      if (model !== configured) {
        // Loud rather than silent: the deploy is running on a model nobody
        // chose, and GEMINI_MODEL should be updated to match.
        console.warn(
          `Gemini model "${configured}" unavailable; used "${model}". Set GEMINI_MODEL to this value.`,
        );
      }
      break;
    } catch (err) {
      // Only "model does not exist" falls through. Auth failures, quota and
      // rate limits surface immediately -- retrying those against another
      // model just hides the real problem behind a slower failure.
      if (isModelUnavailable(err)) {
        lastError = err;
        continue;
      }
      throw err instanceof AdPlanError
        ? err
        : new AdPlanError(
            'The Gemini API call failed',
            502,
            err instanceof Error ? err.message : String(err),
          );
    }
  }

  if (!raw) {
    throw new AdPlanError(
      `No usable Gemini model. Tried: ${candidates.join(', ')}.`,
      502,
      lastError instanceof Error ? lastError.message : String(lastError),
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new AdPlanError('Model did not return valid JSON', 502, raw.slice(0, 500));
  }

  const result = AdPlanSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new AdPlanError(
      'Model output did not match the required shape',
      502,
      result.error.issues,
    );
  }

  // Cheap sanity fix rather than a hard failure: models occasionally invert
  // the age bounds, and rejecting the whole generation over it would waste a
  // paid call for something trivially correctable.
  const { targeting } = result.data;
  if (targeting.ageMin > targeting.ageMax) {
    [targeting.ageMin, targeting.ageMax] = [targeting.ageMax, targeting.ageMin];
  }

  return result.data;
}
