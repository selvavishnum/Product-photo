# Ad Auto-Pilot

AI marketing assistant for small local businesses. Describe your shop, get a
target audience and ad copy in Tamil / Tanglish / English.

Node 20+, TypeScript, Express 5, Prisma 7 + PostgreSQL, Zod 4, Gemini or
OpenAI. A plain HTML/JS front end is served from `public/`.

## Read this before planning a launch date

**Both ad platforms gate live spending behind approval that takes weeks.**
This is the critical-path item, not the code:

- **Meta Marketing API** — needs a Business Portfolio, **Business
  Verification** (company documents), and **App Review** for
  `ads_management`. Until then your app can only touch ad accounts you
  personally admin, in development mode.
- **Google Ads API** — needs a **developer token**. New tokens start at *Test*
  access, which only works against test accounts that cannot spend money.
  *Basic* access requires an application describing your tool and its
  compliance with their policies.

**Start both applications now**, in parallel with building. The generation
side of this app (this repo, today) works without either.

## What is built

| Piece | Status |
|---|---|
| TypeScript project, strict mode, env validated at boot | done |
| Prisma schema: User, AdAccountConnection, Campaign, AdCreative | done |
| `POST /api/v1/ad/generate` — targeting + multilingual copy | done |
| Encrypted-at-rest OAuth token storage (AES-256-GCM) | helper done, OAuth flow not built |
| Web UI | done |
| Meta publish workflow (`services/metaAds.ts`) | code done, **untested against live API** |
| Google Ads submission | **not built** |
| Redis/BullMQ queue | dependency added, no workers yet |
| Auth | **not built** — no login; do not deploy publicly as-is |

## Design decisions worth knowing

**Generation cannot spend money.** `/generate` only proposes — it never
creates a campaign or calls an ad platform. Publishing will be a separate,
explicitly confirmed step. An endpoint that both generates *and* launches
turns an accidental double-click into real budget.

**The daily budget ceiling is server-side.** `MAX_DAILY_BUDGET_INR` is applied
from env, not from the request, so a client cannot raise its own limit.

**Money is stored as integer paise**, never floats. Budgets get multiplied by
days; float rounding error compounds.

**Tokens are encrypted before they reach the database.** Ad tokens authorise
spending real money, so plaintext storage is the worst failure mode in the
product. AES-256-GCM (authenticated) — a tampered ciphertext fails to decrypt
rather than silently yielding garbage that gets sent to Meta as a bearer
token.

**LLM output is validated against a Zod schema.** The JSON Schema is also
passed to the provider to constrain generation, but structured output reduces
malformed responses rather than eliminating them, so it is checked again on
arrival. Anything that fails validation never reaches the database.

**Targeting is JSON, not columns.** Meta's and Google's targeting shapes
differ and change often; columns would mean a migration each time either
platform adds a field.

**The prompt forbids invented claims.** No prices, discounts, guarantees or
delivery promises that the owner did not state. This copy runs as a real
advert, and a false claim is the shop owner's legal liability.

## Run it

```bash
cp .env.example .env
# Required: DATABASE_URL, GEMINI_API_KEY, TOKEN_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # -> TOKEN_ENCRYPTION_KEY

npm install
npx prisma migrate dev --name init
npm run dev
```

Open <http://localhost:8080>.

`docker compose up -d` for Postgres and Redis if you do not have them locally:

```yaml
services:
  db:
    image: postgres:17
    environment: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: autopilot }
    ports: ["5432:5432"]
  redis:
    image: redis:7
    ports: ["6379:6379"]
```

## API

### `POST /api/v1/ad/generate`

JSON, or `multipart/form-data` when attaching an image.

| Field | Required | Notes |
|---|---|---|
| `businessName` | yes | |
| `businessCategory` | yes | |
| `description` | yes | 10–4000 chars; a voice-note transcript works |
| `city` | no | improves radius targeting a lot |
| `language` | no | `TAMIL` (default) / `TANGLISH` / `ENGLISH` |
| `dailyBudgetInr` | yes | capped by `MAX_DAILY_BUDGET_INR` |
| `image` | no | file upload, ≤10MB |

Returns `{ plan: { targeting, copies }, input, status: "DRAFT", note }`.

Errors are `{ error: { code, message, details? } }` with codes `BAD_REQUEST`,
`UPSTREAM_FAILED`, `INVALID_MODEL_OUTPUT`, `INTERNAL`.

## Cost

Gemini Flash or GPT-4o-mini are cents per thousand generations — this is not
where the money goes. **The ad spend is**, and it is the user's money moving
through your software. Ship the spend cap, the confirmation step and the audit
trail before you ship the launch button.

## Next

1. Auth (nothing is protected right now).
2. Meta OAuth + `AdAccountConnection` write path, using `lib/crypto.ts`.
3. `POST /api/v1/campaign/:id/publish` — explicit, confirmed, audited.
4. BullMQ workers for metric sync into `AdCreative`.
5. Poster generation — the on-device pipeline in `../mobile` already does
   cutouts and studio backgrounds for free.

