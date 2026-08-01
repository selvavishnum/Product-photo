import { put } from '@vercel/blob';

/**
 * Puts an image somewhere Instagram can fetch it.
 *
 * Instagram's Content Publishing API takes `image_url` and fetches the file
 * from that URL itself -- unlike the ads API, which accepts raw `bytes`. So
 * publishing to Instagram, and only that, requires the image to be reachable
 * on the public internet first. There is no way around it short of not using
 * Instagram.
 *
 * Isolated behind one function so the store is swappable: Vercel Blob is
 * chosen because the app already runs on Vercel and it needs no extra
 * account, but R2 or S3 would slot in here without the publish code noticing.
 *
 * Deliberately not used for Meta ad images. Those still go up as base64
 * bytes, which is fewer moving parts and leaves nothing lying around.
 */

export class ImageHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageHostError';
  }
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Instagram fetches the URL server-side and rejects formats it does not
 * recognise, with an error that does not say which part failed. Checking
 * here means the failure is reported while the user is still looking at the
 * upload they can change.
 */
export function assertInstagramFormat(contentType: string): void {
  if (!EXTENSIONS[contentType.toLowerCase()]) {
    throw new ImageHostError(
      'Instagram accepts JPEG and PNG images. Try a different photo.',
    );
  }
}

export async function hostImage(
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  assertInstagramFormat(contentType);

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new ImageHostError(
      'Instagram posting needs a Vercel Blob store. Create one in the Vercel ' +
        'dashboard (Storage -> Blob) and redeploy; it sets BLOB_READ_WRITE_TOKEN ' +
        'automatically.',
    );
  }

  const ext = EXTENSIONS[contentType.toLowerCase()];

  try {
    const blob = await put(`instagram/${Date.now()}.${ext}`, bytes, {
      access: 'public',
      // Without this, two posts in the same millisecond collide and the
      // second throws rather than overwriting.
      addRandomSuffix: true,
      contentType,
      // Instagram fetches the image within seconds of the container being
      // created and never again -- it stores its own copy. A long cache
      // lifetime would just keep a file we no longer need warm.
      cacheControlMaxAge: 60 * 60,
    });
    return blob.url;
  } catch (err) {
    throw new ImageHostError(
      `Could not upload the photo: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
