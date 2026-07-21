package com.productphoto.ai

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.productphoto.ai.ui.screens.ErrorScreen
import com.productphoto.ai.ui.screens.HomeScreen
import com.productphoto.ai.ui.screens.ProcessingScreen
import com.productphoto.ai.ui.screens.ResultScreen
import com.productphoto.ai.ui.theme.ProductPhotoAITheme
import com.productphoto.ai.viewmodel.EditStage
import com.productphoto.ai.viewmodel.PhotoEditViewModel

class MainActivity : ComponentActivity() {

    private val viewModel: PhotoEditViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ProductPhotoAITheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    ProductPhotoApp(viewModel)
                }
            }
        }
    }
}

@Composable
private fun ProductPhotoApp(viewModel: PhotoEditViewModel) {
    // Screens manage their own full-bleed layout, so the Scaffold's inner
    // padding (for a top/bottom bar we don't have yet) is intentionally unused.
    Scaffold { _ ->
        Surface(modifier = Modifier.fillMaxSize()) {
            when (viewModel.stage) {
                EditStage.PICKING -> HomeScreen(onPhotoPicked = viewModel::onPhotoPicked)
                EditStage.PROCESSING -> ProcessingScreen(sourceUri = viewModel.sourceUri)
                EditStage.RESULT -> viewModel.displayBitmap?.let { bitmap ->
                    ResultScreen(
                        displayBitmap = bitmap,
                        selectedBackdrop = viewModel.selectedBackdrop,
                        onSelectBackdrop = viewModel::selectBackdrop,
                        isUpscaling = viewModel.isUpscaling,
                        upscaleError = viewModel.upscaleError,
                        onUpscale = viewModel::upscale,
                        isSaving = viewModel.isSaving,
                        saveConfirmed = viewModel.saveConfirmed,
                        onSave = viewModel::saveResult,
                        onTryAnother = viewModel::reset,
                        removalDebugInfo = viewModel.removalDebugInfo,
                    )
                }
                EditStage.ERROR -> ErrorScreen(
                    message = viewModel.errorMessage,
                    onRetry = viewModel::reset,
                )
            }
        }
    }
}
