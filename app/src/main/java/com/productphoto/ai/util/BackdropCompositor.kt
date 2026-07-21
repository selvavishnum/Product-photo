package com.productphoto.ai.util

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import androidx.compose.ui.graphics.toArgb
import com.productphoto.ai.ui.backdrop.Backdrop
import kotlin.math.max

/**
 * Draws [foreground] (a background-removed, transparent PNG bitmap) onto a
 * square canvas filled with [backdrop]'s gradient. Pure Canvas drawing --
 * no model, no network, runs on the phone's own CPU in milliseconds.
 */
fun compositeWithBackdrop(foreground: Bitmap, backdrop: Backdrop): Bitmap {
    if (backdrop == Backdrop.TRANSPARENT) return foreground

    val size = max(foreground.width, foreground.height)
    val output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(output)

    val gradientPaint = Paint().apply {
        shader = LinearGradient(
            0f, 0f, 0f, size.toFloat(),
            backdrop.colors.map { it.toArgb() }.toIntArray(),
            null,
            Shader.TileMode.CLAMP,
        )
    }
    canvas.drawRect(0f, 0f, size.toFloat(), size.toFloat(), gradientPaint)

    // Fit the product within 80% of the canvas, centered, aspect preserved.
    val scale = (size * 0.8f) / max(foreground.width, foreground.height)
    val fgWidth = foreground.width * scale
    val fgHeight = foreground.height * scale
    val left = (size - fgWidth) / 2f
    val top = (size - fgHeight) / 2f
    val destRect = RectF(left, top, left + fgWidth, top + fgHeight)

    val imagePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    canvas.drawBitmap(foreground, null, destRect, imagePaint)

    return output
}
