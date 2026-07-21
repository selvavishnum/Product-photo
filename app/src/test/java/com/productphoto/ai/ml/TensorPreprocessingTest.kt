package com.productphoto.ai.ml

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Reference values below were computed directly from rembg's own numpy code
 * (rembg.sessions.base.BaseSession.normalize and the U2netpSession.predict
 * min-max mask logic), not guessed -- see the PR description for the exact
 * Python snippet used. Float32 (Kotlin) vs float64 (numpy) rounding means
 * exact equality isn't expected; a tight delta confirms the algorithm matches.
 */
class TensorPreprocessingTest {

    @Test
    fun `toChwTensor matches rembg's normalize() for a known 2x2 image`() {
        val pixels = arrayOf(
            intArrayOf(10, 200, 50),
            intArrayOf(255, 0, 128),
            intArrayOf(0, 0, 0),
            intArrayOf(128, 128, 128),
        )

        val tensor = toChwTensor(pixels, size = 2)

        val expected = floatArrayOf(
            -1.9466563918143676f, 2.2489082969432315f, -2.1179039301310043f, 0.0740645603219454f,
            1.4656862745098038f, -2.0357142857142856f, -2.0357142857142856f, 0.20518207282913153f,
            -0.9329847494553378f, 0.42649237472766865f, -1.8044444444444445f, 0.42649237472766865f,
        )

        assertEquals(expected.size, tensor.size)
        for (i in expected.indices) {
            assertEquals("mismatch at index $i", expected[i], tensor[i], 1e-4f)
        }
    }

    @Test
    fun `predictionToMaskBytes matches rembg's min-max mask normalization`() {
        val prediction = floatArrayOf(0.2f, 5.0f, -1.0f, 3.0f)

        val mask = predictionToMaskBytes(prediction)

        // rembg's own computation uses float64; ours uses float32 (matches the
        // model's actual output precision). A value can land within ~1e-7 of an
        // exact integer boundary (50.999997 vs 51.0), where truncation flips by
        // one -- invisible in an 8-bit alpha channel, so allow +/-1 here rather
        // than requiring bit-exact equality across float precisions.
        val expected = intArrayOf(50, 255, 0, 170)
        for (i in expected.indices) {
            assertEquals("mask[$i] off by more than 1", expected[i].toDouble(), mask[i].toDouble(), 1.0)
        }
    }

    @Test
    fun `predictionToMaskBytes handles a flat (zero-range) prediction without dividing by zero`() {
        val prediction = floatArrayOf(0.5f, 0.5f, 0.5f)

        val mask = predictionToMaskBytes(prediction)

        // No crash, and a flat input has no signal to separate foreground from
        // background -- every pixel ends up at the same (low) alpha.
        assertEquals(3, mask.size)
        assertEquals(mask[0], mask[1])
        assertEquals(mask[1], mask[2])
    }
}
