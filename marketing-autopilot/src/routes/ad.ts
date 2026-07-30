import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { env } from '../config/env.js';
import { badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { generateAdPlan } from '../services/adCopy.js';

const router = Router();

// In-memory: the image is only forwarded to storage/the ad platform, never
// served from this process, so writing it to disk buys nothing and leaves
// files to clean up.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const GenerateBodySchema = z.object({
  businessName: z.string().min(1).max(120),
  businessCategory: z.string().min(1).max(80),
  /** Free text, or a transcript of the owner's voice note. */
  description: z.string().min(10).max(4000),
  city: z.string().max(80).optional(),
  language: z.enum(['TAMIL', 'ENGLISH', 'TANGLISH']).default('TAMIL'),
  imageUrl: z.string().url().optional(),
  dailyBudgetInr: z.coerce
    .number()
    .int('Budget must be a whole number of rupees')
    .positive()
    // Server-side ceiling, deliberately not taken from the request. A client
    // cannot raise its own spending limit.
    .max(
      env.MAX_DAILY_BUDGET_INR,
      `Daily budget cannot exceed INR ${env.MAX_DAILY_BUDGET_INR}`,
    ),
});

/**
 * POST /api/v1/ad/generate
 *
 * Accepts JSON, or multipart when an image is attached. Returns a targeting
 * plan and ad copies.
 *
 * Deliberately does NOT create a campaign or touch an ad platform: it only
 * proposes. Nothing here can spend money. Publishing is a separate,
 * explicitly-confirmed step, because an endpoint that both generates and
 * launches makes an accidental double-submit cost the user real budget.
 */
router.post('/generate', upload.single('image'), async (req, res) => {
  const parsed = GenerateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest('Invalid request', parsed.error.issues);
  }
  const input = parsed.data;

  const file = req.file;
  if (file && !file.mimetype.startsWith('image/')) {
    throw badRequest('Uploaded file must be an image');
  }

  const startedAt = Date.now();
  const plan = await generateAdPlan({
    businessName: input.businessName,
    businessCategory: input.businessCategory,
    description: input.description,
    city: input.city,
    language: input.language,
    dailyBudgetInr: input.dailyBudgetInr,
  });

  logger.info(
    {
      businessCategory: input.businessCategory,
      copies: plan.copies.length,
      ms: Date.now() - startedAt,
    },
    'ad plan generated',
  );

  res.status(200).json({
    plan,
    // Echoed so the client can show what the plan was based on without
    // keeping its own copy in sync.
    input: {
      businessName: input.businessName,
      dailyBudgetInr: input.dailyBudgetInr,
      language: input.language,
      hasImage: Boolean(file || input.imageUrl),
    },
    status: 'DRAFT',
    note:
      'Nothing has been published. Review, then submit separately to go live.',
  });
});

export default router;
