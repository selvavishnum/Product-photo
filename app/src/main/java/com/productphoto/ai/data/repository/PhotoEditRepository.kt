package com.productphoto.ai.data.repository

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import com.productphoto.ai.data.network.NetworkModule
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

    suspend fun removeBackground(sourceUri: Uri): PhotoEditResult = withContext(Dispatchers.IO) {
        runCatching {
            val inputFile = copyUriToCacheFile(sourceUri)
            val response = api.removeBackground(buildImagePart(inputFile))
            inputFile.delete()
            decodeResponse(response)
        }.getOrElse { PhotoEditResult.Failure(it.message ?: "Unknown error") }
    }

    suspend fun upscale(sourceBitmap: Bitmap, scale: Int = 2): PhotoEditResult =
        withContext(Dispatchers.IO) {
            runCatching {
                val inputFile = bitmapToCacheFile(sourceBitmap)
                val response = api.upscale(buildImagePart(inputFile), scale)
                inputFile.delete()
                decodeResponse(response)
            }.getOrElse { PhotoEditResult.Failure(it.message ?: "Unknown error") }
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

    /** Retrofit needs a File/RequestBody, so stage the picked image in cache first. */
    private fun copyUriToCacheFile(uri: Uri): File {
        val outFile = File.createTempFile("upload", ".jpg", appContext.cacheDir)
        appContext.contentResolver.openInputStream(uri).use { input ->
            FileOutputStream(outFile).use { output ->
                requireNotNull(input) { "Could not open selected image" }.copyTo(output)
            }
        }
        return outFile
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
