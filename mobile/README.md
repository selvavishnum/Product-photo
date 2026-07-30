# Product Photo Studio — Flutter app

Cross-platform (Android now, iOS later) app for marketplace-ready product
photos. Background removal, studio backdrops and photo editing run
**entirely on the phone**; the remaining AI extras call the `/ai/*`
endpoints in `../backend`.

**This is the only app in the repo.** The original native Android app
(`../app`, Kotlin/Compose) was deleted: everything it did that still worked
is covered here and runs on-device instead of over the network, and its one
unique feature (AI Upscale via fal.ai) was already dead on an exhausted
balance.

## What's here vs. what's not

The app opens into a Photoroom-style bottom nav (`screens/home_shell.dart`):
**Home**, **AI tools**, **Batch**, **Content**.

- **Home** — **White background**: pick a photo, get a marketplace-ready
  listing image (pure white, product at 85% of frame, Amazon/Flipkart/Studio
  presets). Runs **entirely on the phone** — free, works offline, and no
  photo leaves the device. See `docs/on-device-architecture.md`.
- **AI tools** — White background plus the studio flow: pick a theme or type
  a prompt → generate a studio backdrop → preview, with "AI Upscale (paid)",
  "Add Shadow" (free, classical), "Virtual Try-On (paid)", and a full photo
  editor ([`pro_image_editor`](https://pub.dev/packages/pro_image_editor):
  crop/rotate, filters, tune/adjust, blur, paint, text, stickers). Editor
  output is forced to PNG so an edited cutout keeps the transparency the
  backdrop generator's mask derivation depends on.

**Background removal is on-device everywhere.** The paid
`/ai/remove-background` endpoint is no longer called from this app: it cost
money per image and stopped working outright once the fal.ai balance ran out
(`403 User is locked. Reason: Exhausted balance.`). The studio flow now feeds
the on-device cutout straight into backdrop generation, so the only calls
that still need fal.ai credit are backdrop, upscale and try-on.
- **Batch** and **Content** — honest "Coming soon" placeholders
  (`screens/batch_screen.dart`, `screens/content_screen.dart`). Batch
  (multi-image processing) and Content (sign-in + saved designs, needs
  Firebase Auth/Storage) are real, separate pieces of work, not built yet.

**Not yet built** (from the fuller product spec): Firebase auth, the
credit/subscription system, and payments (Razorpay/Play Billing), plus
Batch and Content above. See the root `README.md`'s project status for
what's actually live.

## Structure

```
mobile/
├── lib/
│   ├── main.dart                       # App entry point, theme
│   ├── screens/
│   │   ├── home_shell.dart             # Bottom-nav shell (4 tabs)
│   │   ├── studio_screen.dart          # Home tab: the studio flow
│   │   ├── ai_tools_screen.dart        # AI tools tab: menu into Home
│   │   ├── batch_screen.dart           # Batch tab: "Coming soon"
│   │   └── content_screen.dart         # Content tab: "Coming soon"
│   ├── services/api_service.dart       # HTTP calls to backend /ai/* endpoints
│   ├── models/studio_theme.dart        # Studio theme preset model
│   └── widgets/
│       ├── theme_selector.dart         # Theme picker chips
│       └── coming_soon.dart            # Shared "not built yet" placeholder
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

GitHub Actions builds the APK, since there's no local Flutter SDK in this
workflow.

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
plus verifying the exact model IDs in `backend/services/background_removal.py`,
`background_generation.py`, `upscale_ai.py`, and `virtual_tryon.py` against
your fal.ai dashboard (this repo's sandbox has no network access to fal.ai
to verify them independently, so treat them as placeholders to confirm, not
guaranteed-correct values).

**Every `/ai/*` call costs real money** on your fal.ai account — unlike the
on-device background removal, and unlike the "Add Shadow" button
(classical, free, no fal.ai call). Test with a small number
of images first and check fal.ai's dashboard for actual per-call cost
before assuming a price.
