package com.productphoto.ai.data.network

import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part

/**
 * Talks to the app's own backend (see /backend), which runs the open-source
 * `rembg` model locally. No third-party AI API key is involved anywhere in
 * this path — the server holds no secrets to protect.
 */
interface BackgroundRemovalApi {
    @Multipart
    @POST("remove-background")
    suspend fun removeBackground(
        @Part image: MultipartBody.Part,
    ): Response<ResponseBody>
}
