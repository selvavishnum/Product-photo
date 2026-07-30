# Ad Auto-Pilot — web front end

Next.js 16 (App Router) front end: a landing page and a three-step campaign
wizard. Talks to the Express API in `../` through a same-origin rewrite, so
the browser never sees the API's address and there is no CORS to configure.

## Where it runs

- **This front end: Vercel.** Both pages prerender to static HTML and are
  served from the CDN, so there is no cold start.
- **The API: Render** (`../../render.yaml`). Free plan, so it stops after 15
  minutes idle and takes roughly 50 seconds to boot again.

That split is the reason for `app/warm-api.tsx`: the page appears instantly
but the API behind it may be asleep, so the app pings `/api/warmup` on mount
and spends the boot against time the user is already using — reading the
landing page, then filling in the form.

## Deploying to Vercel

1. Vercel dashboard → **Add New** → **Project** → import this repo.
2. **Root Directory: `marketing-autopilot/web`.** This is the setting that
   matters most. The repo has several `package.json` files, and pointing
   Vercel at the repo root makes it build the wrong thing.
3. Framework preset should auto-detect as **Next.js**. Leave the build and
   install commands alone.
4. **Environment Variables** → add:

   | Name | Value |
   |---|---|
   | `API_ORIGIN` | `https://<your-api>.onrender.com` |

   Take the value from Render → `adpilot-api` → the URL at the top of the
   service page. A bare hostname works too — `next.config.ts` adds the
   scheme — but the full URL is clearer.
5. Deploy.

### `API_ORIGIN` is read at build time, not at runtime

`rewrites()` in `next.config.ts` is evaluated during `next build` and
serialised into `.next/routes-manifest.json`. Verified, not assumed:

```
$ API_ORIGIN=adpilot-api.onrender.com npx next build
$ jq '.rewrites.afterFiles' .next/routes-manifest.json
[
  { "source": "/api/warmup",  "destination": "https://adpilot-api.onrender.com/health" },
  { "source": "/api/:path*",  "destination": "https://adpilot-api.onrender.com/api/:path*" }
]
```

So **changing `API_ORIGIN` in the Vercel dashboard does nothing until you
redeploy.** If the wizard returns "Could not reach the server" after you have
fixed the variable, that is why.

Forgetting the variable entirely is worse than an error: the build falls back
to `http://localhost:8080` and deploys happily, and the site only fails when
someone presses "Make my ad".

## Running locally

```bash
npm install
API_ORIGIN=http://localhost:8080 npm run dev   # with the API running in ../
```

`API_ORIGIN` defaults to `http://localhost:8080`, which matches the API's
default port, so plain `npm run dev` works if the API is running locally.

## Structure

```
web/
├── app/
│   ├── layout.tsx        # Shell, fonts, metadata
│   ├── page.tsx          # Landing page (server component)
│   ├── create/page.tsx   # The three-step wizard (client component)
│   ├── warm-api.tsx      # Wakes the API in the background, renders nothing
│   └── globals.css       # Tailwind v4 theme (CSS-first, no config file)
└── next.config.ts        # /api/* rewrite to the Express API
```

Tailwind v4 is configured in CSS via `@theme` in `globals.css` — there is
deliberately no `tailwind.config.js`.

## Known gaps

There is **no authentication**. Anyone who has the URL can spend Gemini
quota through it. `MAX_DAILY_BUDGET_INR` caps what a campaign can request but
does not cap how many times the generate endpoint can be called. Treat a
public deploy as a demo, and put auth in front of it before it is anything
more than that.
