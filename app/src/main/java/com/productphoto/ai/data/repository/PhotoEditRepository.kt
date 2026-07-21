package com.productphoto.ai.data.repository

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import com.productphoto.ai.data.network.NetworkModule
import com.productphoto.ai.ml.OnDeviceBackgroundRemover
import com.productphoto.ai.ml.RemovalDebugInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.ResponseBody
import retrofit2.Response
import java.io.File
import java.io.FileOutputStream

sealed interface PhotoEditResult {
    data class Success(val bitmap: Bitmap) : PhotoEditResult
    data class Failure(val message: String) : PhotoEditResult
}

class PhotoEditRepository(private val appContext: Context) {

    private val api = NetworkModule.photoEditApi
    private val onDeviceRemover = OnDeviceBackgroundRemover(appContext)

    /** TODO: remove alongside RemovalDebugInfo once the on-device removal bug is fixed. */
    val lastRemovalDebugInfo: RemovalDebugInfo?
        get() = onDeviceRemover.lastDebugInfo

    /**
     * Runs entirely on-device (see ml/OnDeviceBackgroundRemover.kt) -- no
     * backend needed for this feature. Decode and the one-time model
     * download are I/O, dispatched on Dispatchers.IO; only the actual model
     * inference is CPU-bound and dispatched on Dispatchers.Default. Calling
     * ensureModelReady() here (not just inside removeBackground()) means
     * that by the time removeBackground() runs on Default, the model is
     * already verified and its own internal ensureModelReady() check is a
     * cheap in-memory no-op -- so a first-run download never blocks
     * Default's small, fixed-size thread pool.
     */
    suspend fun removeBackground(sourceUri: Uri): PhotoEditResult = runCatching {
        val bitmap = withContext(Dispatchers.IO) { decodeUri(sourceUri) }
        withContext(Dispatchers.IO) { onDeviceRemover.ensureModelReady() }
        val result = withContext(Dispatchers.Default) { onDeviceRemover.removeBackground(bitmap) }
        PhotoEditResult.Success(result)
    }.getOrElse { PhotoEditResult.Failure(it.message ?: "Unknown error") }

    suspend fun upscale(sourceBitmap: Bitmap, scale: Int = 2): PhotoEditResult =
        withContext(Dispatchers.IO) {
            runCatching {
                val inputFile = bitmapToCacheFile(sourceBitmap)
                val response = api.upscale(buildImagePart(inputFile), scale)
                inputFile.delete()
                decodeResponse(response)
            }.getOrElse { PhotoEditResult.Failure(it.message ?: "Unknown error") }
        }

    /**
     * Downsamples unusually large images before decoding to bound peak
     * memory, while preserving full resolution for ordinary phone-camera
     * photos (a 12MP 4032x3024 shot stays well under this cap). 4096 is
     * chosen to only kick in for genuinely oversized sources (e.g. document
     * scans), not to silently cap ordinary "marketplace-ready" photo quality.
     */
    private fun decodeUri(uri: Uri): Bitmap {
        val maxDimension = 4096
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        appContext.contentResolver.openInputStream(uri).use { stream ->
            requireNotNull(stream) { "Could not open selected image" }
            BitmapFactory.decodeStream(stream, null, bounds)
        }

        var sampleSize = 1
        while (bounds.outWidth / sampleSize > maxDimension || bounds.outHeight / sampleSize > maxDimension) {
            sampleSize *= 2
        }

        val decodeOptions = BitmapFactory.Options().apply { inSampleSize = sampleSize }
        return appContext.contentResolver.openInputStream(uri).use { stream ->
            requireNotNull(stream) { "Could not open selected image" }
            requireNotNull(BitmapFactory.decodeStream(stream, null, decodeOptions)) {
                "Could not decode selected image"
            }
        }
    }

    private fun decodeResponse(response: Response<ResponseBody>): PhotoEditResult {
        if (!response.isSuccessful) {
            return PhotoEditResult.Failure("Server returned ${response.code()}")
        }
        val body = response.body() ?: return PhotoEditResult.Failure("Empty response")
        val bytes = body.bytes()
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            ?: return PhotoEditResult.Failure("Could not decode image")
        return PhotoEditResult.Success(bitmap)
    }

    private fun buildImagePart(file: File): MultipartBody.Part {
        val requestBody = file.asRequestBody("image/*".toMediaTypeOrNull())
        return MultipartBody.Part.createFormData("image", file.name, requestBody)
    }

    private fun bitmapToCacheFile(bitmap: Bitmap): File {
        val outFile = File.createTempFile("upscale-source", ".png", appContext.cacheDir)
        FileOutputStream(outFile).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return outFile
    }

    /** minSdk is 29+, so MediaStore's scoped-storage insert works with no storage permission needed. */
    suspend fun saveToGallery(bitmap: Bitmap): Boolean = withContext(Dispatchers.IO) {
        try {
            val filename = "ProductPhotoAI_${System.currentTimeMillis()}.png"
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, filename)
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES)
            }
            val uri = appContext.contentResolver.insert(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values
            ) ?: return@withContext false
            appContext.contentResolver.openOutputStream(uri).use { out ->
                requireNotNull(out).let { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
            true
        } catch (e: Exception) {
            false
        }
    }
}
