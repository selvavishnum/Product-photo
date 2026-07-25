import 'dart:math' as math;
import 'dart:typed_data';

import 'package:image/image.dart' as img;

/// Marketplace presets for the final export.
///
/// These encode the published main-image rules for each marketplace: a pure
/// white background, the product filling a set share of the frame, and a
/// minimum long edge so the listing's zoom works.
///
/// Treat the numbers as "confirm before you rely on them commercially" --
/// seller policies change and differ by category, and this repo has no
/// network access to re-check them at build time. The safe default
/// ([amazon]) is the strictest of the three, so an image that satisfies it
/// generally satisfies the others.
class MarketplacePreset {
  const MarketplacePreset({
    required this.name,
    required this.size,
    required this.fill,
    required this.shadow,
  });

  final String name;

  /// Output edge length in pixels (square).
  final int size;

  /// Share of the frame the product's long edge should occupy.
  final double fill;

  /// Whether to lay down a soft contact shadow before the product.
  final bool shadow;

  /// Amazon's main image: pure white, product ~85% of frame, 1600px gives
  /// comfortable headroom over the 1000px zoom threshold.
  static const amazon = MarketplacePreset(
    name: 'Amazon',
    size: 1600,
    fill: 0.85,
    shadow: false,
  );

  /// Flipkart accepts the same shape of image; 1500px is their recommended
  /// size and the product may sit a little smaller in frame.
  static const flipkart = MarketplacePreset(
    name: 'Flipkart',
    size: 1500,
    fill: 0.82,
    shadow: false,
  );

  /// Not a marketplace rule -- a nicer-looking variant for your own store or
  /// social posts, where a contact shadow stops light products from looking
  /// like they float. Marketplaces may reject shadows on the *main* image, so
  /// this is deliberately not the default.
  static const studio = MarketplacePreset(
    name: 'Studio (shadow)',
    size: 1600,
    fill: 0.82,
    shadow: true,
  );

  static const all = [amazon, flipkart, studio];
}

class Framing {
  /// Composite the decontaminated foreground onto pure white and frame it to
  /// [preset]'s rules.
  ///
  /// Crops to the subject's true bounding box first, so framing is measured
  /// against the product itself rather than whatever empty space happened to
  /// be in the original photo.
  static img.Image composeAndFrame({
    required Uint8List rgb,
    required Float32List alpha,
    required int width,
    required int height,
    required MarketplacePreset preset,
  }) {
    // Subject bounding box.
    var minX = width, minY = height, maxX = -1, maxY = -1;
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        if (alpha[y * width + x] > 0.02) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) {
      throw StateError('Nothing detected in the photo.');
    }

    final cropW = maxX - minX + 1;
    final cropH = maxY - minY + 1;

    // Cropped RGBA of just the subject.
    final cut = img.Image(width: cropW, height: cropH, numChannels: 4);
    for (var y = 0; y < cropH; y++) {
      for (var x = 0; x < cropW; x++) {
        final si = (y + minY) * width + (x + minX);
        cut.setPixelRgba(
          x,
          y,
          rgb[si * 3],
          rgb[si * 3 + 1],
          rgb[si * 3 + 2],
          (alpha[si] * 255).round().clamp(0, 255),
        );
      }
    }

    final target = (preset.size * preset.fill).round();
    final scale = target / math.max(cropW, cropH);
    final newW = math.max(1, (cropW * scale).round());
    final newH = math.max(1, (cropH * scale).round());

    final scaled = img.copyResize(
      cut,
      width: newW,
      height: newH,
      interpolation: img.Interpolation.cubic,
    );

    final canvas = img.Image(width: preset.size, height: preset.size, numChannels: 3);
    img.fill(canvas, color: img.ColorRgb8(255, 255, 255));

    final ox = (preset.size - newW) ~/ 2;
    final oy = (preset.size - newH) ~/ 2;

    if (preset.shadow) {
      _drawContactShadow(canvas, scaled, ox, oy, preset.size);
    }

    img.compositeImage(canvas, scaled, dstX: ox, dstY: oy);
    return canvas;
  }

  static void _drawContactShadow(
    img.Image canvas,
    img.Image subject,
    int ox,
    int oy,
    int size,
  ) {
    final offset = (size * 0.012).round();
    final blur = math.max(3, (size * 0.02).round());

    final shadow = img.Image(width: size, height: size, numChannels: 4);
    for (var y = 0; y < subject.height; y++) {
      for (var x = 0; x < subject.width; x++) {
        final a = subject.getPixel(x, y).a.toInt();
        if (a == 0) continue;
        final ty = oy + y + offset;
        final tx = ox + x;
        if (ty < 0 || ty >= size || tx < 0 || tx >= size) continue;
        shadow.setPixelRgba(tx, ty, 0, 0, 0, (a * 0.28).round());
      }
    }
    img.gaussianBlur(shadow, radius: blur);
    img.compositeImage(canvas, shadow);
  }

  /// Encode as JPEG at a quality high enough that marketplace re-compression
  /// does not visibly damage fine detail like chains or engraving.
  static Uint8List encodeJpeg(img.Image image) =>
      img.encodeJpg(image, quality: 95);

  static Uint8List encodePng(img.Image image) => img.encodePng(image);
}
