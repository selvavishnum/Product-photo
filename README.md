# Product Photo AI

Marketplace-ready product photos from a phone, plus an ad-campaign tool for
the same shops.

## Structure

- `mobile/` — **Product Photo Studio**, the Flutter app (Android now, iOS
  later). Background removal, studio backdrops and photo editing run
  entirely on the device. See `mobile/README.md`.
- `backend/` — FastAPI service. Free endpoints (`rembg` background removal,
  classical Lanczos upscale, drop shadows) plus paid fal.ai-backed `/ai/*`
  ones. See `backend/README.md`.
- `gpu-backend/` — self-hosted GPU variant of the same AI endpoints.
- `marketing-autopilot/` — Ad Auto-Pilot: an Express/Prisma API and a
  Next.js front end that write Tamil/English ad copy, pick targeting and
  render 1080×1080 ad banners. Deployed via `render.yaml`.
- `store-listing.md` — Play Store listing copy, a starting point for
  publishing `mobile/`.

The native Android app (`app/`, Kotlin/Compose) used to live here and has
been removed — see "Why the native app is gone" below.

## Background removal runs on the phone

The whole cutout pipeline is on-device (`mobile/lib/ondevice/`): Google ML
Kit Subject Segmentation where Play Services provides it, falling back to a
bundled u2netp ONNX model (4.4 MB, shipped in the APK) everywhere else —
including a fresh install before ML Kit's model has downloaded, and on iOS
where the ML Kit plugin is only a stub. Alpha is then refined with a guided
filter and the foreground decontaminated before framing to Amazon
(1600px, product at 85%), Flipkart or Studio presets.

That means it is free per image, works with no signal, and no photo leaves
the phone. See `mobile/docs/on-device-architecture.md`.

The five studio backdrops are procedural too — gradients, spotlight and
reflection composited on-device, no model and no network.

## What still needs the backend

- **AI Shadows** — free, classical, but computed server-side.
- **AI Studio Backdrop**, **AI Upscale**, **Virtual Try-On** — paid, via
  fal.ai. These need `FAL_KEY` set on the backend and credit on the
  account; without it they return `403 Exhausted balance`.

The backend is hosted at `https://product-photo-backend.onrender.com/`
(Render free tier — it sleeps after 15 minutes idle, so the first request
after that takes ~50s to wake up; the app retries with backoff).

## Getting an installable APK

**Easiest: the Releases page.** Every push to `main` publishes/updates the
`studio-latest` GitHub Release with the current debug APK attached — repo →
**Releases** → download `app-debug.apk` from "Latest Product Photo Studio
debug build". The on-device features work immediately on this build with
nothing configured.

**For a one-off custom build** (e.g. pointed at your own backend): every
push and PR touching `mobile/**` runs
`.github/workflows/build-flutter-apk.yml` and attaches the APK as a
workflow artifact (14-day expiry). **Actions** tab → "Build Flutter Debug
APK" → **Run workflow** → fill in `backend_url`.

`mobile/` commits only Dart source; the `android/` platform folder is
generated in CI by `flutter create`, so there is no Gradle wrapper to
maintain in this repo.

These are unsigned debug builds, not Play Store releases.

## Releasing to the Play Store (not done yet)

- A signing keystore and a release build signed with it.
- The backend on a production-grade host (Render's free tier sleeps when
  idle — fine for testing, not for real traffic).
- A Play Console account, the store listing (`store-listing.md` as a
  starting point), a privacy policy URL, content rating and the data safety
  form.
- Internal testing track first, then production, then Google's review.

## Status

**Working and verified on a real device**: White background (on-device
cutout → white/Amazon/Flipkart/Studio framing), the five procedural studio
backdrops, and the photo editor (crop/rotate, filters, tune, blur, paint,
text, stickers).

**Working, needs the backend**: AI Shadows.

**Blocked on fal.ai credit**: AI Studio Backdrop, AI Upscale, Virtual
Try-On.

**Not built**: Firebase auth, credits, payments, and the Batch and Content
tabs (both show honest "Coming soon" placeholders).

`marketing-autopilot/` has its own status section in
`marketing-autopilot/README.md` — note it currently has **no
authentication** and must not be exposed publicly as-is.

## Why the native app is gone

`app/` was the original Kotlin/Compose Android app: background removal and
upscale over the network via `backend/`, on-device Backdrop Select, and AI
Upscale via fal.ai. It was deleted because everything it did is covered by
`mobile/` and covered better:

- Its background removal required the backend; the Flutter app's runs on
  the phone's own CPU, which was the point of the feature.
- Its one unique feature, AI Upscale, was already broken on an exhausted
  fal.ai balance.
- It was Android-only; `mobile/` builds for iOS from the same source.
- Its CI workflow had no paths filter, so it rebuilt on every PR in the
  repo, and its `latest` release tag outranked the Flutter APK on the
  Releases page.

See `CLAUDE.md` for the gstack skill workflow this project uses.
