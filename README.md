# Product Photo AI

Native Android app (Kotlin + Jetpack Compose) for turning product photos into
marketplace-ready images.

## Structure

- `app/` — Android app (Kotlin, Jetpack Compose, Retrofit, ONNX Runtime Mobile).
- `backend/` — FastAPI service for Photo Upscale (classical, no model
  download). Background removal no longer needs this backend at all — see
  below — but the endpoint still exists and is still tested.
- `store-listing.md` — Play Store listing copy.

## Background removal: fully on-device, no backend needed

Runs entirely on the phone via ONNX Runtime Mobile
(`app/src/main/java/com/productphoto/ai/ml/`), using the same `u2netp` model
`rembg` uses server-side — just moved onto the device instead of a server.
The app downloads the ~4.7MB model file once (needs internet for that one
download; nothing after) and verifies it against rembg's own published
checksum before using it. No backend, no computer, no LAN IP needed for this
feature — it was the fix for "no computer to host on."

**Not yet verified against a real model/device** — the preprocessing and
mask math (`ml/TensorPreprocessing.kt`) is unit-tested against exact
reference values computed from rembg's own source, and the ONNX Runtime API
calls were checked against the real `onnxruntime` jar's class files, but
this sandbox has no Android device or SDK to run the full pipeline
end-to-end. Test on a real phone before relying on it.

## Photo Upscale: still needs the backend

Upscale (Lanczos resample + unsharp mask) hasn't moved on-device — see
`backend/README.md` for running/deploying it.

## Running it

1. Backend (for Upscale): see `backend/README.md`.
2. App: open the project root in Android Studio, let Gradle sync, run the
   `app` module on an emulator or device. Background removal works
   immediately (once the model download finishes); Upscale needs the backend
   reachable — defaults to `http://10.0.2.2:8000/` (your machine's
   `localhost:8000` from the emulator).

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

**This default build's Upscale feature only works in the Android emulator,
not on a real phone** (background removal is unaffected — it's on-device and
doesn't talk to any backend). The default build talks to
`http://10.0.2.2:8000/`, a special address that only means "the computer
running the emulator" *inside* the emulator — on a real phone it resolves to
nothing, and Upscale will fail with a connection error ("failed to connect
to /10.0.2.2 ... after 30000ms").

**No computer at all?** See `backend/README.md`'s "Hugging Face Spaces"
section — deploys the backend for free, entirely from a phone browser (no
`git push`, no terminal). Then skip straight to step 3 below with that
Space's `https://...hf.space` URL as the `backend_url`.

**If you do have a computer**, on the same WiFi as your phone:

1. Start the backend on your computer: `uvicorn main:app --host 0.0.0.0 --port 8000`
   (must bind `0.0.0.0`, not `127.0.0.1`/`localhost`, or other devices can't reach it).
2. Find your computer's LAN IP (`ipconfig` on Windows, `ifconfig`/`ip addr` on
   Mac/Linux — look for something like `192.168.1.X`). Your phone must show
   an IP on the *same* `192.168.1.x` subnet for this to work.

3. Build a debug APK pointed at that backend — either:
   - **From GitHub, no local setup**: repo → **Actions** tab → "Build Debug
     APK" → **Run workflow** → fill in `backend_url` (LAN IP or the HF
     Spaces URL from above) → download the resulting artifact.
   - **Locally** (needs Android Studio or a working `./gradlew`):
     `./gradlew assembleDebug -PbackendUrl=<url>`
4. If a LAN IP still can't connect: check your computer's firewall isn't
   blocking inbound connections on port 8000.

This is still an unsigned debug build either way, not a Play Store release —
see "Releasing" below.

## Releasing to the Play Store (not done yet)

Merging code and building a debug APK are not the same as a store release.
Still needed:
- A signing keystore + a release build signed with it.
- The backend hosted somewhere public over HTTPS (not `10.0.2.2` or a LAN
  IP) for Upscale — background removal doesn't need this.
- A Google Play Console account, the store listing (`store-listing.md` as a
  starting point), a real privacy policy URL, content rating, and the data
  safety form.
- Upload to an internal testing track first, then production, and wait for
  Google's review.

## Status

Background removal (on-device, not yet verified on a real device), Backdrop
Select, and Photo Upscale are wired end-to-end. See `CLAUDE.md` for the
gstack skill workflow this project uses, and `store-listing.md` for the
target feature set.
