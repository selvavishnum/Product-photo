import 'package:flutter/material.dart';

/// The app's visual system.
///
/// Light and near-monochrome, matching the web app so the two do not look
/// like different products. The reason is the same in both: shop owners use
/// this on a phone, often outdoors in daylight, where a dark UI is the harder
/// one to read.
///
/// Colour is spent only where it carries meaning -- a selected answer, a
/// warning, a success -- so those read as signals rather than competing with
/// decoration.
class AppColors {
  /// Plain white, not off-white: anything tinted reads as "unfinished" next
  /// to the white surfaces sitting on it.
  static const page = Color(0xFFFFFFFF);

  /// Cards and inputs. A hair off the page so an edge is visible without a
  /// border doing all the work.
  static const surface = Color(0xFFF7F7F8);
  static const line = Color(0xFFE5E7EB);

  /// Near-black rather than pure black: #000 on #fff is harsher than it needs
  /// to be at body sizes.
  static const ink = Color(0xFF0A0A0A);
  static const muted = Color(0xFF6B7280);
  static const faint = Color(0xFF9CA3AF);

  /// The single accent, for progress and selection.
  static const brand = Color(0xFF4F46E5);
  static const brandSoft = Color(0xFFEEF2FF);

  static const success = Color(0xFF059669);
  static const successSoft = Color(0xFFECFDF5);
  static const warn = Color(0xFFB45309);
  static const warnSoft = Color(0xFFFFFBEB);
}

/// The app's ThemeData.
///
/// Deliberately limited to `colorScheme` and `scaffoldBackgroundColor`, with
/// no `appBarTheme`, `inputDecorationTheme` or `navigationBarTheme`. Those
/// slots are mid-migration in Flutter -- `AppBarTheme` and
/// `InputDecorationTheme` are becoming widgets with separate `...ThemeData`
/// companions -- so the accepted type depends on which stable the CI runner
/// happens to be on. This project has no local Flutter SDK to check against,
/// and a theme is not worth a build that fails on someone else's machine.
///
/// Widget-level styling instead: [appInput] for fields, and the buttons
/// below. Slightly more verbose, and it compiles on every version.
ThemeData buildAppTheme() {
  return ThemeData(
    useMaterial3: true,
    colorScheme: const ColorScheme.light(
      primary: AppColors.ink,
      onPrimary: Colors.white,
      secondary: AppColors.brand,
      surface: AppColors.page,
      onSurface: AppColors.ink,
      error: AppColors.warn,
    ),
    scaffoldBackgroundColor: AppColors.page,
  );
}

/// Shared field styling.
///
/// Tamil needs the extra vertical padding: its combining marks sit well above
/// and below the baseline and clip against a tight box.
InputDecoration appInput(String hint) {
  OutlineInputBorder border(Color color, double width) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: color, width: width),
      );

  return InputDecoration(
    hintText: hint,
    filled: true,
    fillColor: AppColors.surface,
    hintStyle: const TextStyle(color: AppColors.faint),
    contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
    border: border(AppColors.line, 1),
    enabledBorder: border(AppColors.line, 1),
    focusedBorder: border(AppColors.ink, 1.5),
  );
}

/// The one primary action per screen: a black pill.
///
/// Deliberately the only filled button in the app. When everything is filled,
/// nothing signals "press this", which is a primary button's entire job.
class PrimaryButton extends StatelessWidget {
  const PrimaryButton({
    super.key,
    required this.label,
    this.onPressed,
    this.busy = false,
    this.showArrow = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool busy;
  final bool showArrow;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton(
        onPressed: busy ? null : onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.ink,
          foregroundColor: Colors.white,
          disabledBackgroundColor: AppColors.ink.withValues(alpha: 0.2),
          // 48 minimum: this is used one-handed, often behind a counter.
          padding: const EdgeInsets.symmetric(vertical: 18),
          shape: const StadiumBorder(),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        ),
        child: busy
            ? const SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Colors.white,
                ),
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(label),
                  if (showArrow) ...[
                    const SizedBox(width: 10),
                    const Icon(Icons.arrow_forward, size: 18),
                  ],
                ],
              ),
      ),
    );
  }
}

/// Secondary action: outlined, never filled.
class SecondaryButton extends StatelessWidget {
  const SecondaryButton({
    super.key,
    required this.label,
    this.onPressed,
    this.busy = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: OutlinedButton(
        onPressed: busy ? null : onPressed,
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.ink,
          side: const BorderSide(color: AppColors.ink),
          padding: const EdgeInsets.symmetric(vertical: 18),
          shape: const StadiumBorder(),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        ),
        child: busy
            ? const SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : Text(label),
      ),
    );
  }
}

/// A tinted message. Colour is the meaning here, so the variants are named
/// after what they say rather than what they look like.
class Note extends StatelessWidget {
  const Note.info(this.text, {super.key})
      : background = AppColors.brandSoft,
        foreground = AppColors.ink;
  const Note.warning(this.text, {super.key})
      : background = AppColors.warnSoft,
        foreground = AppColors.warn;
  const Note.success(this.text, {super.key})
      : background = AppColors.successSoft,
        foreground = AppColors.success;

  final String text;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Text(
        text,
        style: TextStyle(color: foreground, height: 1.6, fontSize: 14),
      ),
    );
  }
}
