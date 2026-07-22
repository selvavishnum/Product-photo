package com.productphoto.ai.ui.backdrop

import androidx.compose.ui.graphics.Color

/**
 * Studio-style backdrops composited on-device behind a background-removed
 * product photo. No AI model or network call involved -- pure Kotlin/Canvas
 * compositing, so it works entirely on the phone's own processor.
 *
 * Real photographic lifestyle backdrops (tabletop, kitchen, seasonal scenes)
 * need actual licensed photo assets this project doesn't have yet; these are
 * solid/gradient studio looks, which is what the Amazon-compliant and
 * studio-quality style options actually are anyway.
 */
enum class Backdrop(val label: String, val colors: List<Color>) {
    TRANSPARENT("Original", emptyList()),
    PURE_WHITE("Pure White", listOf(Color(0xFFFFFFFF), Color(0xFFF2F2F2))),
    STUDIO_GRAY("Studio Gray", listOf(Color(0xFFD9DCE1), Color(0xFF9AA1AC))),
    WARM_BEIGE("Warm Beige", listOf(Color(0xFFF3E5D3), Color(0xFFD9BE9C))),
    COOL_BLUE("Cool Blue", listOf(Color(0xFFDCEEFB), Color(0xFF7FB3D5))),
    STUDIO_BLACK("Studio Black", listOf(Color(0xFF3A3F44), Color(0xFF0F1113)));

    companion object {
        val selectable = entries
    }
}
