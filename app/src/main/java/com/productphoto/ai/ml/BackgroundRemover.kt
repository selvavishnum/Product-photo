package com.productphoto.ai.ml

import android.graphics.Bitmap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import kotlinx.coroutines.tasks.await

/**
 * On-device cutout via Google ML Kit's Subject Segmentation. Google's Play
 * Services deliver and run the model, so there's no model file for this app
 * to download/verify itself, and no backend/server involved at all.
 */
class BackgroundRemover {

    private val segmenter = SubjectSegmentation.getClient(
        SubjectSegmenterOptions.Builder()
            .enableForegroundBitmap()
            .build()
    )

    suspend fun removeBackground(source: Bitmap): Bitmap {
        val result = segmenter.process(InputImage.fromBitmap(source, 0)).await()
        return result.foregroundBitmap ?: error("No subject detected in this photo")
    }
}
