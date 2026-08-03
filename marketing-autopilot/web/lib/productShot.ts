import { GoogleGenAI, createPartFromBase64, createUserContent } from '@google/genai';

import { type SceneKey, findScene } from './scenes';

/**
 * Turns a shop owner's phone snapshot into a studio product shot.
 *
 * Nano Banana (Gemini's image models) is used for the *picture only*. The
 * Tamil headline is still drawn on the canvas afterwards, and that split is
 * deliberate rather than a limitation we have not got round to fixing:
 * generated Tamil comes back with reordered vowel signs and broken ligatures
 * often enough that no amount of prompting makes it safe to put in front of a
 * customer. A wrong headline on a poster is worse than a plain background.
 *
 * So the model is asked for a background and lighting, and told in as many
 * words to render no text at all.
 */

export class ProductShotError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ProductShotError';
  }
}

/**
 * Image models tried, in order.
 *
 * Nano Banana Pro leads because identity preservation is the whole job here:
 * the customer has to recognise the thing they will be handed in the shop, and
 * the Pro model holds a product's shape, colour and packaging text far better
 * when it repaints everything around it. Plain Nano Banana follows -- it is
 * cheaper and quicker, and is what runs if the preview model is withdrawn or
 * is not enabled on the key.
 *
 * Same lesson as the text models in adPlan.ts: Google retires versions with no
 * warning, so a single hardcoded id is an outage waiting to happen.
 */
const FALLBACK_MODELS = ['gemini-3-pro-image-preview', 'gemini-2.5-flash-image'];

function isModelUnavailable(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return (
    /\b404\b/.test(text) ||
    /NOT_FOUND/i.test(text) ||
    /no longer available/i.test(text) ||
    /is not found/i.test(text) ||
    /does not have access/i.test(text)
  );
}

function buildPrompt(scene: { prompt: string }, note: string | undefined) {
  return [
    'Re-photograph the product in this image as a professional commercial ' +
      'product photograph.',
    '',
    `Setting: ${scene.prompt}.`,
    note ? `The product is: ${note}.` : '',
    '',
    'Rules, in order of importance:',
    '1. The product itself must not change. Same shape, same colour, same ' +
      'proportions, same label and same wording printed on it. Do not ' +
      'restyle it, do not clean up its dents or wear, do not swap it for a ' +
      'similar product. A customer must recognise it on the shelf.',
    '2. Render no text anywhere in the image. No captions, no price, no ' +
      'logo, no watermark, no signage in the background. Text is added ' +
      'afterwards by hand.',
    '3. Replace only the background, the surface and the lighting.',
    '4. Centre the product with a little breathing room on all four sides, ' +
      'and keep it fully inside the frame.',
    '5. No people, no hands, no other products.',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface GeneratedShot {
  base64: string;
  mimeType: string;
  model: string;
}

/**
 * Repaints the scene around an uploaded product photo.
 *
 * Returns base64 rather than writing to blob storage: the browser puts it
 * straight on the canvas, and a generated shot the owner rejects should not
 * leave anything behind to clean up.
 */
export async function generateProductShot(params: {
  base64: string;
  mimeType: string;
  scene: SceneKey | string;
  note?: string;
}): Promise<GeneratedShot> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // 500, not 400: the caller did nothing wrong, the deploy is misconfigured.
    throw new ProductShotError('GEMINI_API_KEY is not set on the server', 500);
  }

  const configured = process.env.GEMINI_IMAGE_MODEL?.trim();
  const candidates = configured
    ? [configured, ...FALLBACK_MODELS.filter((m) => m !== configured)]
    : FALLBACK_MODELS;

  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildPrompt(findScene(params.scene), params.note);

  let lastError: unknown;

  for (const model of candidates) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: createUserContent([
          prompt,
          createPartFromBase64(params.base64, params.mimeType),
        ]),
        config: {
          imageConfig: {
            // Square, because that is what the poster canvas draws into.
            // Generating 16:9 and cropping would cut the product's sides off.
            aspectRatio: '1:1',
            // 2K rather than 4K: the poster is 1080x1080, so 4K would be paid
            // for and then thrown away in the downscale.
            imageSize: '2K',
          },
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        const data = part.inlineData?.data;
        if (data) {
          return {
            base64: data,
            mimeType: part.inlineData?.mimeType ?? 'image/png',
            model,
          };
        }
      }

      // A reply with no image is usually a safety refusal, and the model puts
      // its reason in the text part. Worth surfacing -- "no image came back"
      // on its own gives the owner nothing to change.
      const text = parts
        .map((p) => p.text)
        .filter(Boolean)
        .join(' ')
        .trim();
      throw new ProductShotError(
        text
          ? `The photo could not be restyled: ${text}`
          : 'No image came back. Try a different photo or another background.',
        502,
      );
    } catch (err) {
      lastError = err;
      if (isModelUnavailable(err)) continue;
      if (err instanceof ProductShotError) throw err;
      throw new ProductShotError(
        err instanceof Error ? err.message : 'Could not restyle the photo.',
        502,
      );
    }
  }

  throw new ProductShotError(
    lastError instanceof Error
      ? `No image model was available: ${lastError.message}`
      : 'No image model was available.',
    502,
  );
}
