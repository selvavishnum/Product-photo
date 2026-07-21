# Product Photo AI

Native Android app (Kotlin + Jetpack Compose) for turning product photos into
marketplace-ready images. First working feature: background removal.

## Structure

- `app/` — Android app (Kotlin, Jetpack Compose, Retrofit).
- `backend/` — FastAPI service that performs background removal via the
  open-source `rembg` model. No AI API key involved anywhere.
- `store-listing.md` — Play Store listing copy.

## Running it

1. Backend: see `backend/README.md`.
2. App: open the project root in Android Studio, let Gradle sync, run the
   `app` module on an emulator or device. Defaults to talking to
   `http://10.0.2.2:8000/` (your machine's `localhost:8000` from the
   emulator) — start the backend first.

## Status

Background removal is the only feature wired end-to-end so far. See
`CLAUDE.md` for the gstack skill workflow this project uses, and
`store-listing.md` for the target feature set.
