package com.productphoto.ai.ml

/**
 * Exact port of rembg's U2Net/U2Netp preprocessing
 * (rembg.sessions.base.BaseSession.normalize): scale every RGB pixel by the
 * *image's own max channel value* (not a fixed /255 -- this is how rembg
 * actually does it), then apply ImageNet mean/std normalization, then
 * rearrange HWC -> CHW for the model input.
 *
 * Pure math, no Android/Bitmap dependency, so it's unit-testable against
 * values computed directly from rembg's numpy code (see TensorPreprocessingTest).
 *
 * [pixels] holds `size * size` RGB triples in row-major order:
 * pixels[i] = [r, g, b], each 0-255.
 */
fun toChwTensor(
    pixels: Array<IntArray>,
    size: Int,
    mean: FloatArray = floatArrayOf(0.485f, 0.456f, 0.406f),
    std: FloatArray = floatArrayOf(0.229f, 0.224f, 0.225f),
): FloatArray {
    require(pixels.size == size * size) {
        "Expected ${size * size} pixels for a ${size}x$size image, got ${pixels.size}"
    }

    var maxVal = 1e-6f
    for (p in pixels) {
        for (c in 0..2) {
            if (p[c] > maxVal) maxVal = p[c].toFloat()
        }
    }

    val planeSize = size * size
    val tensor = FloatArray(3 * planeSize)
    for (i in pixels.indices) {
        for (c in 0..2) {
            val normalized = pixels[i][c] / maxVal
            tensor[c * planeSize + i] = (normalized - mean[c]) / std[c]
        }
    }
    return tensor
}

/**
 * Exact port of rembg's mask postprocessing: min-max normalize the raw model
 * output to [0, 1] (using this prediction's own min/max, same as rembg),
 * clip, scale to a 0-255 grayscale mask.
 */
fun predictionToMaskBytes(prediction: FloatArray): IntArray {
    val mi = prediction.min()
    val ma = prediction.max()
    val range = (ma - mi).let { if (it == 0f) 1e-6f else it }
    return IntArray(prediction.size) { i ->
        val normalized = ((prediction[i] - mi) / range).coerceIn(0f, 1f)
        (normalized * 255f).toInt().coerceIn(0, 255)
    }
}
