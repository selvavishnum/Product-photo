'use client';

import Link from 'next/link';
import { useState } from 'react';

import ShareButton from '../share-button';
import PosterMaker from './poster-maker';
import {
  Choice,
  Continue,
  Feedback,
  Question,
  StepShell,
  inputClass,
} from './step-shell';

/**
 * The campaign wizard.
 *
 * One question per screen. A shop owner filling this in on a phone between
 * customers can hold one decision at a time; a single long form is where
 * people give up halfway. The trade is more taps, and it is worth it.
 *
 * Other deliberate choices:
 *
 *  - **Budget is preset chips, not a number field.** "How much per day?" as a
 *    free input asks someone to guess a number they have no basis for. Three
 *    amounts with a plain-language consequence is a decision they can make.
 *  - **No advertising vocabulary.** No objective, optimisation goal, bid
 *    strategy, CPM or impressions anywhere. Those are chosen server-side.
 *  - **Tamil sits alongside English** rather than behind a language toggle,
 *    because the person reading may be more comfortable in either and should
 *    not have to find a setting first.
 *  - **Sharing comes before publishing.** Handing the ad to WhatsApp works
 *    today with no ad account; paid publishing needs setup and approval. The
 *    thing that works is offered first.
 */

const TOTAL_STEPS = 6;

interface AdCopy {
  language: string;
  headline: string;
  primaryText: string;
  cta: string;
}

interface Targeting {
  ageMin: number;
  ageMax: number;
  genders: string[];
  locationRadiusKm: number;
  locationName: string;
  interests: string[];
  rationale: string;
}

interface GenerateResponse {
  plan: { targeting: Targeting; copies: AdCopy[] };
  input: { dailyBudgetInr: number };
  note: string;
}

interface PublishResponse {
  adId: string;
  campaignId: string;
  effectiveStatus: string;
  matchedLocation: string | null;
  note: string;
}

interface InstagramResponse {
  postId: string;
  permalink?: string;
  note: string;
}

const LANGUAGES = [
  { value: 'TAMIL', label: 'தமிழ்', hint: 'Tamil script' },
  { value: 'TANGLISH', label: 'Tanglish', hint: 'Tamil in English letters' },
  { value: 'ENGLISH', label: 'English', hint: '' },
];

const BUDGETS = [
  { inr: 150, label: '₹150 a day', hint: 'Try it for a few days' },
  { inr: 300, label: '₹300 a day', hint: 'Where most local shops start' },
  { inr: 600, label: '₹600 a day', hint: 'Festival or opening week' },
];

