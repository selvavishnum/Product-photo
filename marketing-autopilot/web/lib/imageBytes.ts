/**
 * Works out what an upload actually is, rather than what it says it is.
 *
 * The declared Content-Type cannot be trusted in either direction. Mobile
 * HTTP clients default a multipart part to `application/octet-stream` unless
 * the caller sets it explicitly -- which is how a perfectly good JPEG got
 * rejected with "Uploaded file must be an image", a message that was true of
 * the header and wrong about the file.
 *
 * The client is fixed too, but a check that only reads the header is one
 * forgotten parameter away from breaking again, on any client, including ones
 * we do not write.
 *
 * Sniffing is also the stricter test: a header can claim `image/png` for
 * anything at all, and these signatures cannot.
 */

export type SniffedFormat = 'jpeg' | 'png' | 'webp' | 'gif' | null;

/**
 * Reads the magic bytes at the head of the file.
 *
 * Signature lengths and offsets are from the format specifications, not from
 * a library, because the whole point is not to trust the wrapper.
 */
export function sniffImage(bytes: Uint8Array): SniffedFormat {
  if (bytes.length < 12) return null;

  // FF D8 FF -- SOI followed by the first marker.
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';

  // 89 P N G \r \n 1A \n
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }

  // RIFF....WEBP -- the size field sits between the two tags.
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }

  // GIF87a / GIF89a
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'gif';
  }

  return null;
}

export interface ResolvedImage {
  bytes: Buffer;
  /** The real type, from the bytes -- not the one the client declared. */
  mimeType: string;
}

/**
 * Validates an uploaded file and returns its bytes with a trustworthy type.
 *
 * Throws a plain Error whose message is safe to show the person who uploaded
 * it: at this point they are looking at a photo they just picked, and "that
 * file is not an image" is only useful if it is actually true.
 */
export async function resolveUploadedImage(
  file: File,
  maxBytes: number,
): Promise<ResolvedImage> {
  if (file.size === 0) throw new Error('The photo was empty.');
  if (file.size > maxBytes) {
    throw new Error(
      `Photo must be under ${Math.floor(maxBytes / (1024 * 1024))} MB`,
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const format = sniffImage(bytes);

  if (!format) {
    // Only now, having actually looked. The declared type is mentioned
    // because when it is wrong it is the clue that explains the rest.
    throw new Error(
      `That file is not an image we can read (it arrived as ${
        file.type || 'an unknown type'
      }). JPEG, PNG or WebP.`,
    );
  }

  return { bytes, mimeType: `image/${format}` };
}