## Ad banner rendering

`src/services/poster.ts` assembles a 1080×1080 Instagram feed banner:
gradient background, product centred, headline top, CTA pill bottom, optional
logo. **~150ms per banner**, no diffusion model.

### Sharp, not node-canvas — this is the important bit

Tamil is a complex script: it needs ligature formation and combining-mark
positioning. Sharp composites SVG through **librsvg → Pango → HarfBuzz**, which
shapes Tamil correctly. **node-canvas draws through Cairo's "toy" text API,
which has no complex-script shaping** — Tamil comes out as disconnected glyphs
in the wrong order.

Verified by rendering `ஸ்ரீ லக்ஷ்மி நகைக்கடை` and inspecting the output: the
`ஸ்ரீ` and `க்ஷ்` ligatures form correctly.

**The font must be installed on the host.** Without it you get tofu boxes, not
an error:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-noto-core fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
```

### Layout notes

- **Product placement is computed from the headline height**, not fixed. A
  three-line Tamil headline is much taller than a one-line English one; with a
  fixed position the tall case overlaps the product.
- **A scrim is composited over the product, under the text.** Without it, a
  pale product behind white headline text is unreadable — the most common way
  an auto-generated banner fails.
- **Text width is measured, not estimated.** Tamil's advance ratio ranges
  0.62–0.78 of the font size depending on combining marks — a 25% spread, and
  a fixed constant clipped headlines at both edges and overflowed the CTA
  pill. Each string is rendered once at 24px and scaled (width is linear in
  font size, verified to 0.1%), costing ~21ms.
- **The headline auto-shrinks** (82px → 34px) until it fits three lines *and*
  the widest line fits the margins.
- **All user text is XML-escaped.** SVG is XML; an unescaped `&` breaks the
  document.

### Storage

`src/services/storage.ts` uploads to any S3-compatible bucket. **Cloudflare R2
is the default** — no egress fees, which matters because ad platforms refetch
these images repeatedly. Object keys include a content hash, so identical
inputs overwrite rather than accumulate, and URLs are cacheable forever.

### Worker

```bash
npm run worker   # BullMQ consumer for the `poster` queue
```

Queued rather than inline: the render is ~150ms but the upload is
unpredictable, and a user clicking "generate" should not hold a connection
open for it. Concurrency 4 — each job holds a full-size bitmap, so raise it
only alongside the memory limit.


## Meta publishing (`src/services/metaAds.ts`)

`publishMetaAdCampaign()` does campaign → ad set → image → creative → ad in one
call. Enum values were read from the installed SDK (v24 / Graph v24.0), not
recalled.

### Prerequisites that are not code

- **A Facebook Page.** A creative's `object_story_spec` requires `page_id`.
  There is no way to run an ad without a Page.
- **App Review for `ads_management` + Business Verification.** Before that,
  your token only works on ad accounts you personally admin.
- **A WhatsApp number connected to the Page** if you use `WHATSAPP_MESSAGE`.

### Safety defaults

- **Campaigns are created PAUSED** unless `activate: true` is passed
  explicitly. Creating ACTIVE starts spending immediately.
- **The token is validated first** — an expired token otherwise surfaces
  halfway through, after a campaign already exists.
- **Partial failures roll back.** Everything created is tracked and deleted on
  error. A half-built campaign is worse than none: invisible in our database,
  visible in Ads Manager, and activatable by accident.
- **Budget is passed as minor units** (paise), matching what the schema stores.

### Policy rejection is asynchronous — the important caveat

`publishMetaAdCampaign()` returning successfully means **accepted for review**,
not approved. Ads enter `PENDING_REVIEW` and the verdict lands minutes to hours
later.

So policy handling has two halves:

1. **Synchronous** — some violations are rejected at creation. `MetaApiError`
   carries `isPolicy`, plus Meta's `error_user_msg` / `error_user_title`
   (the text Meta intends the advertiser to read) and `fbtrace_id` for support.
2. **Asynchronous** — `checkAdPolicyStatus(token, adId)` re-reads
   `effective_status` and `ad_review_feedback`. Poll it from a scheduled job.
   An ad that publishes cleanly can still be `DISAPPROVED` an hour later.

### Objective → delivery pairing

Meta validates the combination and rejects mismatches, so it is a lookup table
rather than assembled at the call site:

| Objective | CTA | optimization_goal | destination_type |
|---|---|---|---|
| OUTCOME_TRAFFIC | any | LINK_CLICKS | — |
| OUTCOME_LEADS | WHATSAPP_MESSAGE | CONVERSATIONS | WHATSAPP |
| OUTCOME_LEADS | CALL_NOW | QUALITY_CALL | PHONE_CALL |

Also: `standard_enhancements` is set to `OPT_OUT`, so Meta does not silently
crop or restyle the poster — which would wreck carefully laid-out Tamil text.

**Not yet tested against the live API.** It typechecks and every enum resolves
against the installed SDK, but no call has been made to Meta.
