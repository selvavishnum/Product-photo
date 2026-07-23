from unittest.mock import patch

import pytest

from services.fal_client import FalAPIError
from services.virtual_tryon import try_on


def test_try_on_returns_url_from_fal_response():
    with patch(
        "services.virtual_tryon.run_queued",
        return_value={"image": {"url": "https://fal.media/files/tryon.png"}},
    ) as mock_run_queued:
        url = try_on(b"garment-bytes", "a gold necklace")

    assert url == "https://fal.media/files/tryon.png"
    called_model_id, called_payload = mock_run_queued.call_args.args
    assert called_model_id == "fal-ai/idm-vton"
    assert called_payload["garment_description"] == "a gold necklace"
    assert "human_image_url" not in called_payload


def test_try_on_includes_model_image_when_provided():
    with patch(
        "services.virtual_tryon.run_queued",
        return_value={"image": {"url": "https://fal.media/files/tryon.png"}},
    ) as mock_run_queued:
        try_on(b"garment-bytes", "a denim jacket", model_image_bytes=b"model-bytes")

    _, called_payload = mock_run_queued.call_args.args
    assert called_payload["human_image_url"].startswith("data:image/png;base64,")


def test_try_on_raises_on_unexpected_response_shape():
    with patch("services.virtual_tryon.run_queued", return_value={"unexpected": "shape"}):
        with pytest.raises(FalAPIError):
            try_on(b"garment-bytes", "a necklace")
