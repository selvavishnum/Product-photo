package com.productphoto.ai.data.network

import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Query

/**
 * Talks to the app's own backend (see /backend). No third-party AI API key
 * is involved anywhere in this path — the server holds no secrets to protect.
 */
interface PhotoEditApi {
    /**
     * The backend's rembg-based endpoint still exists and is still tested
     * (see backend/test_main.py), but PhotoEditRepository.removeBackground()
     * no longer calls it -- background removal moved on-device (see
     * ml/OnDeviceBackgroundRemover.kt), so this method is currently unused by
     * the app. Left in place rather than deleted since the backend endpoint
     * itself is still valid and this wasn't a decision to remove it.
     */
    @Multipart
    @POST("remove-background")
    suspend fun removeBackground(
        @Part image: MultipartBody.Part,
    ): Response<ResponseBody>

    @Multipart
    @POST("upscale")
    suspend fun upscale(
        @Part image: MultipartBody.Part,
        @Query("scale") scale: Int = 2,
    ): Response<ResponseBody>
}
