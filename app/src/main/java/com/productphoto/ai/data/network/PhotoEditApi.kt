package com.productphoto.ai.data.network

import com.google.gson.annotations.SerializedName
import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Query

/** `/ai/upscale` returns a fal.ai-hosted URL as JSON, not raw image bytes. */
data class AiUpscaleResponse(@SerializedName("upscaled_url") val upscaledUrl: String)

/**
 * Talks to the app's own backend (see /backend): `rembg` for background
 * removal, classical Lanczos resample + unsharp mask for the free upscale.
 * `aiUpscale` is a separate, paid alternative (Real-ESRGAN via fal.ai) --
 * unlike everything else here, it costs money per call on the backend's
 * fal.ai account.
 */
interface PhotoEditApi {
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

    @Multipart
    @POST("ai/upscale")
    suspend fun aiUpscale(
        @Part image: MultipartBody.Part,
        @Query("scale") scale: Int = 2,
    ): Response<AiUpscaleResponse>
}
