import 'dart:math' as math;

import 'package:image/image.dart' as img;

/// A studio backdrop drawn procedurally, with no model and no network call.
///
/// Deliberately not generative. For jewellery a diffusion model tends to
/// invent reflections and highlights on metal and stones -- detail the actual
/// product does not have, which is the wrong thing to put on a listing. A
/// gradient with a soft light and a real reflection of the product itself is
/// honest, renders in milliseconds, costs nothing, and looks like a lightbox
/// shot.
///
/// Marketplace main images must be plain white regardless
/// ([BackdropStyle.none]); these are for the secondary and lifestyle shots,
/// and for sellers' own storefronts and social posts.
class BackdropStyle {
  const BackdropStyle({
    required this.name,
    required this.top,
    required this.bottom,
    this.spotlight = 0.0,
    this.reflection = 0.0,
    this.vignette = 0.0,
  });

  final String name;

  /// Vertical gradient endpoints, as 0xRRGGBB.
  final int top;
  final int bottom;

  /// Strength (0-1) of a soft radial light behind the product.
  final double spotlight;

  /// Opacity (0-1) of the product's mirrored reflection below it.
  final double reflection;

  /// Strength (0-1) of corner darkening.
  final double vignette;

  bool get isPlainWhite => this == none;

  /// Pure white. The only one a marketplace main image may use.
  static const none = BackdropStyle(
    name: 'White',
    top: 0xFFFFFF,
    bottom: 0xFFFFFF,
  );

  /// Neutral grey sweep -- the safest "proper studio" look, and the one that
  /// flatters silver and white metal without tinting it.
  static const studioGrey = BackdropStyle(
    name: 'Studio grey',
    top: 0xF2F3F5,
    bottom: 0xC9CDD4,
    spotlight: 0.35,
    reflection: 0.22,
    vignette: 0.10,
  );

  /// Warm cream. Flatters gold and brass, which look cold on grey.
  static const warmCream = BackdropStyle(
    name: 'Warm cream',
    top: 0xFFF6E9,
    bottom: 0xE8D3B4,
    spotlight: 0.30,
    reflection: 0.20,
    vignette: 0.12,
  );

  /// Dark navy with a strong spotlight -- the jewellery-counter look. Bright
  /// stones and polished metal read best against it.
  static const deepNavy = BackdropStyle(
    name: 'Deep navy',
    top: 0x2A3550,
    bottom: 0x0E1420,
    spotlight: 0.55,
    reflection: 0.28,
    vignette: 0.28,
  );

  /// Soft blush, for a lighter lifestyle feel.
  static const blush = BackdropStyle(
    name: 'Blush',
    top: 0xFDEFF1,
    bottom: 0xE9C2CB,
    spotlight: 0.28,
    reflection: 0.18,
    vignette: 0.10,
  );

  /// Saffron. The festival colour here, and it sits behind gold without
  /// fighting it -- both are warm, so the metal reads as metal rather than as
  /// another patch of orange.
  static const saffron = BackdropStyle(
    name: 'Saffron',
    top: 0xFFB347,
    bottom: 0xC2560A,
    spotlight: 0.34,
    reflection: 0.22,
    vignette: 0.18,
  );

  /// Deep maroon, the traditional jewellery-box lining. Gold and kundan read
  /// strongest against it, which is why every real jewellery counter uses it.
  static const maroon = BackdropStyle(
    name: 'Maroon',
    top: 0x7A1F2B,
    bottom: 0x35090F,
    spotlight: 0.52,
    reflection: 0.26,
    vignette: 0.30,
  );

  static const all = [
    none,
    studioGrey,
    warmCream,
    saffron,
    maroon,
    deepNavy,
    blush,
  ];

  /// Renders the background by itself, before the product is placed on it.
  ///
  /// [productCentreY] is where the product's middle will sit as a fraction of
  /// the canvas, so the spotlight lands behind the product rather than in a
  /// fixed spot that may miss it.
  img.Image render(int size, {double productCentreY = 0.5}) {
    final canvas = img.Image(width: size, height: size, numChannels: 3);

    final tr = (top >> 16) & 0xFF, tg = (top >> 8) & 0xFF, tb = top & 0xFF;
    final br = (bottom >> 16) & 0xFF,
        bg = (bottom >> 8) & 0xFF,
        bb = bottom & 0xFF;

    final cx = size / 2.0;
    final cy = size * productCentreY;
    // Comfortably larger than the product so the falloff stays gentle.
    final radius = size * 0.62;
    final maxDistance = size * 0.75;

    for (var y = 0; y < size; y++) {
      final t = y / (size - 1);
      final baseR = tr + (br - tr) * t;
      final baseG = tg + (bg - tg) * t;
      final baseB = tb + (bb - tb) * t;

      for (var x = 0; x < size; x++) {
        var r = baseR, g = baseG, b = baseB;

        if (spotlight > 0) {
          final dx = x - cx, dy = y - cy;
          final d = math.sqrt(dx * dx + dy * dy) / radius;
          // Smoothstep falloff: no hard edge where the light ends.
          final f = (1.0 - d.clamp(0.0, 1.0));
          final lift = spotlight * f * f * (3 - 2 * f) * 255 * 0.35;
          r += lift;
          g += lift;
          b += lift;
        }

        if (vignette > 0) {
          final dx = x - cx, dy = y - size / 2.0;
          final d = (math.sqrt(dx * dx + dy * dy) / maxDistance).clamp(0.0, 1.0);
          final darken = 1.0 - vignette * d * d;
          r *= darken;
          g *= darken;
          b *= darken;
        }

        canvas.setPixelRgba(
          x,
          y,
          r.round().clamp(0, 255),
          g.round().clamp(0, 255),
          b.round().clamp(0, 255),
          255,
        );
      }
    }
    return canvas;
  }

  /// Draws the product's mirrored reflection onto [canvas], directly beneath
  /// where the product will be placed.
  ///
  /// A real reflection of the real product -- not an invented one -- so it
  /// cannot misrepresent what is being sold.
  void drawReflection(
    img.Image canvas,
    img.Image product,
    int originX,
    int originY,
  ) {
    if (reflection <= 0) return;

    final size = canvas.height;
    final flipped = img.copyFlip(product, direction: img.FlipDirection.vertical);

    // Only the top third of the mirrored copy is used: a full-height mirror
    // reads as a second product rather than a reflection.
    final visible = (flipped.height * 0.34).round();
    final gap = (size * 0.006).round();

    for (var y = 0; y < visible; y++) {
      final ty = originY + product.height + gap + y;
      if (ty < 0 || ty >= size) break;

      // Fade out with distance from the contact point.
      final fade = (1.0 - y / visible) * reflection;
      if (fade <= 0) continue;

      for (var x = 0; x < flipped.width; x++) {
        final tx = originX + x;
        if (tx < 0 || tx >= canvas.width) continue;

        final src = flipped.getPixel(x, y);
        final a = (src.a / 255.0) * fade;
        if (a <= 0.004) continue;

        final dst = canvas.getPixel(tx, ty);
        canvas.setPixelRgba(
          tx,
          ty,
          (src.r * a + dst.r * (1 - a)).round().clamp(0, 255),
          (src.g * a + dst.g * (1 - a)).round().clamp(0, 255),
          (src.b * a + dst.b * (1 - a)).round().clamp(0, 255),
          255,
        );
      }
    }
  }
}
