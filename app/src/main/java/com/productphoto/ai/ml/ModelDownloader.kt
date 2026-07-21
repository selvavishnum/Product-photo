package com.productphoto.ai.ml

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

private const val MODEL_URL =
    "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"
private const val MODEL_MD5 = "8e83ca70e441ab06c318d82300c84806"
private const val MODEL_FILENAME = "u2netp.onnx"

/**
 * Downloads the u2netp ONNX model (~4.7MB) to app-private storage on first
 * use, verifying it against rembg's own published checksum. Same model and
 * URL rembg uses server-side (see backend/main.py) -- this just runs
 * inference on the phone instead of a backend, so background removal needs
 * no server at all.
 */
class ModelDownloader(context: Context) {

    private val filesDir = context.filesDir

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build()

    fun modelFile(): File = File(filesDir, MODEL_FILENAME)

    fun isModelReady(): Boolean {
        val file = modelFile()
        return file.exists() && md5(file) == MODEL_MD5
    }

    /** Blocking; call from a background dispatcher. Throws on failure. */
    fun downloadModel() {
        val request = Request.Builder().url(MODEL_URL).build()
        client.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "Model download failed: HTTP ${response.code}" }
            val body = checkNotNull(response.body) { "Empty model download response" }

            val tempFile = File(filesDir, "$MODEL_FILENAME.tmp")
            tempFile.outputStream().use { out -> body.byteStream().copyTo(out) }

            val checksum = md5(tempFile)
            if (checksum != MODEL_MD5) {
                tempFile.delete()
                error("Downloaded model checksum mismatch (got $checksum, expected $MODEL_MD5)")
            }
            check(tempFile.renameTo(modelFile())) { "Could not finalize downloaded model file" }
        }
    }

    private fun md5(file: File): String {
        val digest = MessageDigest.getInstance("MD5")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            var read: Int
            while (input.read(buffer).also { read = it } != -1) {
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
