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
import java.io.File
import java.io.FileOutputStream

sealed interface BackgroundRemovalResult {
    data class Success(val bitmap: Bitmap) : BackgroundRemovalResult
    data class Failure(val message: String) : BackgroundRemovalResult
}

class BackgroundRemovalRepository(private val appContext: Context) {

    private val api = NetworkModule.backgroundRemovalApi

    suspend fun removeBackground(sourceUri: Uri): BackgroundRemovalResult =
        withContext(Dispatchers.IO) {
            try {
                val inputFile = copyUriToCacheFile(sourceUri)
                val requestBody = inputFile.asRequestBody("image/*".toMediaTypeOrNull())
                val part = MultipartBody.Part.createFormData("image", inputFile.name, requestBody)

                val response = api.removeBackground(part)
                inputFile.delete()

                if (!response.isSuccessful) {
                    return@withContext BackgroundRemovalResult.Failure(
                        "Server returned ${response.code()}"
                    )
                }

                val body = response.body()
                    ?: return@withContext BackgroundRemovalResult.Failure("Empty response")

                val bytes = body.bytes()
                val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    ?: return@withContext BackgroundRemovalResult.Failure("Could not decode image")

                BackgroundRemovalResult.Success(bitmap)
            } catch (e: Exception) {
                BackgroundRemovalResult.Failure(e.message ?: "Unknown error")
            }
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
