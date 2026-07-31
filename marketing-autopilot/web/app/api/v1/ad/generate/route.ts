import { NextResponse } from 'next/server';
import { z } from 'zod';

import { AdPlanError, generateAdPlan } from '../../../../../lib/adPlan';

/**
 * POST /api/v1/ad/generate
 *
 * Accepts the wizard's multipart form and returns a targeting plan plus ad
 * copies.
 *
 * Deliberately does NOT create a campaign or touch an ad platform: it only
 * proposes. Nothing here can spend money. Publishing stays a separate,
 * explicitly-confirmed step, because an endpoint that both generates and
 * launches makes an accidental double-submit cost the user real budget.
 */

// Node, not Edge: @google/genai is a Node SDK. Edge would fail at runtime,
// after a build that looked fine.
export const runtime = 'nodejs';

/** Gemini takes several seconds; the platform default can be shorter. */
export const maxDuration = 60;

/**
 * Server-side ceiling on daily spend, deliberately not taken from the
 * request. A client cannot raise its own spending limit.
 */
const maxDailyBudget = () => {
  const raw = Number(process.env.MAX_DAILY_BUDGET_INR);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5000;
};

const BodySchema = z.object({
  businessName: z.string().min(1).max(120),
  businessCategory: z.string().min(1).max(80),
  /** Free text, or a transcript of the owner's voice note. */
  description: z.string().min(10).max(4000),
  city: z.string().max(80).optional(),
  language: z.enum(['TAMIL', 'ENGLISH', 'TANGLISH']).default('TAMIL'),
  dailyBudgetInr: z.coerce
    .number()
    .int('Budget must be a whole number of rupees')
    .positive(),
});

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: { message: 'Expected a form submission' } },
      { status: 400 },
    );
  }

  const raw = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === 'string'),
  );

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: 'Invalid request', details: parsed.error.issues } },
      { status: 400 },
    );
  }

  const input = parsed.data;

  const cap = maxDailyBudget();
  if (input.dailyBudgetInr > cap) {
    return NextResponse.json(
      { error: { message: `Daily budget cannot exceed INR ${cap}` } },
      { status: 400 },
    );
  }

  // The image is accepted and validated but not sent to the model: the plan
  // is built from the description. It is checked here anyway so a bad upload
  // fails now, at the point the user can still fix it, rather than later in
  // the poster step.
  const image = form.get('image');
  const hasImage = image instanceof File && image.size > 0;
  if (hasImage) {
    if (!image.type.startsWith('image/')) {
      return NextResponse.json(
        { error: { message: 'Uploaded file must be an image' } },
        { status: 400 },
      );
    }
    if (image.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: { message: 'Image must be under 10 MB' } },
        { status: 413 },
      );
    }
  }

  try {
    const plan = await generateAdPlan(input);

    return NextResponse.json({
      plan,
      // Echoed so the client can show what the plan was based on without
      // keeping its own copy in sync.
      input: {
        businessName: input.businessName,
        dailyBudgetInr: input.dailyBudgetInr,
        language: input.language,
        hasImage,
      },
      status: 'DRAFT',
      note: 'Nothing has been published. Review, then submit separately to go live.',
    });
  } catch (err) {
    if (err instanceof AdPlanError) {
      // Logged in full, returned in summary: the detail can contain the
      // model's raw output, which is not something to hand to a browser.
      console.error('ad plan failed', err.message, err.detail);
      return NextResponse.json(
        { error: { message: err.message } },
        { status: err.status },
      );
    }
    console.error('ad plan failed', err);
    return NextResponse.json(
      { error: { message: 'Could not generate the ad. Please try again.' } },
      { status: 500 },
    );
  }
}
