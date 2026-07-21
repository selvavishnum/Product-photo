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

**This default build only works in the Android emulator, not on a real
phone.** It talks to `http://10.0.2.2:8000/`, a special address that only
means "the computer running the emulator" *inside* the emulator — on a real
phone it resolves to nothing, and background removal / upscale will fail
with a connection error ("failed to connect to /10.0.2.2 ... after 30000ms").

**To run it on a real phone**, on the same WiFi as your computer:

1. Start the backend on your computer: `uvicorn main:app --host 0.0.0.0 --port 8000`
   (must bind `0.0.0.0`, not `127.0.0.1`/`localhost`, or other devices can't reach it).
2. Find your computer's LAN IP (`ipconfig` on Windows, `ifconfig`/`ip addr` on
   Mac/Linux — look for something like `192.168.1.X`). Your phone must show
   an IP on the *same* `192.168.1.x` subnet for this to work.
3. Build a debug APK pointed at that IP — either:
   - **From GitHub, no local setup**: repo → **Actions** tab → "Build Debug
     APK" → **Run workflow** → fill in `backend_url` as
     `http://<your-computer's-LAN-IP>:8000/` → download the resulting artifact.
   - **Locally** (needs Android Studio or a working `./gradlew`):
     `./gradlew assembleDebug -PbackendUrl=http://<your-computer's-LAN-IP>:8000/`
4. If it still can't connect: check your computer's firewall isn't blocking
   inbound connections on port 8000.

For a publicly hosted backend (works on any network, not just the same
WiFi), use its HTTPS URL the same way — this is still an unsigned debug
build either way, not a Play Store release; see "Releasing" below.

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

Background removal, Backdrop Select, and Photo Upscale are wired
end-to-end. See `CLAUDE.md` for the gstack skill workflow this project
uses, and `store-listing.md` for the target feature set.
