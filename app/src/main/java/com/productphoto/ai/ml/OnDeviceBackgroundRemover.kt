package com.productphoto.ai.ml

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import java.nio.FloatBuffer

private const val MODEL_INPUT_SIZE = 320

/**
 * Runs u2netp entirely on-device via ONNX Runtime Mobile -- no backend
 * needed for background removal at all. The preprocessing/postprocessing
 * math (toChwTensor/predictionToMaskBytes) is an exact, unit-tested port of
 * rembg's own u2netp session (see TensorPreprocessing.kt and its test);
 * this class is the Bitmap <-> ONNX Runtime glue around that math.
 *
 * Not exercised end to end on a real device/model in this codebase yet --
 * verify on hardware before relying on it. The ONNX Runtime API calls here
 * were checked against the real onnxruntime-1.27.0 jar's class files
 * (javap), not guessed from memory, but that's not a substitute for running
 * it against actual model output.
 */
class OnDeviceBackgroundRemover(context: Context) {

    private val downloader = ModelDownloader(context)
    private val environment = OrtEnvironment.getEnvironment()
    private var session: OrtSession? = null

    /** Blocking (network download on first call); run from a background dispatcher. */
    fun ensureModelReady() {
        if (!downloader.isModelReady()) {
            downloader.downloadModel()
        }
    }

    private fun getOrCreateSession(): OrtSession =
        session ?: environment.createSession(downloader.modelFile().absolutePath)
            .also { session = it }

    /** Blocking (model load + inference); run from a background dispatcher. */
    fun removeBackground(original: Bitmap): Bitmap {
        ensureModelReady()
        val ortSession = getOrCreateSession()

        val resized = Bitmap.createScaledBitmap(original, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, true)
        val tensorData = toChwTensor(extractPixels(resized), MODEL_INPUT_SIZE)
        val inputName = ortSession.inputNames.first()

        val prediction = OnnxTensor.createTensor(
            environment,
            FloatBuffer.wrap(tensorData),
            longArrayOf(1, 3, MODEL_INPUT_SIZE.toLong(), MODEL_INPUT_SIZE.toLong()),
        ).use { inputTensor ->
            ortSession.run(mapOf(inputName to inputTensor)).use { result ->
                val outputBuffer = (result.get(0) as OnnxTensor).floatBuffer
                // Output is NCHW [1, C, 320, 320]; channel 0 is the first
                // 320*320 floats of the flat buffer (rembg takes the same
                // channel: ort_outs[0][:, 0, :, :]).
                val planeSize = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE
                FloatArray(planeSize) { outputBuffer.get(it) }
            }
        }

        val maskBytes = predictionToMaskBytes(prediction)
        return compositeWithMask(original, maskBytes, MODEL_INPUT_SIZE)
    }

    private fun extractPixels(bitmap: Bitmap): Array<IntArray> {
        val count = bitmap.width * bitmap.height
        val packed = IntArray(count)
        bitmap.getPixels(packed, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        return Array(count) { i ->
            val p = packed[i]
            intArrayOf(Color.red(p), Color.green(p), Color.blue(p))
        }
    }

    /**
     * Scales the small mask up to the original image size and applies it as
     * the alpha channel, keeping the original RGB. Deliberately avoids
     * Bitmap.Config.ALPHA_8 for the intermediate mask -- ARGB_8888 is the
     * uniformly well-supported path for createScaledBitmap across Android
     * versions, at the cost of a few hundred KB of throwaway memory.
     */
    private fun compositeWithMask(original: Bitmap, maskBytes: IntArray, maskSize: Int): Bitmap {
        val maskPixelsSmall = IntArray(maskBytes.size) { i -> Color.argb(maskBytes[i], 255, 255, 255) }
        val maskSmall = Bitmap.createBitmap(
            maskPixelsSmall, 0, maskSize, maskSize, maskSize, Bitmap.Config.ARGB_8888
        )
        val maskFullSize = Bitmap.createScaledBitmap(maskSmall, original.width, original.height, true)

        val pixelCount = original.width * original.height
        val origPixels = IntArray(pixelCount)
        original.getPixels(origPixels, 0, original.width, 0, 0, original.width, original.height)
        val maskPixels = IntArray(pixelCount)
        maskFullSize.getPixels(maskPixels, 0, original.width, 0, 0, original.width, original.height)

        val outPixels = IntArray(pixelCount) { i ->
            val alpha = Color.alpha(maskPixels[i])
            val orig = origPixels[i]
            Color.argb(alpha, Color.red(orig), Color.green(orig), Color.blue(orig))
        }

        val output = Bitmap.createBitmap(original.width, original.height, Bitmap.Config.ARGB_8888)
        output.setPixels(outPixels, 0, original.width, 0, 0, original.width, original.height)
        return output
    }
}
