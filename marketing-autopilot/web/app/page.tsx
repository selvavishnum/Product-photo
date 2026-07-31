import Link from 'next/link';

/**
 * Landing page.
 *
 * Every claim here maps to something that actually exists in the codebase.
 * Google Ads and voice input are deliberately absent: neither is built, and
 * advertising an unbuilt feature is the same mistake the ad-copy prompt
 * forbids our own users from making.
 */
export default function LandingPage() {
  return (
    <main className="mx-auto max-w-md px-5">
      <nav className="flex items-center justify-between py-5">
        <span className="font-display text-base font-bold">Ad Auto-Pilot</span>
      </nav>

      <section className="pt-10 pb-12">
        <h1 className="text-4xl font-extrabold leading-[1.15] tracking-tight">
          Ads for your shop, without the jargon
        </h1>
        <p className="mt-4 text-lg text-muted">
          Tell us what you sell. You get ad text in Tamil or English, ready to
          share — and a plan for who should see it nearby.
        </p>
        <p className="mt-3 text-muted">
          உங்கள் கடைக்கான விளம்பரம் — தமிழிலோ ஆங்கிலத்திலோ
        </p>

        <Link
          href="/create"
          role="button"
          className="mt-9 flex w-full items-center justify-center gap-3 rounded-full bg-ink px-8 py-4 text-base font-semibold text-white transition hover:opacity-85"
        >
          Make my ad
          <span aria-hidden>→</span>
        </Link>
        <p className="mt-3 text-center text-sm text-faint">
          Free. Nothing is published until you say so.
        </p>
      </section>

      <section className="border-t border-line py-12">
        <h2 className="mb-7 text-xl font-bold">How it works</h2>
        <ol className="grid gap-7">
          {[
            {
              n: '1',
              title: 'Answer a few questions',
              body: 'Your shop, what you sell, and where you are.',
            },
            {
              n: '2',
              title: 'Get your ad',
              body: 'Written the way a shop owner speaks, in your language.',
            },
            {
              n: '3',
              title: 'Share it, or run it',
              body: 'Send it to WhatsApp for free, or pay to reach people nearby.',
            },
          ].map((s) => (
            <li key={s.n} className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">
                {s.n}
              </span>
              <span>
                <h3 className="font-bold">{s.title}</h3>
                <p className="mt-0.5 text-sm text-muted">{s.body}</p>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="border-t border-line py-8 text-sm text-faint">
        <p>
          Sharing works straight away. Running a paid ad needs your own
          Facebook ad account connected. Google Ads is not supported yet.
        </p>
      </footer>
    </main>
  );
}
