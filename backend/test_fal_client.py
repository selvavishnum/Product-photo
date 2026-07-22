from unittest.mock import MagicMock, patch

import pytest

from services.fal_client import (
    FalAPIError,
    _headers,
    image_bytes_to_data_uri,
    run_queued,
    run_sync,
)


def _mock_response(status_code=200, json_data=None, text=""):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_data or {}
    resp.text = text
    return resp


def test_image_bytes_to_data_uri_format():
    uri = image_bytes_to_data_uri(b"hello", "image/png")
    assert uri.startswith("data:image/png;base64,")


def test_headers_requires_fal_key(monkeypatch):
    monkeypatch.delenv("FAL_KEY", raising=False)
    with pytest.raises(FalAPIError):
        _headers()


def test_headers_includes_fal_key(monkeypatch):
    monkeypatch.setenv("FAL_KEY", "test-key")
    headers = _headers()
    assert headers["Authorization"] == "Key test-key"


def test_run_sync_returns_json(monkeypatch):
    monkeypatch.setenv("FAL_KEY", "test-key")
    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.post.return_value = _mock_response(200, {"image": {"url": "https://x/cutout.png"}})

    with patch("services.fal_client.httpx.Client", return_value=mock_client):
        result = run_sync("fal-ai/birefnet", {"image_url": "data:..."})

    assert result == {"image": {"url": "https://x/cutout.png"}}


def test_run_sync_raises_on_http_error(monkeypatch):
    monkeypatch.setenv("FAL_KEY", "test-key")
    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.post.return_value = _mock_response(500, text="server error")

    with patch("services.fal_client.httpx.Client", return_value=mock_client):
        with pytest.raises(FalAPIError):
            run_sync("fal-ai/birefnet", {})


def test_run_queued_polls_until_completed(monkeypatch):
    monkeypatch.setenv("FAL_KEY", "test-key")
    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.post.return_value = _mock_response(
        200, {"status_url": "https://x/status", "response_url": "https://x/result"}
    )
    mock_client.get.side_effect = [
        _mock_response(200, {"status": "IN_PROGRESS"}),
        _mock_response(200, {"status": "COMPLETED"}),
        _mock_response(200, {"images": [{"url": "https://x/final.png"}]}),
    ]

    with patch("services.fal_client.httpx.Client", return_value=mock_client), patch(
        "services.fal_client.time.sleep"
    ):
        result = run_queued("fal-ai/flux/dev/image-to-image", {}, poll_interval=0)

    assert result == {"images": [{"url": "https://x/final.png"}]}


def test_run_queued_raises_on_failed_status(monkeypatch):
    monkeypatch.setenv("FAL_KEY", "test-key")
    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.post.return_value = _mock_response(
        200, {"status_url": "https://x/status", "response_url": "https://x/result"}
    )
    mock_client.get.return_value = _mock_response(200, {"status": "FAILED"})

    with patch("services.fal_client.httpx.Client", return_value=mock_client), patch(
        "services.fal_client.time.sleep"
    ):
        with pytest.raises(FalAPIError):
            run_queued("fal-ai/flux/dev/image-to-image", {}, poll_interval=0)