export default function CreatePage() {
  const [step, setStep] = useState(1);

  const [businessName, setBusinessName] = useState('');
  const [businessCategory, setBusinessCategory] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [language, setLanguage] = useState('TAMIL');
  const [budget, setBudget] = useState(0);
  const [image, setImage] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);

  const [passcode, setPasscode] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [published, setPublished] = useState<PublishResponse | null>(null);

  /// The rendered poster, which stands in for the raw photo everywhere it is
  /// published: a product snapshot with the offer written on it does the job
  /// the snapshot alone cannot, and it is the same one tap either way.
  const [poster, setPoster] = useState<File | null>(null);

  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [posted, setPosted] = useState<InstagramResponse | null>(null);

  const back = () => setStep((s) => Math.max(1, s - 1));
  const next = () => setStep((s) => s + 1);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('businessName', businessName);
      form.set('businessCategory', businessCategory);
      form.set('description', description);
      if (city) form.set('city', city);
      form.set('language', language);
      form.set('dailyBudgetInr', String(budget));
      if (image) form.set('image', image);

      const res = await fetch('/api/v1/ad/generate', { method: 'POST', body: form });
      const data = await res.json();

      if (!res.ok) {
        // The API returns field-level Zod issues; surface the first one in
        // plain language rather than dumping the whole array.
        const detail = Array.isArray(data?.error?.details)
          ? data.error.details[0]?.message
          : undefined;
        setError(detail ?? data?.error?.message ?? 'Something went wrong.');
        return;
      }

      setResult(data as GenerateResponse);
      setStep(TOTAL_STEPS + 1);
    } catch {
      setError('Could not reach the server. Check your connection.');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Sends the reviewed plan to Meta.
   *
   * The plan travels back to the server rather than being held there between
   * the two steps: with one shop and no database, a round trip is simpler
   * than a session store. The server re-checks the budget ceiling on arrival,
   * so nothing here can raise its own spending limit by editing the payload.
   */
  async function publish() {
    const art = poster ?? image;
    if (!result || !art) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const form = new FormData();
      form.set(
        'plan',
        JSON.stringify({
          businessName,
          language,
          dailyBudgetInr: result.input.dailyBudgetInr,
          targeting: result.plan.targeting,
          copies: result.plan.copies,
        }),
      );
      form.set('image', art);

      const res = await fetch('/api/v1/campaign/publish', {
        method: 'POST',
        headers: { 'x-owner-passcode': passcode },
        body: form,
      });
      const data = await res.json();

      if (!res.ok) {
        const detail = Array.isArray(data?.error?.details)
          ? data.error.details[0]?.message
          : undefined;
        setPublishError(
          // A policy rejection is Meta's own wording about what to change, so
          // it is shown as-is rather than replaced with something generic.
          data?.error?.isPolicy
            ? `Facebook rejected this ad: ${data.error.message}`
            : (detail ?? data?.error?.message ?? 'Could not publish.'),
        );
        return;
      }

      setPublished(data as PublishResponse);
    } catch {
      setPublishError('Could not reach the server. Check your connection.');
    } finally {
      setPublishing(false);
    }
  }

  /**
   * Posts to the shop's own Instagram feed.
   *
   * Free, unlike the paid path below it, but still behind the passcode: it
   * puts text and a photo publicly under the owner's name, and an open
   * endpoint that can do that is its own kind of expensive.
   */
  async function postToInstagram(copy: AdCopy) {
    const art = poster ?? image;
    if (!art) return;
    setPosting(true);
    setPostError(null);
    try {
      const form = new FormData();
      form.set(
        'copy',
        JSON.stringify({
          headline: copy.headline,
          primaryText: copy.primaryText,
          cta: copy.cta,
        }),
      );
      form.set('image', art);

      const res = await fetch('/api/v1/instagram/post', {
        method: 'POST',
        headers: { 'x-owner-passcode': passcode },
        body: form,
      });
      const data = await res.json();

      if (!res.ok) {
        setPostError(data?.error?.message ?? 'Could not post to Instagram.');
        return;
      }
      setPosted(data as InstagramResponse);
    } catch {
      setPostError('Could not reach the server. Check your connection.');
    } finally {
      setPosting(false);
    }
  }

  function restart() {
    setResult(null);
    setPublished(null);
    setPublishError(null);
    setPosted(null);
    setPostError(null);
    setPoster(null);
    setError(null);
    setStep(1);
  }

  /* ---------------- result ---------------- */

  if (result) {
    const preferred =
      result.plan.copies.find((c) => c.language === language) ??
      result.plan.copies[0];

    // What actually gets published. The poster renders even with no product
    // photo -- headline and call to action on a gradient -- so publishing no
    // longer depends on the owner having had a picture to hand.
    const artwork = poster ?? image;

    return (
      <main className="mx-auto max-w-md px-5 pt-6 pb-16">
        <h1 className="text-3xl font-extrabold tracking-tight">
          Your ad is ready
        </h1>
        <p className="mt-2 text-lg text-muted">உங்கள் விளம்பரம் தயார்</p>

        {result.plan.copies.map((c, i) => (
          <article
            key={i}
            className="mt-5 rounded-3xl border border-line p-5"
          >
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
              {c.language}
            </p>
            <h2 className="text-xl font-bold leading-snug">{c.headline}</h2>
            <p className="mt-2 text-ink/75">{c.primaryText}</p>
            <span className="mt-4 inline-block rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">
              {c.cta}
            </span>
          </article>
        ))}

        <PosterMaker
          headline={preferred.headline}
          cta={preferred.cta}
          image={image}
          onPoster={setPoster}
        />

        {/* First, because it works right now: no ad account, no token, no
            approval, no money. */}
        <section className="mt-8">
          <h2 className="text-lg font-bold">Send it to your customers</h2>
          <p className="mt-1 text-sm text-muted">
            WhatsApp, Instagram, your customer group — free, right now.
          </p>
          <ShareButton
            headline={preferred.headline}
            primaryText={preferred.primaryText}
            cta={preferred.cta}
            image={artwork}
          />
        </section>

        {/* Free like sharing, but it publishes rather than hands over, so it
            sits between the two -- and behind the same passcode as the paid
            path, because it posts publicly under the owner's name. */}
        <section className="mt-10">
          <h2 className="text-lg font-bold">Post it to Instagram</h2>
          <p className="mt-1 text-sm text-muted">
            Goes straight to your shop&rsquo;s feed. Free — this is not a paid
            ad.
          </p>

          {posted ? (
            <div className="mt-4 rounded-3xl border border-success/30 bg-success-soft p-5">
              <p className="font-semibold text-success">{posted.note}</p>
              {posted.permalink && (
                <a
                  href={posted.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white"
                >
                  See the post
                </a>
              )}
            </div>
          ) : (
            <>
              {!artwork && (
                <p className="mt-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
                  Waiting for the poster to finish drawing.
                </p>
              )}
              {postError && (
                <p className="mt-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
                  {postError}
                </p>
              )}
              <input
                className={`${inputClass} mt-4`}
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Owner passcode"
              />
              <button
                type="button"
                onClick={() => postToInstagram(preferred)}
                disabled={posting || !artwork || passcode.length === 0}
                className="mt-4 w-full rounded-full border border-line-strong px-6 py-4 font-semibold transition hover:bg-surface disabled:opacity-25"
              >
                {posting ? 'Posting…' : 'Post to Instagram'}
              </button>
            </>
          )}
        </section>

        <section className="mt-10 rounded-3xl bg-surface p-5">
          <h2 className="font-bold">Who a paid ad would reach</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Age</dt>
            <dd>
              {result.plan.targeting.ageMin}–{result.plan.targeting.ageMax}
            </dd>
            <dt className="text-muted">Area</dt>
            <dd>
              {result.plan.targeting.locationName} ·{' '}
              {result.plan.targeting.locationRadiusKm} km around you
            </dd>
            <dt className="text-muted">Budget</dt>
            <dd>₹{result.input.dailyBudgetInr} per day</dd>
          </dl>
          <p className="mt-3 text-sm text-muted">
            {result.plan.targeting.rationale}
          </p>
        </section>

        {published ? (
          <section className="mt-5 rounded-3xl border border-success/30 bg-success-soft p-5">
            <h2 className="font-bold text-success">Sent to Facebook — paused</h2>
            <p className="mt-2 text-sm text-ink/75">{published.note}</p>
            {published.matchedLocation && (
              <p className="mt-2 text-sm text-muted">
                Meta matched your area to{' '}
                <strong className="text-ink">{published.matchedLocation}</strong>.
              </p>
            )}
            <a
              href="https://adsmanager.facebook.com/"
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-block rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white"
            >
              Open Ads Manager
            </a>
          </section>
        ) : (
          <section className="mt-5 rounded-3xl border border-line p-5">
            <h2 className="font-bold">Or run it as a paid ad</h2>
            <p className="mt-2 text-sm text-muted">
              This creates the campaign on Facebook and leaves it{' '}
              <strong className="text-ink">paused</strong>. Nothing spends
              until you switch it on yourself.
            </p>

            {!artwork && (
              <p className="mt-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
                Waiting for the poster to finish drawing.
              </p>
            )}

            {/* Shown only when the Instagram section above has not already
                asked for it -- one passcode, two uses, but two boxes on the
                same screen reads like two different secrets. */}
            {!posted && (
              <p className="mt-4 text-xs text-faint">
                Uses the same owner passcode as above.
              </p>
            )}
            {posted && (
              <input
                className={`${inputClass} mt-4`}
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Owner passcode"
              />
            )}

            {publishError && (
              <p className="mt-4 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
                {publishError}
              </p>
            )}

            <button
              type="button"
              onClick={publish}
              disabled={publishing || !artwork || passcode.length === 0}
              className="mt-5 w-full rounded-full border border-line-strong px-6 py-4 font-semibold transition hover:bg-surface disabled:opacity-25"
            >
              {publishing ? 'Sending to Facebook…' : 'Send to Facebook'}
            </button>
          </section>
        )}

        <button
          type="button"
          onClick={restart}
          className="mt-8 w-full rounded-full border border-line px-6 py-4 text-muted transition hover:border-faint"
        >
          Make another ad
        </button>
      </main>
    );
  }

  /* ---------------- questions ---------------- */

  return (
    <StepShell
      step={step}
      total={TOTAL_STEPS}
      onBack={step === 1 ? undefined : back}
    >
      {step === 1 && (
        <>
          <Question title="What is your shop called?" tamil="கடையின் பெயர்?" />
          <input
            className={inputClass}
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Sri Lakshmi Jewellers"
            autoFocus
          />
          <Continue onClick={next} disabled={businessName.trim().length === 0} />
          <p className="mt-6 text-center text-sm">
            <Link href="/" className="text-muted underline">
              Back to start
            </Link>
          </p>
        </>
      )}

      {step === 2 && (
        <>
          <Question title="What do you sell?" tamil="என்ன விற்கிறீர்கள்?" />
          <input
            className={inputClass}
            value={businessCategory}
            onChange={(e) => setBusinessCategory(e.target.value)}
            placeholder="Jewellery shop"
            autoFocus
          />
          <Continue
            onClick={next}
            disabled={businessCategory.trim().length === 0}
          />
        </>
      )}

      {step === 3 && (
        <>
          <Question
            title="What do you want to advertise?"
            tamil="எதை விளம்பரப்படுத்த வேண்டும்?"
          >
            A sentence or two. The more you say, the better the ad.
          </Question>
          <textarea
            className={`${inputClass} min-h-36`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Bridal sets and daily-wear gold chains. We want more customers for the wedding season."
            autoFocus
          />
          {description.trim().length >= 10 && (
            <Feedback>
              Good. We will write the ad from this and invent nothing you have
              not said.
            </Feedback>
          )}
          <Continue onClick={next} disabled={description.trim().length < 10} />
        </>
      )}

      {step === 4 && (
        <>
          <Question title="Which town are you in?" tamil="எந்த ஊர்?">
            We advertise only to people near you.
          </Question>
          <input
            className={inputClass}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Thuckalay"
            autoFocus
          />
          {city.trim().length > 0 && (
            <Feedback>
              Your ad will go to people around {city.trim()}, not the whole
              state — a small budget spread wide reaches nobody often enough.
            </Feedback>
          )}
          <Continue onClick={next} disabled={city.trim().length === 0} />
        </>
      )}

      {step === 5 && (
        <>
          <Question
            title="Which language?"
            tamil="எந்த மொழி?"
          >
            Whatever your customers read most comfortably.
          </Question>
          <div className="grid gap-3">
            {LANGUAGES.map((l) => (
              <Choice
                key={l.value}
                label={l.label}
                hint={l.hint}
                selected={language === l.value}
                onSelect={() => setLanguage(l.value)}
              />
            ))}
          </div>

          <div className="mt-8">
            <p className="mb-2 font-semibold">
              Product photo{' '}
              <span className="font-normal text-faint">· optional</span>
            </p>
            <input
              className={inputClass}
              type="file"
              accept="image/*"
              onChange={(e) => setImage(e.target.files?.[0] ?? null)}
            />
            <p className="mt-1.5 text-xs text-faint">
              {image
                ? `${image.name} — you can share this with the ad.`
                : 'Needed only if you want to run this as a paid Facebook ad.'}
            </p>
          </div>

          <Continue onClick={next} />
        </>
      )}

      {step === 6 && (
        <>
          <Question title="How much per day?" tamil="ஒரு நாளைக்கு எவ்வளவு?">
            Only matters if you run a paid ad. Sharing is free.
          </Question>
          <div className="grid gap-3">
            {BUDGETS.map((b) => (
              <Choice
                key={b.inr}
                label={b.label}
                hint={b.hint}
                selected={budget === b.inr}
                onSelect={() => setBudget(b.inr)}
              />
            ))}
          </div>

          {budget > 0 && (
            <Feedback>
              We will suggest how far around {city.trim() || 'you'} to
              advertise based on this. A bigger area needs a bigger budget to
              work.
            </Feedback>
          )}

          {error && (
            <p className="mt-5 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
              {error}
            </p>
          )}

          <Continue onClick={generate} disabled={loading || budget === 0}>
            {loading ? 'Writing your ad…' : 'Make my ad'}
          </Continue>
        </>
      )}
    </StepShell>
  );
}
