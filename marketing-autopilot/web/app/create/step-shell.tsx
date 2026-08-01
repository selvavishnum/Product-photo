'use client';

/**
 * The frame every question in the wizard sits in.
 *
 * One question per screen, following the pattern these flows converge on for
 * good reason: a shop owner filling this in on a phone between customers can
 * hold one decision in their head, not seven. A long form gets abandoned in
 * the middle; a sequence of single choices gets finished.
 *
 * Everything visual lives here so the questions themselves stay a list of
 * content, and so the flow cannot drift screen by screen.
 */

import type { ReactNode } from 'react';

export function StepShell({
  step,
  total,
  onBack,
  children,
}: {
  step: number;
  total: number;
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-8">
      <header className="flex items-center gap-3 py-4">
        <button
          type="button"
          onClick={onBack}
          disabled={!onBack}
          aria-label="Back"
          className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-xl text-ink transition disabled:opacity-25"
        >
          ‹
        </button>
        <span className="font-display text-base font-bold">Ad Auto-Pilot</span>
      </header>

      {/* Segmented rather than one continuous bar: discrete marks read as
          "this many left", which a percentage does not. */}
      <div
        className="mb-8 flex gap-1.5"
        role="progressbar"
        aria-valuenow={step}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label={`Step ${step} of ${total}`}
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < step ? 'bg-ink' : 'bg-line'
            }`}
          />
        ))}
      </div>

      <div className="flex-1">{children}</div>
    </div>
  );
}

export function Question({
  title,
  tamil,
  children,
}: {
  title: string;
  tamil?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-7">
      <h1 className="text-3xl font-extrabold leading-tight tracking-tight">
        {title}
      </h1>
      {tamil && <p className="mt-2 text-lg text-muted">{tamil}</p>}
      {children && <p className="mt-3 text-sm text-muted">{children}</p>}
    </div>
  );
}

/** A radio row: label left, control right, whole row tappable. */
export function Choice({
  label,
  hint,
  selected,
  onSelect,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-5 py-4 text-left transition ${
        selected
          ? 'border-line-strong bg-surface'
          : 'border-line hover:border-faint'
      }`}
    >
      <span>
        <span className="block font-semibold">{label}</span>
        {hint && <span className="text-sm text-muted">{hint}</span>}
      </span>
      <span
        aria-hidden
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
          selected ? 'border-ink' : 'border-line'
        }`}
      >
        {selected && <span className="h-3 w-3 rounded-full bg-ink" />}
      </span>
    </button>
  );
}

/**
 * The tinted line that appears once an answer is picked.
 *
 * It is not decoration: it tells the owner what their choice will actually
 * cause, at the moment they make it, instead of leaving them to find out two
 * screens later.
 */
export function Feedback({ children }: { children: ReactNode }) {
  return (
    <p className="mt-5 rounded-2xl border border-brand/20 bg-brand-soft px-5 py-4 text-sm text-ink/80">
      {children}
    </p>
  );
}

export function Continue({
  onClick,
  disabled,
  children = 'Continue',
}: {
  onClick: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-8 flex w-full items-center justify-center gap-3 rounded-full bg-ink px-6 py-4 text-base font-semibold text-white transition hover:opacity-85 disabled:opacity-25"
    >
      {children}
      <span aria-hidden>→</span>
    </button>
  );
}

export const inputClass =
  'w-full rounded-2xl border border-line bg-surface px-5 py-4 text-ink placeholder:text-faint focus:border-line-strong focus:outline-none';
