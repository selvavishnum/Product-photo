# Product Photo Studio — Flutter app

Cross-platform (Android now, iOS later) frontend for the AI studio features:
background removal (BiRefNet via fal.ai) and AI studio backdrop generation
(FLUX.1 dev inpainting via fal.ai). Talks to the `/ai/*` endpoints in
`../backend`.

**This is a separate app from `../app` (the existing native Android app).**
`../app` keeps working as-is (backend-based background removal via free
`rembg`, Backdrop Select, classical Upscale) — nothing here replaces it
automatically. This is the start of the Flutter rewrite; cutting over is a
separate decision for later.

## What's here vs. what's not

Delivered in this folder: the main studio screen (pick photo → remove
background → pick a theme or type a custom prompt → generate studio
backdrop → preview), an "AI Upscale (paid)" option on the result, and a
full photo editor ([`pro_image_editor`](https://pub.dev/packages/pro_image_editor):
crop/rotate, filters, tune/adjust, blur, paint, text, stickers) reachable
from both the cutout and final-result screens. Editor output is forced to
PNG so an edited cutout keeps the transparency the backdrop generator's
mask derivation depends on.

**Not yet built** (from the fuller product spec): product shadow
generation, AI model fitting/virtual try-on, AI-based upscaling, Firebase
auth, the credit/subscription system, and payments (Razorpay/Play Billing).
Those are real, separate pieces of work — see the root `README.md`'s
project status for what's actually live.

## Structure

```
mobile/
├── lib/
│   ├── main.dart                    # App entry point, theme
│   ├── screens/studio_screen.dart   # The main (only) screen
│   ├── services/api_service.dart    # HTTP calls to backend /ai/* endpoints
│   ├── models/studio_theme.dart     # Studio theme preset model
│   └── widgets/theme_selector.dart  # Theme picker chips
├── pubspec.yaml
└── analysis_options.yaml
```

**No `android/` or `ios/` folder is committed here.** Those are Flutter's
generated platform scaffolding, normally produced by running `flutter
create`. This project was put together without a local Flutter SDK
available to generate them correctly, so `.github/workflows/build-flutter-apk.yml`
generates `android/` automatically on every CI run (`flutter create` on a
directory that already has a `pubspec.yaml` only fills in the missing
platform folder — it never touches `lib/` or `pubspec.yaml`). If you ever
customize native Android config (app icon, permissions, signing), generate
it once and commit it from then on.

## Running/building without a computer

Same pattern as `../app`: GitHub Actions builds the APK, since there's no
local Flutter SDK in this workflow.

1. Push to `main`, or open a PR touching `mobile/` — this triggers
   `.github/workflows/build-flutter-apk.yml`.
2. GitHub repo → **Actions** tab → the run → download
   `product-photo-studio-debug` under **Artifacts** → unzip → install
   `app-debug.apk` on your phone (enable "install unknown apps").
3. To point it at a different backend than the default hardcoded in
   `lib/services/api_service.dart`: **Actions** tab → "Build Flutter Debug
   APK" → **Run workflow** → fill in `backend_url`.

## If you do get access to a computer with Flutter installed

```bash
cd mobile
flutter create --platforms=android --org com.productphoto.ai --project-name product_photo_studio .
flutter pub get
flutter run          # or: flutter build apk --debug
```

## Backend setup this app needs

See `../backend/README.md`'s "fal.ai AI features" section — you need a
funded fal.ai account and a `FAL_KEY` set on whatever host runs the backend,
plus verifying the exact model IDs in `backend/services/background_removal.py`
and `backend/services/background_generation.py` against your fal.ai
dashboard (this repo's sandbox has no network access to fal.ai to verify
them independently, so treat them as placeholders to confirm, not
guaranteed-correct values).

**Every `/ai/remove-background` and `/ai/generate-background` call costs
real money** on your fal.ai account — unlike `../app`'s free `rembg`-based
removal. Test with a small number of images first and check fal.ai's
dashboard for actual per-call cost before assuming a price.
