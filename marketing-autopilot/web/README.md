# Ad Auto-Pilot — web app

Next.js 16 (App Router): a landing page, a three-step campaign wizard, and
the ad-generation endpoint they call.

**This deploys as one thing.** There is no separate API service behind it.

## Deploying to Vercel

1. Vercel dashboard → **Add New** → **Project** → import this repo.
2. **Root Directory: `marketing-autopilot/web`.**

   This is the setting that matters most and the one that causes
   `404: NOT_FOUND` on every path. The repo has several `package.json` files
   and no app at its root, so pointing Vercel at the repo root builds
   something with no pages in it — which deploys successfully and then 404s.
3. Framework preset should auto-detect as **Next.js**. Leave the build and
   install commands alone.
4. **Environment Variables:**

   | Name | Required | Value |
   |---|---|---|
   | `GEMINI_API_KEY` | **yes** | Your key from [Google AI Studio](https://aistudio.google.com/apikey) |
   | `GEMINI_MODEL` | no | Defaults to `gemini-flash-latest` |
   | `MAX_DAILY_BUDGET_INR` | no | Defaults to `5000` |

   Add them to **Production, Preview and Development**. Setting a variable on
   Preview only means it goes missing the moment you merge to `main`.
5. Deploy.

That is the whole list. `API_ORIGIN` is gone — it existed to point at a
separate Express service, and there isn't one any more.

## Why there is no separate API

`/api/v1/ad/generate` only calls Gemini. No image processing, no database, no
ad platform — so there is nothing it needs that a serverless function cannot
provide. Running it here means one deploy, one place to set the API key, and
no cold-start wait from a sleeping free-tier backend.

The Express app in `../` is still where **poster rendering** (Sharp, and Tamil
text shaped through librsvg/Pango) and **Meta publishing** live. Those do need
a long-lived server with system fonts installed, and get deployed separately
when they are wired up. Until then, a rewrite pointing at a service that may
not exist is a failure waiting to happen, not future-proofing.

## Running locally

```bash
npm install
GEMINI_API_KEY=... npm run dev
```

Without the key the wizard reaches step 3 and returns
`500 GEMINI_API_KEY is not set on the server` — deliberately a 500, since the
caller did nothing wrong.

## Structure

```
web/
├── app/
│   ├── layout.tsx                    # Shell, fonts, metadata
│   ├── page.tsx                      # Landing page
│   ├── create/page.tsx               # Three-step wizard
│   ├── api/v1/ad/generate/route.ts   # The endpoint the wizard calls
│   └── globals.css                   # Tailwind v4 theme (@theme, no config file)
├── lib/adPlan.ts                     # Gemini call, prompt and output schema
└── next.config.ts
```

`lib/adPlan.ts` is a deliberate port of `../src/services/adCopy.ts`, not an
import of it: that file belongs to a separate npm package with its own build,
its own Prisma client and a `config/env.ts` that throws at import time, none
of which this route needs. **If the prompt or the schema changes, change it in
both places.**

Tailwind v4 is configured in CSS via `@theme` in `globals.css` — there is
deliberately no `tailwind.config.js`.

## Known gaps

There is **no authentication**. Anyone with the URL can spend your Gemini
quota. `MAX_DAILY_BUDGET_INR` caps what a single campaign may request; it does
not cap how many times the endpoint can be called. Treat a public deploy as a
demo and put auth in front of it before it is anything more than that.

Nothing is ever published to an ad platform from here. The endpoint only
proposes a plan — publishing is a separate, explicitly-confirmed step that is
not built yet.
