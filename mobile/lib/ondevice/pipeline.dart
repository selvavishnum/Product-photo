import 'dart:io';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:image/image.dart' as img;

import 'framing.dart';
import 'matting.dart';
import 'segmentation_engine.dart';

/// One stage of the pipeline, for progress reporting.
enum PipelineStage { decoding, segmenting, refining, composing, encoding, done }

/// Runs the whole on-device flow: photo in, marketplace-ready image out.
///
/// No network call anywhere in here. That is the design constraint, and it is
/// why this path keeps working when the paid backend does not -- a fal.ai
/// balance running out takes the `/ai/*` endpoints down, but not this.
class OnDevicePipeline {
  OnDevicePipeline(this._engine);

  final SegmentationEngine _engine;

  /// Longest edge the segmentation runs at. The network's own input is far
  /// smaller than this, so going bigger buys nothing but heap pressure -- and
  /// phone photos are commonly 12MP, which will OOM a mid-range device if
  /// processed at full size. The refinement stage restores edge detail at
  /// full resolution afterwards, which is where it actually matters.
  static const int _workingEdge = 2048;

  /// Cut out the product and place it on a white marketplace-ready canvas.
  Future<Uint8List> run({
    required Uint8List imageBytes,
    MarketplacePreset preset = MarketplacePreset.amazon,
    void Function(PipelineStage stage)? onStage,
  }) async {
    final prepared = await _prepare(imageBytes, onStage);

    onStage?.call(PipelineStage.refining);
    final rgb = prepared.rgb;
    final seg = prepared.seg;

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

  /// Cut out the product and return a transparent PNG, cropped to it.
  ///
  /// Same work as [run] minus the white canvas, for callers that want to put
  /// the product on something other than white -- the studio backdrop flow
  /// uses this so it never needs the paid background-removal endpoint.
  Future<Uint8List> cutout({
    required Uint8List imageBytes,
    void Function(PipelineStage stage)? onStage,
  }) async {
    final prepared = await _prepare(imageBytes, onStage);

    onStage?.call(PipelineStage.refining);
    final rgb = prepared.rgb;
    final seg = prepared.seg;

    final png = await Isolate.run(() {
      final refined = Matting.refineAlpha(rgb, seg.alpha, seg.width, seg.height);
      final clean = Matting.decontaminate(rgb, refined, seg.width, seg.height);
      return Framing.encodePng(
        Framing.toTransparentCutout(
          rgb: clean,
          alpha: refined,
          width: seg.width,
          height: seg.height,
        ),
      );
    });

    onStage?.call(PipelineStage.done);
    return png;
  }

  Future<_Prepared> _prepare(
    Uint8List imageBytes,
    void Function(PipelineStage stage)? onStage,
  ) async {
    onStage?.call(PipelineStage.decoding);
    final decoded = img.decodeImage(imageBytes);
    if (decoded == null) {
      throw const FormatException('That file is not an image we can read.');
    }

    final oriented = img.bakeOrientation(decoded);
    final working = _downscale(oriented, _workingEdge);

    // The segmenter must be given *this* bitmap, not the original file.
    //
    // Passing the original path meant ML Kit segmented the full-resolution
    // photo and returned a mask with one value per original pixel, while
    // everything downstream indexes the downscaled copy -- so a 3000x2000
    // photo produced a 6,000,000-value mask for a 2048x1365 image and the
    // run aborted. Writing the working bitmap out and segmenting that makes
    // the two agree by construction.
    //
    // It also removes an EXIF ambiguity: orientation is already baked in
    // here, and a re-encoded JPEG carries no EXIF for ML Kit to re-apply.
    onStage?.call(PipelineStage.segmenting);
    final tempDir = await Directory.systemTemp.createTemp('seg');
    final workingFile = File('${tempDir.path}/working.jpg');
    final SegmentationResult seg;
    try {
      await workingFile.writeAsBytes(img.encodeJpg(working, quality: 92));
      // Must stay on the root isolate: ML Kit is a platform channel call.
      seg = await _engine.segment(
        workingFile.path,
        working.width,
        working.height,
      );
    } finally {
      // Best-effort: a leftover temp file must never fail the whole run.
      try {
        await tempDir.delete(recursive: true);
      } catch (_) {}
    }

    return _Prepared(_toRgbBytes(working), seg);
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

class _Prepared {
  const _Prepared(this.rgb, this.seg);
  final Uint8List rgb;
  final SegmentationResult seg;
}
