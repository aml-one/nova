import "package:flutter/material.dart";
import "package:google_fonts/google_fonts.dart";

/// Dark, glassy chrome aligned with Nova WebUI blues.
abstract final class NovaTheme {
  static const Color canvas = Color(0xFF070A12);
  static const Color surface = Color(0xFF12182A);
  static const Color surface2 = Color(0xFF1A2238);
  static const Color accent = Color(0xFF42B9FF);
  static const Color accentDeep = Color(0xFF2B7FFF);

  static ThemeData dark() {
    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: ColorScheme.dark(
        primary: accent,
        secondary: accentDeep,
        surface: surface,
        onSurface: Colors.white.withValues(alpha: 0.92),
        onPrimary: Colors.black,
      ),
      scaffoldBackgroundColor: canvas,
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        centerTitle: true,
        scrolledUnderElevation: 0,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: surface.withValues(alpha: 0.55),
        indicatorColor: accent.withValues(alpha: 0.22),
        labelTextStyle: WidgetStateProperty.all(const TextStyle(fontSize: 12, fontWeight: FontWeight.w500)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface2.withValues(alpha: 0.65),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: accent, width: 1.2),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
    );
    return base.copyWith(
      textTheme: GoogleFonts.interTextTheme(base.textTheme).apply(
        bodyColor: Colors.white.withValues(alpha: 0.9),
        displayColor: Colors.white.withValues(alpha: 0.95),
      ),
    );
  }

  static List<BoxShadow> softGlow(Color c) => [
        BoxShadow(color: c.withValues(alpha: 0.22), blurRadius: 28, spreadRadius: -4),
      ];
}
