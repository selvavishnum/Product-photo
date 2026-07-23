from unittest.mock import patch

from services.upscale_ai import upscale_with_ai


def test_upscale_with_ai_returns_url_from_fal_response():
    with patch(
        "services.upscale_ai.run_sync",
        return_value={"image": {"url": "https://fal.media/files/upscaled.png"}},
    ) as mock_run_sync:
        url = upscale_with_ai(b"fake-image-bytes", scale=4, content_type="image/jpeg")

    assert url == "https://fal.media/files/upscaled.png"
    called_model_id, called_payload = mock_run_sync.call_args.args
    assert called_model_id == "fal-ai/real-esrgan"
    assert called_payload["scale"] == 4
    assert called_payload["image_url"].startswith("data:image/jpeg;base64,")


def test_upscale_with_ai_raises_on_unexpected_response_shape():
    from services.fal_client import FalAPIError

    with patch("services.upscale_ai.run_sync", return_value={"unexpected": "shape"}):
        try:
            upscale_with_ai(b"fake-image-bytes")
            assert False, "expected FalAPIError"
        except FalAPIError:
            pass
