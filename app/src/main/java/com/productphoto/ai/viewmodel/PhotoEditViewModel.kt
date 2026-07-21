package com.productphoto.ai.viewmodel

import android.app.Application
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.productphoto.ai.data.repository.BackgroundRemovalRepository
import com.productphoto.ai.data.repository.BackgroundRemovalResult
import kotlinx.coroutines.launch

enum class EditStage { PICKING, PROCESSING, RESULT, ERROR }

class PhotoEditViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = BackgroundRemovalRepository(application.applicationContext)

    var stage by mutableStateOf(EditStage.PICKING)
        private set

    var sourceUri by mutableStateOf<Uri?>(null)
        private set

    var resultBitmap by mutableStateOf<Bitmap?>(null)
        private set

    var errorMessage by mutableStateOf<String?>(null)
        private set

    var isSaving by mutableStateOf(false)
        private set

    var saveConfirmed by mutableStateOf(false)
        private set

    fun onPhotoPicked(uri: Uri) {
        sourceUri = uri
        stage = EditStage.PROCESSING
        viewModelScope.launch {
            when (val result = repository.removeBackground(uri)) {
                is BackgroundRemovalResult.Success -> {
                    resultBitmap = result.bitmap
                    stage = EditStage.RESULT
                }
                is BackgroundRemovalResult.Failure -> {
                    errorMessage = result.message
                    stage = EditStage.ERROR
                }
            }
        }
    }

    fun saveResult() {
        val bitmap = resultBitmap ?: return
        isSaving = true
        viewModelScope.launch {
            saveConfirmed = repository.saveToGallery(bitmap)
            isSaving = false
        }
    }

    fun reset() {
        sourceUri = null
        resultBitmap = null
        errorMessage = null
        saveConfirmed = false
        stage = EditStage.PICKING
    }
}
