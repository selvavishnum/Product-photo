package com.productphoto.ai.viewmodel

import android.app.Application
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.productphoto.ai.data.repository.PhotoEditRepository
import com.productphoto.ai.data.repository.PhotoEditResult
import com.productphoto.ai.ui.backdrop.Backdrop
import com.productphoto.ai.util.compositeWithBackdrop
import kotlinx.coroutines.launch

enum class EditStage { PICKING, PROCESSING, RESULT, ERROR }

class PhotoEditViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = PhotoEditRepository(application.applicationContext)

    var stage by mutableStateOf(EditStage.PICKING)
        private set

    var sourceUri by mutableStateOf<Uri?>(null)
        private set

    /** The current background-removed result -- source of truth for backdrop compositing and upscale. */
    var resultBitmap by mutableStateOf<Bitmap?>(null)
        private set

    /** [resultBitmap] composited onto [selectedBackdrop] -- what the user sees and saves. */
    var displayBitmap by mutableStateOf<Bitmap?>(null)
        private set

    var selectedBackdrop by mutableStateOf(Backdrop.TRANSPARENT)
        private set

    var isUpscaling by mutableStateOf(false)
        private set

    var upscaleError by mutableStateOf<String?>(null)
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
                is PhotoEditResult.Success -> {
                    resultBitmap = result.bitmap
                    selectedBackdrop = Backdrop.TRANSPARENT
                    displayBitmap = result.bitmap
                    stage = EditStage.RESULT
                }
                is PhotoEditResult.Failure -> {
                    errorMessage = result.message
                    stage = EditStage.ERROR
                }
            }
        }
    }

    fun selectBackdrop(backdrop: Backdrop) {
        val source = resultBitmap ?: return
        selectedBackdrop = backdrop
        displayBitmap = compositeWithBackdrop(source, backdrop)
    }

    fun upscale() {
        val source = resultBitmap ?: return
        isUpscaling = true
        upscaleError = null
        viewModelScope.launch {
            when (val result = repository.upscale(source, scale = 2)) {
                is PhotoEditResult.Success -> {
                    resultBitmap = result.bitmap
                    displayBitmap = compositeWithBackdrop(result.bitmap, selectedBackdrop)
                }
                is PhotoEditResult.Failure -> {
                    upscaleError = result.message
                }
            }
            isUpscaling = false
        }
    }

    fun saveResult() {
        val bitmap = displayBitmap ?: return
        isSaving = true
        viewModelScope.launch {
            saveConfirmed = repository.saveToGallery(bitmap)
            isSaving = false
        }
    }

    fun reset() {
        sourceUri = null
        resultBitmap = null
        displayBitmap = null
        selectedBackdrop = Backdrop.TRANSPARENT
        errorMessage = null
        saveConfirmed = false
        stage = EditStage.PICKING
    }
}
