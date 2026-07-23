# Product Photo AI

Two apps in this repo, sharing one backend:
- `app/` — the original native Android app (Kotlin/Compose): free
  background removal (`rembg`), Backdrop Select, classical Upscale. Fully
  working today.
- `mobile/` — a new Flutter "Product Photo Studio" app: paid AI-generated
  studio backdrops via fal.ai (BiRefNet removal + FLUX.1 dev inpainting).
  Early — one screen, no auth/credits/payments yet. See `mobile/README.md`
  for exactly what's built vs. not.

Neither replaces the other automatically — `app/` keeps working as-is.

## Structure

- `app/` — native Android app (Kotlin, Jetpack Compose, Retrofit, Coil).
- `mobile/` — Flutter studio app (Dart, `http`, `image_picker`). See
  `mobile/README.md`.
- `backend/` — FastAPI service, two endpoint groups: the free `rembg`/
  classical-upscale ones `app/` uses, and the paid fal.ai-backed `/ai/*`
  ones `mobile/` uses. See `backend/README.md`.
- `store-listing.md` — Play Store listing copy (for `app/`).

## Background Removal and Photo Upscale: both need the backend

Both features are network calls to the FastAPI backend — see
`backend/README.md` for running/deploying it. The app is built with a
default `BACKEND_BASE_URL` pointed at a hosted Render.com deployment
(`https://product-photo-backend.onrender.com/`), so a stock debug/release
build works on a real phone with no extra setup. Backdrop Select (swapping
in a solid/gradient backdrop behind the cut-out subject) is the one feature
that runs entirely on-device
(`app/src/main/java/com/productphoto/ai/util/BackdropCompositor.kt`), since
it's just Canvas compositing once the background has already been removed.

## Running it

1. Backend: already hosted at `https://product-photo-backend.onrender.com/`
   (Render.com free tier — see `backend/README.md` for redeploying your own).
2. App: open the project root in Android Studio, let Gradle sync, run the
   `app` module on an emulator or device. Both features work immediately
   against the hosted backend — no local server needed.

`gradle/wrapper/gradle-wrapper.jar` is intentionally **not** committed to
this repo (see `.gitignore`) — it can only be produced correctly by
downloading it from Gradle's own distribution, which the sandbox this
project was scaffolded in couldn't reach. Opening in Android Studio doesn't
need it (Studio manages its own Gradle). To use `./gradlew` directly instead:

```bash
gradle wrapper --gradle-version 8.7
```

(needs any local Gradle install once, to bootstrap it). CI doesn't need this
file at all — see below.

## Getting an installable APK without Android Studio

**Easiest: the Releases page.** Every push to `main` publishes/updates a
`latest` GitHub Release with the current debug APK attached — repo →
**Releases** (sidebar) → download `app-debug.apk` from the "Latest debug
build" release. Same permanent link every time, no digging through Actions
runs, no login required, no 14-day expiry. **Both features work out of the
box on this build** — it talks to the hosted Render backend by default.

Render's free tier sleeps after 15 minutes of no traffic; the first request
after that takes ~50s to wake it back up (cold start) — not a bug, just
retry or wait.

**Or, for a one-off custom build** (e.g. to point at your own backend, or a
PR's build): every push and PR also triggers
`.github/workflows/build-debug-apk.yml`, which attaches the APK as a
workflow artifact (14-day expiry). GitHub repo → **Actions** tab → the run
you want → download `product-photo-ai-debug` under **Artifacts**, unzip, and
install the `.apk` on a device (enable "install unknown apps" for whichever
app you use to open it). To point it at a different backend: **Actions**
tab → "Build Debug APK" → **Run workflow** → fill in `backend_url`.

This is still an unsigned debug build, not a Play Store release — see
"Releasing" below.

## Releasing to the Play Store (not done yet)

Merging code and building a debug APK are not the same as a store release.
Still needed:
- A signing keystore + a release build signed with it.
- The backend on a production-grade host (Render's free tier sleeps when
  idle and is fine for testing, but isn't meant for real user traffic).
- A Google Play Console account, the store listing (`store-listing.md` as a
  starting point), a real privacy policy URL, content rating, and the data
  safety form.
- Upload to an internal testing track first, then production, and wait for
  Google's review.

## Status

**`app/` (native Android)**: Background Removal, Backdrop Select, and Photo
Upscale are wired end-to-end and working.

**`mobile/` (Flutter studio app)**: a Photoroom-style bottom nav (Home / AI
tools / Batch / Content). Home's studio flow covers 4 of the 5 original
spec features end-to-end: Background Removal, AI Studio Backdrop
generation, AI Upscale, and AI Shadows/Virtual Try-On (product shadows +
model fitting), plus a full photo editor. Not yet built: Firebase auth,
credits, payments, and the Batch/Content tabs (both show honest "Coming
soon" placeholders) — see `mobile/README.md`. This Dart code has never been
run on a real device (no Flutter SDK in the sandbox it was written in) —
CI compiles it on every push, but on-device behavior of the AI features
still needs verifying once `FAL_KEY` is set and the fal.ai model IDs are
confirmed against fal.ai's own catalog (see `backend/README.md`).

See `CLAUDE.md` for the gstack skill workflow this project uses, and
`store-listing.md` for `app/`'s target feature set.
