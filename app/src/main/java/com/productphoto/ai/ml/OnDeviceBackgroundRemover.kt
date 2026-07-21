package com.productphoto.ai.ml

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.nio.FloatBuffer

private const val MODEL_INPUT_SIZE = 320

/**
 * Temporary diagnostic snapshot from the last removeBackground() call.
 * TODO: remove once the "nothing gets removed on real devices" bug (reported
 * against the first real-hardware test) is root-caused and fixed -- this
 * exists only so a user without adb/logcat access can screenshot real
 * numbers back instead of guessing blind from a photo of the result.
 *
 * Note on predictionMin/Max: a truly constant raw prediction (min == max)
 * would NOT explain "nothing gets removed" -- predictionToMaskBytes' zero-
 * range fallback makes that case fully TRANSPARENT (mask = 0 everywhere),
 * the opposite of the reported symptom. maskMin/Max/Mean below (the actual
 * post-normalization alpha values used for compositing) are the numbers
 * that actually explain what's visibly happening.
 */
data class RemovalDebugInfo(
    val modelFileBytes: Long,
    val tensorMin: Float,
    val tensorMax: Float,
    val predictionMin: Float,
    val predictionMax: Float,
    val predictionMean: Float,
    val maskMin: Int,
    val maskMax: Int,
    val maskMean: Float,
)

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

    /** Guards session creation and the one-time download/verify, since both
     * run on a shared mutable field and a shared on-disk file -- without
     * this, two overlapping calls (e.g. a fast double-tap before the UI
     * leaves the picker) could each download/verify concurrently and
     * corrupt the temp file, or each construct their own OrtSession and
     * leak one. */
    private val mutex = Mutex()
    private var session: OrtSession? = null

    @Volatile
    private var modelVerified = false

    var lastDebugInfo: RemovalDebugInfo? = null
        private set

    /**
     * Blocking network download on first-ever call; cheap (in-memory flag
     * check) on every call after. Call this on Dispatchers.IO, separately
     * from the CPU-bound removeBackground() call below -- that split is
     * what keeps a slow first-run download off the small, fixed-size
     * Dispatchers.Default thread pool.
     */
    suspend fun ensureModelReady() {
        if (modelVerified) return
        mutex.withLock {
            if (modelVerified) return@withLock
            if (!downloader.isModelReady()) {
                downloader.downloadModel()
            }
            modelVerified = true
        }
    }

    private suspend fun getOrCreateSession(): OrtSession = mutex.withLock {
        session ?: environment.createSession(downloader.modelFile().absolutePath)
            .also { session = it }
    }

    /**
     * CPU-bound; call on Dispatchers.Default. Safe to call without calling
     * ensureModelReady() first (it's called here too), but doing so lets the
     * caller control which dispatcher the download itself blocks on.
     */
    suspend fun removeBackground(originalIn: Bitmap): Bitmap {
        // Bitmap.Config.HARDWARE bitmaps throw on getPixels()/pixel access
        // (used both below and in compositeWithMask). The current caller
        // (PhotoEditRepository.decodeUri) never produces one, but nothing
        // enforces that for a future caller -- normalize once, up front,
        // instead of guarding every pixel-access call site separately.
        val original = if (originalIn.config == Bitmap.Config.HARDWARE) {
            originalIn.copy(Bitmap.Config.ARGB_8888, false)
        } else {
            originalIn
        }

        ensureModelReady()
        val ortSession = getOrCreateSession()

        val resized = Bitmap.createScaledBitmap(original, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, true)
        val tensorData = toChwTensor(extractPixels(resized), MODEL_INPUT_SIZE)
        resized.recycle()
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

        lastDebugInfo = RemovalDebugInfo(
            modelFileBytes = downloader.modelFile().length(),
            tensorMin = tensorData.min(),
            tensorMax = tensorData.max(),
            predictionMin = prediction.min(),
            predictionMax = prediction.max(),
            predictionMean = prediction.average().toFloat(),
            maskMin = maskBytes.min(),
            maskMax = maskBytes.max(),
            maskMean = maskBytes.average().toFloat(),
        )

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
     * the alpha channel via Canvas + PorterDuff.Mode.DST_IN, keeping the
     * original RGB. This is a hardware-accelerated single draw call, not a
     * manual per-pixel loop -- avoids several full-resolution IntArray
     * allocations (scales with the source image's resolution cap, see
     * PhotoEditRepository.decodeUri) that a naive getPixels/setPixels round
     * trip would need. (original is already guaranteed non-HARDWARE by the
     * check at the top of removeBackground().)
     */
    private fun compositeWithMask(original: Bitmap, maskBytes: IntArray, maskSize: Int): Bitmap {
        val maskPixelsSmall = IntArray(maskBytes.size) { i -> Color.argb(maskBytes[i], 255, 255, 255) }
        val maskSmall = Bitmap.createBitmap(
            maskPixelsSmall, 0, maskSize, maskSize, maskSize, Bitmap.Config.ARGB_8888
        )
        val maskFullSize = Bitmap.createScaledBitmap(maskSmall, original.width, original.height, true)
        maskSmall.recycle()

        val output = original.copy(Bitmap.Config.ARGB_8888, true)
        val canvas = Canvas(output)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
        }
        canvas.drawBitmap(maskFullSize, 0f, 0f, paint)
        maskFullSize.recycle()

        return output
    }
}
