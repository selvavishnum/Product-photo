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

Every push to `main` (and every PR) triggers `.github/workflows/build-debug-apk.yml`,
which builds a debug APK on GitHub's runners and attaches it as a workflow
artifact. To get it: GitHub repo → **Actions** tab → the latest "Build Debug
APK" run → download `product-photo-ai-debug` under **Artifacts**, unzip, and
install the `.apk` on a device (enable "install unknown apps" for whichever
app you use to open it).

This is a debug build talking to `http://10.0.2.2:8000/` by default, which
only resolves on an emulator. To use it on a real phone, rebuild with the
backend's real address:

```bash
./gradlew assembleDebug -PbackendUrl=http://<your-backend-host>:8000/
```

— either your computer's LAN IP (phone and computer on the same Wi-Fi) or a
publicly hosted backend URL. This is still an unsigned debug build, not a
Play Store release — see the "Releasing" section below for what that needs.

## Releasing to the Play Store (not done yet)

Merging code and building a debug APK are not the same as a store release.
Still needed:
- A signing keystore + a release build signed with it.
- The backend hosted somewhere public over HTTPS (not `10.0.2.2` or a LAN IP).
- A Google Play Console account, the store listing (`store-listing.md` as a
  starting point), a real privacy policy URL, content rating, and the data
  safety form.
- Upload to an internal testing track first, then production, and wait for
  Google's review.

## Status

Background removal is the only feature wired end-to-end so far. See
`CLAUDE.md` for the gstack skill workflow this project uses, and
`store-listing.md` for the target feature set.
