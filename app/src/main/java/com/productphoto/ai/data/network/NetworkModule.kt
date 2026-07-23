package com.productphoto.ai.data.network

import com.productphoto.ai.BuildConfig
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

/**
 * Simple manual DI: one shared client, built once. Swap for Hilt if the app
 * grows more than a couple of screens/repositories.
 */
object NetworkModule {

    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = if (BuildConfig.DEBUG) {
            HttpLoggingInterceptor.Level.BASIC
        } else {
            HttpLoggingInterceptor.Level.NONE
        }
    }

    /** Public so callers can download fal.ai-hosted result URLs directly (a
     * different host than [BuildConfig.BACKEND_BASE_URL], so it can't go
     * through [photoEditApi]'s fixed-base-URL Retrofit instance). */
    val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(loggingInterceptor)
        // Render's free tier sleeps after 15 min idle and can take up to
        // ~60s to wake a cold container back up before it even answers.
        .connectTimeout(60, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS) // cold start + image processing
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    private val retrofit: Retrofit = Retrofit.Builder()
        .baseUrl(BuildConfig.BACKEND_BASE_URL)
        .client(okHttpClient)
        .addConverterFactory(GsonConverterFactory.create())
        .build()

    val photoEditApi: PhotoEditApi by lazy {
        retrofit.create(PhotoEditApi::class.java)
    }
}
