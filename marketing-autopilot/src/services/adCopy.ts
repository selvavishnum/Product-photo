import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { z } from 'zod';

import { env } from '../config/env.js';
import { invalidModelOutput, upstreamFailed } from '../lib/errors.js';

/**
 * What the model is required to return.
 *
 * This schema is the contract, not a suggestion. LLM output is parsed against
 * it before anything is written to the database or sent to an ad platform,
 * because the failure mode otherwise is a malformed campaign submitted to Meta
 * with the user's money attached to it.
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
 * JSON Schema handed to the provider so it constrains generation, rather than
 * us hoping prose instructions are obeyed. Kept alongside the Zod schema and
 * validated by it afterwards -- structured-output support reduces malformed
 * responses but does not eliminate them, so this is belt and braces.
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

async function callGemini(prompt: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY! });
  const response = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: RESPONSE_JSON_SCHEMA,
      temperature: 0.8,
    },
  });
  const text = response.text;
  if (!text) throw invalidModelOutput('Gemini returned an empty response');
  return text;
}

async function callOpenAI(prompt: string): Promise<string> {
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY! });
  const completion = await client.chat.completions.create({
    model: env.OPENAI_MODEL,
    temperature: 0.8,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'ad_plan',
        strict: false,
        schema: RESPONSE_JSON_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    messages: [{ role: 'user', content: prompt }],
  });
  const text = completion.choices[0]?.message?.content;
  if (!text) throw invalidModelOutput('OpenAI returned an empty response');
  return text;
}

/**
 * Turn a business brief into a validated targeting plan and ad copies.
 *
 * Provider-agnostic on purpose: these APIs and their pricing change often
 * enough that being locked to one is a real risk, and the calling code should
 * not have to care which one answered.
 */
export async function generateAdPlan(brief: AdBrief): Promise<AdPlan> {
  const prompt = buildPrompt(brief);

  let raw: string;
  try {
    raw = env.LLM_PROVIDER === 'gemini'
      ? await callGemini(prompt)
      : await callOpenAI(prompt);
  } catch (err) {
    if (err instanceof Error && err.name === 'AppError') throw err;
    throw upstreamFailed(
      `The ${env.LLM_PROVIDER} API call failed`,
      err instanceof Error ? err.message : String(err),
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw invalidModelOutput('Model did not return valid JSON', raw.slice(0, 500));
  }

  const result = AdPlanSchema.safeParse(parsedJson);
  if (!result.success) {
    throw invalidModelOutput(
      'Model output did not match the required shape',
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
