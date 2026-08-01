'use client';

import { useEffect, useState } from 'react';

/**
 * Hands the finished ad to whatever the phone can share with.
 *
 * Nothing here touches Meta. The owner picks WhatsApp, Instagram, a customer
 * group, anything -- which is the fastest route to actually using the ad, and
 * needs no ad account, no token and no approval. Paid publishing is a
 * separate, slower path; this one works the moment the copy exists.
 *
 * Progressive enhancement in three tiers, because Web Share support varies
 * more than any other API here:
 *
 *   1. Android/iOS browsers: native share sheet with the image attached.
 *   2. Share sheet without file support: text only.
 *   3. Desktop: copy the text, download the image.
 *
 * Capability is detected on the client after mount rather than assumed.
 * `navigator.share` does not exist during server rendering, and `canShare`
 * with files is false on most desktop browsers even where `share` exists --
 * so the tier is decided by asking, not by guessing from the user agent.
 */

interface Props {
  hook?: string;
  headline: string;
  primaryText: string;
  cta: string;
  hashtags?: string[];
  image: File | null;
}

type Capability = 'unknown' | 'files' | 'text' | 'none';

export default function ShareButton({
  hook,
  headline,
  primaryText,
  cta,
  hashtags,
  image,
}: Props) {
  const [capability, setCapability] = useState<Capability>('unknown');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.share) {
      setCapability('none');
      return;
    }
    const canFiles =
      image !== null &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [image] });
    setCapability(canFiles ? 'files' : 'text');
  }, [image]);

  // Blank lines between the parts: this is pasted straight into WhatsApp,
  // where one dense paragraph does not get read. Hook first, because that is
  // the line that decides whether the rest is read at all.
  const text = [
    hook,
    headline,
    primaryText,
    cta,
    hashtags?.length ? hashtags.map((t) => `#${t}`).join(' ') : undefined,
  ]
    .filter((part) => part && part.trim().length > 0)
    .join('\n\n');

  async function share() {
    try {
      if (capability === 'files' && image) {
        await navigator.share({ text, files: [image] });
        return;
      }
      if (capability === 'text') {
        await navigator.share({ text, title: headline });
        return;
      }
      await copy();
    } catch (err) {
      // Dismissing the share sheet rejects with AbortError. That is the user
      // changing their mind, not a failure, and must not surface as one.
      if (err instanceof Error && err.name === 'AbortError') return;
      await copy();
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked without a secure context or user gesture in some
      // browsers. Silent rather than an error the user cannot act on.
    }
  }

  return (
    <div className="mt-4 grid gap-2">
      <button
        type="button"
        onClick={share}
        className="w-full rounded-full bg-ink px-6 py-4 text-base font-semibold text-white transition hover:opacity-85"
      >
        {capability === 'none'
          ? copied
            ? 'Copied ✓'
            : 'Copy the ad text'
          : 'Share this ad'}
      </button>

      {image && (
        // Kept alongside sharing rather than instead of it: an owner who wants
        // the picture in their gallery to post later should not have to go
        // through a share sheet to get it.
        <a
          href={URL.createObjectURL(image)}
          download={`${headline.slice(0, 30).replace(/[^\p{L}\p{N} ]/gu, '') || 'ad'}.jpg`}
          className="w-full rounded-full border border-line px-6 py-4 text-center text-base font-medium text-ink transition hover:border-line-strong"
        >
          Save the photo
        </a>
      )}

      <p className="text-center text-xs text-faint">
        {capability === 'files'
          ? 'Opens WhatsApp, Instagram, wherever you like — photo included.'
          : capability === 'text'
            ? 'Opens your share menu with the words. Save the photo separately.'
            : 'Copies the words so you can paste them anywhere.'}
      </p>
    </div>
  );
}
