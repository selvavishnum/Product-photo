import 'dart:io' show Platform;

import 'segmentation_engine.dart';
import 'u2netp_engine.dart';

/// Tries each engine in turn and uses the first that works.
///
/// The order is deliberate. ML Kit is preferred on Android when it is ready:
/// its model is hardware accelerated and costs nothing in app size. But it is
/// unavailable often enough -- still downloading on a fresh install, no Play
/// Services at all, and not implemented on iOS -- that it cannot be the only
/// option. The bundled u2netp model is always present, so it is the floor
/// that guarantees the feature works.
///
/// Only [SegmentationUnavailable] triggers a fallback. A
/// [SegmentationSizeMismatch] is a bug on our side and propagates, because
/// retrying a different engine would just hide it.
class FallbackSegmentationEngine implements SegmentationEngine {
  FallbackSegmentationEngine(this._engines)
      : assert(_engines.isNotEmpty, 'need at least one engine');

  final List<SegmentationEngine> _engines;

  /// The default chain: ML Kit first on Android, bundled model everywhere.
  factory FallbackSegmentationEngine.defaults({
    SegmentationEngine? mlKit,
  }) {
    return FallbackSegmentationEngine([
      // Android-only. On iOS the plugin is a stub that would throw a
      // MissingPluginException rather than something we can fall back from,
      // so it is not even added to the chain there.
      if (mlKit != null && Platform.isAndroid) mlKit,
      U2netpSegmentationEngine(),
    ]);
  }

  /// Which engine produced the most recent result, for diagnostics.
  SegmentationEngine? get lastUsed => _lastUsed;
  SegmentationEngine? _lastUsed;

  @override
  Future<SegmentationResult> segment(String imagePath, int width, int height) async {
    final failures = <String>[];

    for (final engine in _engines) {
      try {
        final result = await engine.segment(imagePath, width, height);
        _lastUsed = engine;
        return result;
      } on SegmentationSizeMismatch {
        // Our bug, not a device limitation. Falling through to another engine
        // would hide it behind a result that looks fine, so it propagates.
        rethrow;
      } on SegmentationUnavailable catch (e) {
        // Expected: this engine cannot run here. Try the next one.
        failures.add('${engine.runtimeType}: $e');
      } catch (e) {
        // Unexpected, but a broken optional engine must not take down a
        // working one -- e.g. MissingPluginException when ML Kit's native
        // half is absent from the build.
        failures.add('${engine.runtimeType}: $e');
      }
    }

    throw SegmentationUnavailable(
      'No segmentation engine could run:\n${failures.join('\n')}',
    );
  }

  @override
  Future<void> dispose() async {
    for (final engine in _engines) {
      await engine.dispose();
    }
  }
}
