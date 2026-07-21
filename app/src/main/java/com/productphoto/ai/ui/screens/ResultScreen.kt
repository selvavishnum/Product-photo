package com.productphoto.ai.ui.screens

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.productphoto.ai.R
import com.productphoto.ai.ml.RemovalDebugInfo
import com.productphoto.ai.ui.backdrop.Backdrop

@Composable
fun ResultScreen(
    displayBitmap: Bitmap,
    selectedBackdrop: Backdrop,
    onSelectBackdrop: (Backdrop) -> Unit,
    isUpscaling: Boolean,
    upscaleError: String?,
    onUpscale: () -> Unit,
    isSaving: Boolean,
    saveConfirmed: Boolean,
    onSave: () -> Unit,
    onTryAnother: () -> Unit,
    // TODO: remove once the on-device removal bug is fixed -- see RemovalDebugInfo.
    removalDebugInfo: RemovalDebugInfo? = null,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        // Neutral mid-tone backdrop makes a transparent (Original) result visible.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(320.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Color(0xFF334155)),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                bitmap = displayBitmap.asImageBitmap(),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
            )
            if (isUpscaling) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.4f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(stringResource(R.string.upscaling), color = Color.White)
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = stringResource(R.string.backdrop_label),
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(8.dp))
        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(Backdrop.selectable) { backdrop ->
                BackdropSwatch(
                    backdrop = backdrop,
                    isSelected = backdrop == selectedBackdrop,
                    onClick = { onSelectBackdrop(backdrop) },
                )
            }
        }

        Spacer(modifier = Modifier.height(20.dp))

        if (removalDebugInfo != null) {
            // TODO: remove this whole block once the on-device removal bug is fixed.
            Text(
                text = "DEBUG (temporary) -- screenshot this and send it back:\n" +
                    "model file: ${removalDebugInfo.modelFileBytes} bytes\n" +
                    "input tensor min/max: %.3f / %.3f\n".format(
                        removalDebugInfo.tensorMin, removalDebugInfo.tensorMax
                    ) +
                    "raw prediction min/max/mean: %.4f / %.4f / %.4f\n".format(
                        removalDebugInfo.predictionMin,
                        removalDebugInfo.predictionMax,
                        removalDebugInfo.predictionMean,
                    ) +
                    "final mask (0-255) min/max/mean: ${removalDebugInfo.maskMin} / " +
                    "${removalDebugInfo.maskMax} / %.1f".format(removalDebugInfo.maskMean),
                style = MaterialTheme.typography.bodyMedium,
                color = Color(0xFFFACC15),
            )
            Spacer(modifier = Modifier.height(8.dp))
        }

        if (upscaleError != null) {
            Text(
                text = upscaleError,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(modifier = Modifier.height(8.dp))
        }

        if (saveConfirmed) {
            Text(
                text = stringResource(R.string.saved_confirmation),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(modifier = Modifier.height(12.dp))
        }

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = onTryAnother) {
                Text(text = stringResource(R.string.try_again))
            }
            OutlinedButton(onClick = onUpscale, enabled = !isUpscaling) {
                Text(text = stringResource(R.string.upscale))
            }
            Button(onClick = onSave, enabled = !isSaving) {
                if (isSaving) {
                    CircularProgressIndicator(
                        modifier = Modifier.height(18.dp),
                        strokeWidth = 2.dp,
                    )
                } else {
                    Text(text = stringResource(R.string.save_result))
                }
            }
        }
    }
}

@Composable
private fun BackdropSwatch(backdrop: Backdrop, isSelected: Boolean, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        val swatchBrush = if (backdrop == Backdrop.TRANSPARENT) {
            Brush.linearGradient(listOf(Color(0xFF64748B), Color(0xFF334155)))
        } else {
            Brush.verticalGradient(backdrop.colors)
        }
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(CircleShape)
                .background(swatchBrush)
                .border(
                    width = if (isSelected) 3.dp else 1.dp,
                    color = if (isSelected) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        Color.White.copy(alpha = 0.4f)
                    },
                    shape = CircleShape,
                )
                .clickable(onClick = onClick),
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(text = backdrop.label, style = MaterialTheme.typography.bodyMedium)
    }
}
