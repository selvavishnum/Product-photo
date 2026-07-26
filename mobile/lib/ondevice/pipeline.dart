import 'dart:isolate';
import 'dart:typed_data';

import 'package:image/image.dart' as img;

import 'framing.dart';
import 'matting.dart';
import 'segmentation_engine.dart';

/// One stage of the pipeline, for progress reporting.
enum PipelineStage { decoding, segmenting, refining, composing, encoding, done }

/// Runs the whole on-device flow: photo in, marketplace-ready JPEG out.
///
/// No network call anywhere in here. That is the design constraint: the
/// backend's `/ai/*` endpoints cost money per image and need a live server,
/// which is the wrong shape for a seller batch-editing a hundred listings.
class OnDevicePipeline {
  OnDevicePipeline(this._engine);

  final SegmentationEngine _engine;

  /// Longest edge the segmentation runs at. The network's own input is far
  /// smaller than this, so going bigger buys nothing but heap pressure -- and
  /// phone photos are commonly 12MP, which will OOM a mid-range device if
  /// processed at full size. The refinement stage restores edge detail at
  /// full resolution afterwards, which is where it actually matters.
  static const int _workingEdge = 2048;

  Future<Uint8List> run({
    required String imagePath,
    required Uint8List imageBytes,
    MarketplacePreset preset = MarketplacePreset.amazon,
    void Function(PipelineStage stage)? onStage,
  }) async {
    onStage?.call(PipelineStage.decoding);
    final decoded = img.decodeImage(imageBytes);
    if (decoded == null) {
      throw const FormatException('That file is not an image we can read.');
    }

    final oriented = img.bakeOrientation(decoded);
    final working = _downscale(oriented, _workingEdge);

    onStage?.call(PipelineStage.segmenting);
    // Must stay on the root isolate: ML Kit is a platform channel call.
    final seg = await _engine.segment(imagePath, working.width, working.height);

    onStage?.call(PipelineStage.refining);
    final rgb = _toRgbBytes(working);

    // Everything below is pure CPU maths on byte arrays, so it goes to a
    // background isolate -- otherwise the UI drops frames for seconds on a
    // mid-range phone.
    final jpeg = await Isolate.run(() {
      final refined = Matting.refineAlpha(rgb, seg.alpha, seg.width, seg.height);
      final clean = Matting.decontaminate(rgb, refined, seg.width, seg.height);
      final framed = Framing.composeAndFrame(
        rgb: clean,
        alpha: refined,
        width: seg.width,
        height: seg.height,
        preset: preset,
      );
      return Framing.encodeJpeg(framed);
    });

    onStage?.call(PipelineStage.done);
    return jpeg;
  }

  static img.Image _downscale(img.Image src, int maxEdge) {
    final longest = src.width > src.height ? src.width : src.height;
    if (longest <= maxEdge) return src;
    final scale = maxEdge / longest;
    return img.copyResize(
      src,
      width: (src.width * scale).round(),
      height: (src.height * scale).round(),
      interpolation: img.Interpolation.average,
    );
  }

  static Uint8List _toRgbBytes(img.Image src) {
    final out = Uint8List(src.width * src.height * 3);
    var i = 0;
    for (var y = 0; y < src.height; y++) {
      for (var x = 0; x < src.width; x++) {
        final p = src.getPixel(x, y);
        out[i++] = p.r.toInt();
        out[i++] = p.g.toInt();
        out[i++] = p.b.toInt();
      }
    }
    return out;
  }

  Future<void> dispose() => _engine.dispose();
}
