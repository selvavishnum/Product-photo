import 'dart:typed_data';

import 'package:google_mlkit_commons/google_mlkit_commons.dart';
import 'package:google_mlkit_subject_segmentation/google_mlkit_subject_segmentation.dart';

/// The result of segmenting a photo: a per-pixel alpha in [0,1].
class SegmentationResult {
  SegmentationResult({
    required this.alpha,
    required this.width,
    required this.height,
  });

  final Float32List alpha;
  final int width;
  final int height;
}

/// Produces a foreground mask for a photo, entirely on the device.
///
/// Deliberately an interface: the engine that is best on Android is not
/// available on iOS, so the pipeline above it must not care which one ran.
abstract class SegmentationEngine {
  Future<SegmentationResult> segment(String imagePath, int width, int height);
  Future<void> dispose();
}

/// ML Kit Subject Segmentation -- the default on Android.
///
/// Chosen because the model ships through Google Play Services rather than
/// inside the APK: it costs nothing in app size, it is hardware accelerated,
/// and it is free with no per-call charge. That is the whole point of moving
/// this off the backend -- no fal.ai bill, no Render cold start, works
/// offline.
///
/// Two caveats that the calling code has to handle, both verified against the
/// plugin's own source rather than assumed:
///
///  * **Android only.** The plugin's iOS half is a stub that returns
///    `FlutterMethodNotImplemented`, and its podspec has the ML Kit
///    dependency commented out. iOS needs the bundled-model engine instead.
///  * **The model is downloaded by Play Services on first use.** The first
///    call on a fresh install can fail or block while that happens, and it
///    never arrives on devices with no Play Services at all. Fall back.
class MlKitSegmentationEngine implements SegmentationEngine {
  MlKitSegmentationEngine()
      : _segmenter = SubjectSegmenter(
          options: SubjectSegmenterOptions(
            // The confidence mask is the one we want: a real per-pixel alpha,
            // which the refinement stage needs. The foreground bitmap is
            // already hard-cut and would throw away the soft edge.
            enableForegroundConfidenceMask: true,
            enableForegroundBitmap: false,
            enableMultipleSubjects: SubjectResultOptions(
              enableConfidenceMask: false,
              enableSubjectBitmap: false,
            ),
          ),
        );

  final SubjectSegmenter _segmenter;

  @override
  Future<SegmentationResult> segment(String imagePath, int width, int height) async {
    final result = await _segmenter.processImage(
      InputImage.fromFilePath(imagePath),
    );

    final mask = result.foregroundConfidenceMask;
    if (mask == null || mask.isEmpty) {
      throw const SegmentationUnavailable(
        'ML Kit returned no mask -- the Play Services model is probably still '
        'downloading.',
      );
    }
    if (mask.length != width * height) {
      throw SegmentationUnavailable(
        'Mask size ${mask.length} does not match image ${width}x$height.',
      );
    }

    final alpha = Float32List(mask.length);
    for (var i = 0; i < mask.length; i++) {
      alpha[i] = mask[i].clamp(0.0, 1.0);
    }
    return SegmentationResult(alpha: alpha, width: width, height: height);
  }

  @override
  Future<void> dispose() => _segmenter.close();
}

/// Raised when an engine cannot run on this device/photo, so the caller can
/// try the next engine instead of surfacing a failure to the user.
class SegmentationUnavailable implements Exception {
  const SegmentationUnavailable(this.message);
  final String message;

  @override
  String toString() => message;
}
