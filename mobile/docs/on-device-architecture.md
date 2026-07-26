# On-device background removal — architecture and measurements

The goal: a seller photographs a product (jewellery, books, electronics),
and the app returns a listing image that Amazon or Flipkart will accept —
product cut out, pure white background, correctly framed. **All of it on the
phone's own CPU/GPU.**

## Why on-device rather than the backend

The repo already has `/ai/remove-background` (BiRefNet via fal.ai). It works,
but it is the wrong shape for this job:

| | Backend `/ai/*` | On-device |
|---|---|---|
| Cost per image | Real money, every call | Zero |
| First image after idle | ~50s Render cold start | No wait |
| No signal / poor signal | Fails | Works |
| Seller does 100 listings | 100 paid API calls | Free |
| Photo leaves the phone | Yes | No |

A seller batch-editing listings is exactly the case where per-image API cost
and cold starts hurt most. So this path has **no network call at all**.

## The pipeline

```
photo → segment → refine alpha → decontaminate → composite on white → frame
```

Stages 2–5 are plain array maths on the decoded pixels, so they are pure Dart
(`lib/ondevice/matting.dart`, `framing.dart`) and run in a background isolate.
Only stage 1 needs a model.

**Why the refine and decontaminate stages exist** — they are not polish, they
are what makes the output usable:

- **Refine.** The segmentation network runs at a fixed low resolution and its
  mask is upsampled, so it arrives soft and rounds off thin structures —
  chains, prongs, wire. A guided filter using the photo as its own guide snaps
  the mask back onto real edges. Measured: it lifts a 4.4 MB model's mask from
  **IoU 0.887 → 0.958** against a 170 MB model's output.
- **Decontaminate.** Product photos are often shot on dark cloth or a coloured
  display stand, and the destination is pure white. Compositing the observed
  pixel straight onto white leaves a dark or coloured halo tracing the product.
  Solving the matting equation for the true foreground colour removes it.

## Engine choice

`SegmentationEngine` is an interface because the best engine on Android is not
available on iOS.

**Android: ML Kit Subject Segmentation** (`play-services-mlkit-subject-segmentation:16.0.0-beta1`).
The model ships through Google Play Services, so it costs **nothing in APK
size**, is hardware accelerated, and is free per call.

Two caveats, both found by reading the plugin's published source rather than
assuming:

- **It is Android-only in practice.** The plugin's iOS half is a stub that
  returns `FlutterMethodNotImplemented`, and its podspec has the ML Kit
  dependency commented out. iOS will need the bundled-model engine.
- **Play Services downloads the model on first use**, so the first call on a
  fresh install can fail while that happens, and it never arrives on devices
  without Play Services. `SegmentationUnavailable` exists so the caller can
  fall back instead of showing an error.

### Bundled-model fallback — measured, not guessed

Candidates were benchmarked on the real jewellery photo (x86 CPU in a build
sandbox — treat the **relative** numbers and the **sizes** as transferable,
not the absolute times, since a phone runs these on GPU/NPU):

| Model | Size | 500px | 2400×1600 | Thin chain kept |
|---|---|---|---|---|
| **u2netp** | **4.4 MB** | 0.68s | 2.76s | 69% |
| isnet-general-use | 170 MB | 4.46s | 3.57s | 100% (reference) |
| birefnet-general-lite | 214 MB | 21.7s | 8.20s | ~100% |

Conclusions:

- **`birefnet-general-lite` is not lite.** Despite the name it is the largest
  and by far the slowest. Ruled out.
- **170 MB cannot be bundled** in an APK. It would have to be a first-run
  download, which is exactly the friction ML Kit already solves better.
- **u2netp at 4.4 MB is the only bundleable option**, and with the refinement
  stage it reaches IoU 0.958 against the big model — good enough for solid
  products (books, boxes, electronics).

**The honest limitation:** u2netp keeps only ~69% of a bare thin chain. See
`ondevice-thin-chain-comparison.jpg` — it breaks the chain partway up and
leaves a floating fragment. For jewellery, ML Kit (or a manual refine brush)
is needed; the small bundled model is a fallback, not an equal substitute.

## Marketplace presets

`MarketplacePreset` encodes the published main-image rules: pure white
background, product filling a set share of the frame, and a long edge big
enough for listing zoom.

**Verify these against current seller policy before relying on them
commercially** — policies change and vary by category, and this repo has no
network access to re-check them at build time. Same discipline as the
unverified fal.ai model IDs in `backend/README.md`. `amazon` is the strictest
preset, so output that satisfies it generally satisfies the others.

The `studio` preset adds a soft contact shadow. That is deliberately **not**
the default: marketplaces may reject shadows on the main image.

## Proof

Real output from this pipeline on a real product photo:

- `ondevice-pipeline-stages.jpg` — input → mask → cutout → white-background output
- `ondevice-amazon-output.jpg` — the finished 1600×1600 listing image
- `ondevice-thin-chain-comparison.jpg` — the u2netp chain limitation, zoomed

## Not done yet

- **The bundled u2netp fallback is not wired up.** Only the ML Kit engine is
  implemented; `SegmentationEngine` is the seam it will slot into. Until then
  the flow needs Play Services.
- **iOS** — needs that fallback engine, per the stub above.
- **Subject selection.** The segmenter treats a display stand as part of the
  subject, because it genuinely is the salient foreground object. Getting
  product-only output needs either ML Kit's multi-subject mode plus a tap to
  choose, or a manual refine brush. Visible in the proof sheet: the red stand
  survives the cutout.
- **Batch.** The whole point of on-device is that 100 images cost nothing —
  but the Batch tab is still a placeholder.
- **This Dart has never run on a device.** There is no Flutter SDK in the
  sandbox it was written in; CI compiles it on every push. Every plugin and
  `image` package API used here was checked against the real published source
  first, but compiling is not the same as running.
