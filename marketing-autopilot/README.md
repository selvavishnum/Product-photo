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
| Meta / Google campaign submission | **not built** — see above |
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
