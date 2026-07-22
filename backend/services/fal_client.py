"""Thin client for fal.ai's REST API.

fal.ai has two call patterns: a synchronous endpoint for fast models, and a
queue-based endpoint (submit -> poll status -> fetch result) for slow ones
like diffusion inpainting. Both need an `Authorization: Key <FAL_KEY>`
header; FAL_KEY comes from your fal.ai dashboard (https://fal.ai/dashboard)
and must be set as an environment variable -- this client never hardcodes
a key.
"""

from __future__ import annotations

import base64
import os
import time

import httpx

FAL_SYNC_BASE = "https://fal.run"
FAL_QUEUE_BASE = "https://queue.fal.run"


class FalAPIError(Exception):
    """Raised for any fal.ai request/queue failure."""


def _headers() -> dict:
    fal_key = os.environ.get("FAL_KEY")
    if not fal_key:
        raise FalAPIError("FAL_KEY environment variable is not set")
    return {"Authorization": f"Key {fal_key}", "Content-Type": "application/json"}


def image_bytes_to_data_uri(image_bytes: bytes, content_type: str = "image/png") -> str:
    """fal.ai accepts image inputs as either a public URL or a base64 data URI.

    Data URIs avoid needing separate image hosting/storage for this app.
    """
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{content_type};base64,{encoded}"


def run_sync(model_id: str, payload: dict, timeout: float = 60.0) -> dict:
    """Calls a fast fal.ai model that responds directly (e.g. segmentation)."""
    with httpx.Client(timeout=timeout) as client:
        response = client.post(f"{FAL_SYNC_BASE}/{model_id}", headers=_headers(), json=payload)
        if response.status_code >= 400:
            raise FalAPIError(f"fal.ai {model_id} returned {response.status_code}: {response.text}")
        return response.json()


def run_queued(
    model_id: str,
    payload: dict,
    poll_interval: float = 2.0,
    max_wait_seconds: float = 180.0,
) -> dict:
    """Calls a slow fal.ai model (e.g. diffusion inpainting) via its queue API."""
    with httpx.Client(timeout=30.0) as client:
        submit = client.post(f"{FAL_QUEUE_BASE}/{model_id}", headers=_headers(), json=payload)
        if submit.status_code >= 400:
            raise FalAPIError(f"fal.ai {model_id} submit returned {submit.status_code}: {submit.text}")
        submitted = submit.json()

        status_url = submitted["status_url"]
        response_url = submitted["response_url"]

        waited = 0.0
        while waited < max_wait_seconds:
            status_resp = client.get(status_url, headers=_headers())
            if status_resp.status_code >= 400:
                raise FalAPIError(f"fal.ai status check failed: {status_resp.status_code}: {status_resp.text}")
            status = status_resp.json().get("status")

            if status == "COMPLETED":
                result_resp = client.get(response_url, headers=_headers())
                if result_resp.status_code >= 400:
                    raise FalAPIError(f"fal.ai result fetch failed: {result_resp.status_code}: {result_resp.text}")
                return result_resp.json()
            if status in ("FAILED", "CANCELLED"):
                raise FalAPIError(f"fal.ai job {status.lower()}: {status_resp.text}")

            time.sleep(poll_interval)
            waited += poll_interval

        raise FalAPIError(f"fal.ai job for {model_id} timed out after {max_wait_seconds}s")
