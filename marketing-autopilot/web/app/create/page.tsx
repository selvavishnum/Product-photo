'use client';

import Link from 'next/link';
import { useState } from 'react';

import WarmApi from '../warm-api';

/**
 * The campaign wizard.
 *
 * Designed for shop owners, not marketers, so the whole flow is three
 * screens with one decision each. Deliberate choices:
 *
 *  - **Budget is preset chips, not a number field.** "How much per day?" as a
 *    free input asks someone to guess a number they have no basis for, and
 *    it is the step where people abandon. Three amounts with a plain-language
 *    consequence is a decision they can actually make.
 *  - **No advertising vocabulary.** No objective, optimisation goal, bid
 *    strategy, CPM or impressions anywhere. Those are chosen server-side.
 *  - **Tamil sits alongside English** rather than behind a language toggle,
 *    because the person reading it may be more comfortable in either and
 *    should not have to find a setting first.
 *  - **One primary button per screen.** Back is present but quiet.
 */

type Step = 1 | 2 | 3;

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

const BUDGETS = [
  { inr: 150, label: 'Small', hint: 'Try it out for a few days' },
  { inr: 300, label: 'Steady', hint: 'Most local shops start here' },
  { inr: 600, label: 'Push', hint: 'Festival or opening week' },
];

export default function CreatePage() {
  const [step, setStep] = useState<Step>(1);

  const [businessName, setBusinessName] = useState('');
  const [businessCategory, setBusinessCategory] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [language, setLanguage] = useState('TAMIL');
  const [budget, setBudget] = useState(300);
  const [image, setImage] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);

  const step1Valid =
    businessName.trim().length > 0 &&
    businessCategory.trim().length > 0 &&
    description.trim().length >= 10;

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

      const res = await fetch('/api/v1/ad/generate', {
        method: 'POST',
        body: form,
      });
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
      setStep(3);
    } catch {
      setError('Could not reach the server. Check your connection.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-5 pt-6 pb-24">
      {/* Backstop for arriving here directly, without passing the landing
          page's warm-up. Mounting it twice is harmless -- the second fetch
          hits an API that is already awake. */}
      <WarmApi />

      <header className="mb-7 flex items-center justify-between">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
          ← Back
        </Link>
        <Progress step={step} />
      </header>

      {step === 1 && (
        <section>
          <H1>Tell us about your shop</H1>
          <Sub>உங்கள் கடையைப் பற்றி சொல்லுங்கள்</Sub>

          <Field label="Shop name" tamil="கடையின் பெயர்">
            <input
              className={inputClass}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Sri Lakshmi Jewellers"
            />
          </Field>

          <Field label="What do you sell?" tamil="என்ன விற்கிறீர்கள்?">
            <input
              className={inputClass}
              value={businessCategory}
              onChange={(e) => setBusinessCategory(e.target.value)}
              placeholder="Jewellery shop"
            />
          </Field>

          <Field
            label="What do you want to advertise?"
            tamil="எதை விளம்பரப்படுத்த வேண்டும்?"
          >
            <textarea
              className={`${inputClass} min-h-28`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Bridal sets and daily-wear gold chains. We want more customers for the wedding season."
            />
            <Hint>
              {description.trim().length < 10
                ? 'A sentence or two is enough.'
                : 'Good — the more detail, the better the ad.'}
            </Hint>
          </Field>

          <Field label="Town or city" tamil="ஊர்" optional>
            <input
              className={inputClass}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Thuckalay"
            />
            <Hint>Helps us advertise only to people nearby.</Hint>
          </Field>

          <Field label="Product photo" tamil="பொருள் புகைப்படம்" optional>
            <input
              className={inputClass}
              type="file"
              accept="image/*"
              onChange={(e) => setImage(e.target.files?.[0] ?? null)}
            />
          </Field>

          <Primary disabled={!step1Valid} onClick={() => setStep(2)}>
            Next
          </Primary>
          {!step1Valid && (
            <Hint center>Fill in the first three to continue.</Hint>
          )}
        </section>
      )}

      {step === 2 && (
        <section>
          <H1>How much per day?</H1>
          <Sub>ஒரு நாளைக்கு எவ்வளவு?</Sub>

          <div className="mt-6 grid gap-3">
            {BUDGETS.map((b) => (
              <button
                key={b.inr}
                type="button"
                onClick={() => setBudget(b.inr)}
                className={`flex items-center justify-between rounded-2xl border p-5 text-left transition ${
                  budget === b.inr
                    ? 'border-brand bg-brand-soft/30'
                    : 'border-line bg-surface/50 hover:border-slate-600'
                }`}
              >
                <span>
                  <span className="block font-semibold">₹{b.inr} / day</span>
                  <span className="text-sm text-slate-400">{b.hint}</span>
                </span>
                <span className="text-sm text-slate-500">{b.label}</span>
              </button>
            ))}
          </div>

          <Field label="Ad language" tamil="விளம்பர மொழி">
            <select
              className={inputClass}
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="TAMIL">தமிழ் / Tamil</option>
              <option value="TANGLISH">Tanglish</option>
              <option value="ENGLISH">English</option>
            </select>
          </Field>

          {error && <ErrorBox>{error}</ErrorBox>}

          <Primary disabled={loading} onClick={generate}>
            {loading ? 'Writing your ad…' : 'Make my ad'}
          </Primary>
          <button
            type="button"
            onClick={() => setStep(1)}
            className="mt-3 w-full text-sm text-slate-500 hover:text-slate-300"
          >
            Back
          </button>
        </section>
      )}

      {step === 3 && result && (
        <section>
          <H1>Here is your ad</H1>
          <Sub>உங்கள் விளம்பரம் தயார்</Sub>

          {result.plan.copies.map((c, i) => (
            <article
              key={i}
              className="mt-5 rounded-2xl border border-line bg-surface/60 p-5"
            >
              <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                {c.language}
              </p>
              <h3 className="text-lg font-semibold">{c.headline}</h3>
              <p className="mt-2 text-slate-300">{c.primaryText}</p>
              <span className="mt-4 inline-block rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white">
                {c.cta}
              </span>
            </article>
          ))}

          <div className="mt-5 rounded-2xl border border-line bg-surface/40 p-5">
            <h3 className="font-semibold">Who will see this</h3>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">Age</dt>
              <dd>
                {result.plan.targeting.ageMin}–{result.plan.targeting.ageMax}
              </dd>
              <dt className="text-slate-500">Area</dt>
              <dd>
                {result.plan.targeting.locationName} ·{' '}
                {result.plan.targeting.locationRadiusKm} km around you
              </dd>
              <dt className="text-slate-500">Budget</dt>
              <dd>₹{result.input.dailyBudgetInr} per day</dd>
            </dl>
            <p className="mt-3 text-sm text-slate-400">
              {result.plan.targeting.rationale}
            </p>
          </div>

          {/* Honest about the current state: publishing needs a connected Meta
              account, which is not built yet. Better a plain sentence than a
              button that fails. */}
          <div className="mt-5 rounded-2xl border border-amber-900/50 bg-amber-950/30 p-4 text-sm text-amber-200">
            Nothing has been published. To put this live you need your own
            Facebook ad account connected — that step is coming next.
          </div>

          <button
            type="button"
            onClick={() => {
              setResult(null);
              setStep(1);
            }}
            className="mt-6 w-full rounded-2xl border border-line py-3 text-slate-300 hover:border-slate-600"
          >
            Start another
          </button>
        </section>
      )}
    </main>
  );
}

/* ---------- small presentational pieces ---------- */

const inputClass =
  'w-full rounded-xl border border-line bg-surface px-4 py-3 text-slate-100 placeholder:text-slate-600 focus:border-brand focus:outline-none';

function H1({ children }: { children: React.ReactNode }) {
  return <h1 className="text-2xl font-bold tracking-tight">{children}</h1>;
}

function Sub({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-slate-500">{children}</p>;
}

function Field({
  label,
  tamil,
  optional,
  children,
}: {
  label: string;
  tamil: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-6 block">
      <span className="mb-1.5 block text-sm font-medium">
        {label}{' '}
        <span className="font-normal text-slate-500">· {tamil}</span>
        {optional && (
          <span className="ml-1 text-xs text-slate-600">(optional)</span>
        )}
      </span>
      {children}
    </label>
  );
}

function Hint({
  children,
  center,
}: {
  children: React.ReactNode;
  center?: boolean;
}) {
  return (
    <p className={`mt-1.5 text-xs text-slate-500 ${center ? 'text-center' : ''}`}>
      {children}
    </p>
  );
}

function Primary({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // Indigo into cyan, the two brand accents. The gradient is confined to
      // the one primary action per screen: used on every button it would stop
      // signalling which one to press, which is the whole job of a primary.
      className="mt-8 w-full rounded-2xl bg-gradient-to-r from-brand to-accent py-4 text-lg font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:from-brand disabled:to-brand disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-5 rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
      {children}
    </p>
  );
}

function Progress({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Step ${step} of 3`}>
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={`h-1.5 w-8 rounded-full ${
            n <= step ? 'bg-brand' : 'bg-line'
          }`}
        />
      ))}
    </div>
  );
}
