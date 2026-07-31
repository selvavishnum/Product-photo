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
    <main>
      <nav className="flex items-center justify-between border-b border-line px-6 py-5">
        <span className="text-lg font-semibold">Ad Auto-Pilot</span>
        <Link
          href="/create"
          role="button"
          className="inline-flex items-center rounded-xl bg-brand px-5 py-2.5 font-medium text-white hover:opacity-90"
        >
          Start free
        </Link>
      </nav>

      <section className="mx-auto max-w-3xl px-6 pt-16 pb-14 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Ads for your shop, without the jargon
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-slate-400">
          Tell us what you sell. You get a ready-made poster, ad text in Tamil
          or English, and a plan for who should see it nearby.
        </p>
        <p className="mt-3 text-slate-500">
          உங்கள் கடைக்கான விளம்பரம் — தமிழிலோ ஆங்கிலத்திலோ
        </p>

        <Link
          href="/create"
          role="button"
          className="mt-9 inline-flex items-center rounded-2xl bg-gradient-to-r from-brand to-accent px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-brand/25 hover:opacity-90"
        >
          Make my ad
        </Link>
        <p className="mt-4 text-sm text-slate-500">
          Free to try. Nothing is published until you say so.
        </p>
      </section>

      <section className="mx-auto max-w-4xl border-t border-line/60 px-6 py-14">
        <h2 className="mb-9 text-center text-2xl font-semibold">
          Three steps
        </h2>
        <ol className="grid gap-5 sm:grid-cols-3">
          {[
            {
              n: '1',
              title: 'Describe your shop',
              body: 'Your shop name, what you sell, and a product photo.',
            },
            {
              n: '2',
              title: 'Pick a daily budget',
              body: 'Choose an amount. We suggest how far around you to advertise.',
            },
            {
              n: '3',
              title: 'Check and publish',
              body: 'See the poster and the words before anything goes live.',
            },
          ].map((s) => (
            <li
              key={s.n}
              className="rounded-2xl border border-line/70 bg-surface/60 p-6"
            >
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft/50 font-bold text-brand">
                {s.n}
              </span>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-slate-400">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="border-t border-line/60 px-6 py-8 text-center text-sm text-slate-500">
        <p>
          Publishing to Facebook and Instagram needs your own Meta ad account
          connected. Google Ads is not supported yet.
        </p>
      </footer>
    </main>
  );
}
