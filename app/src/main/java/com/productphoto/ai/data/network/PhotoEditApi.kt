package com.productphoto.ai.data.network

import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Query

/**
 * Talks to the app's own backend (see /backend) for Upscale: classical
 * Lanczos resample + unsharp mask. Background removal runs on-device (see
 * ml/BackgroundRemover.kt) and never reaches this API. No third-party AI API
 * key is involved anywhere in this path — the server holds no secrets to
 * protect.
 */
interface PhotoEditApi {
    @Multipart
    @POST("upscale")
    suspend fun upscale(
        @Part image: MultipartBody.Part,
        @Query("scale") scale: Int = 2,
    ): Response<ResponseBody>
}
