import 'dart:typed_data';

import 'package:flutter/services.dart' show PlatformException;
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
    final SubjectSegmentationResult result;
    try {
      result = await _segmenter.processImage(
        InputImage.fromFilePath(imagePath),
      );
    } on PlatformException catch (e) {
      // ML Kit reports the Play Services model download as a generic
      // PlatformException, so it has to be recognised by message rather than
      // by type. Without this it surfaced to the user as a raw Java stack
      // trace, which is both useless and alarming.
      final detail = '${e.message ?? ''} ${e.details ?? ''}';
      if (detail.contains('optional module') ||
          detail.contains('to be downloaded') ||
          detail.contains('Waiting for')) {
        throw const ModelDownloading();
      }
      rethrow;
    }

    final mask = result.foregroundConfidenceMask;
    if (mask == null || mask.isEmpty) {
      // An empty mask is the other way the not-yet-downloaded model shows up.
      throw const ModelDownloading();
    }
    if (mask.length != width * height) {
      // Not a Play Services problem -- this means the bitmap ML Kit read is
      // not the one the rest of the pipeline is working on. Kept as a real
      // error rather than a fallback so the mismatch can't pass silently.
      throw SegmentationSizeMismatch(
        maskLength: mask.length,
        width: width,
        height: height,
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

/// Play Services has not finished fetching the ML Kit model yet.
///
/// Distinct from the other failures because it is **temporary and not the
/// user's fault** -- the same photo will work in a minute -- so the UI should
/// say "wait", not "error".
class ModelDownloading extends SegmentationUnavailable {
  const ModelDownloading()
      : super(
          'The on-device model is still downloading in the background.',
        );
}

/// The mask does not describe the image the pipeline is processing.
///
/// Always a bug on our side, not a device problem: it means the bitmap handed
/// to ML Kit and the one being post-processed have different dimensions.
class SegmentationSizeMismatch implements Exception {
  const SegmentationSizeMismatch({
    required this.maskLength,
    required this.width,
    required this.height,
  });

  final int maskLength;
  final int width;
  final int height;

  @override
  String toString() =>
      'Mask has $maskLength values but the image is ${width}x$height '
      '(${width * height}).';
}
