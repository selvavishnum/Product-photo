import io
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

import main

client = TestClient(main.app)


def _fake_png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (10, 10), (0, 0, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_remove_background_returns_png():
    source = io.BytesIO()
    Image.new("RGB", (50, 50), (200, 30, 30)).save(source, format="JPEG")
    source.seek(0)

    with patch("main.remove", return_value=_fake_png_bytes()) as mock_remove:
        response = client.post(
            "/remove-background",
            files={"image": ("product.jpg", source, "image/jpeg")},
        )

    assert mock_remove.called
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    result = Image.open(io.BytesIO(response.content))
    assert result.mode == "RGBA"


def test_rejects_non_image_upload():
    response = client.post(
        "/remove-background",
        files={"image": ("not-an-image.txt", b"hello world", "text/plain")},
    )
    assert response.status_code == 400


def test_rejects_empty_file():
    response = client.post(
        "/remove-background",
        files={"image": ("empty.jpg", b"", "image/jpeg")},
    )
    assert response.status_code == 400


def test_upscale_returns_larger_sharpened_image():
    # No mocking here -- upscale_image() is classical resampling, not a
    # downloaded model, so this exercises the real code path end to end.
    source = io.BytesIO()
    Image.new("RGB", (40, 30), (10, 120, 200)).save(source, format="PNG")
    source.seek(0)

    response = client.post(
        "/upscale",
        files={"image": ("product.png", source, "image/png")},
        params={"scale": 3},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    result = Image.open(io.BytesIO(response.content))
    assert result.size == (120, 90)


def test_upscale_default_scale_is_2x():
    source = io.BytesIO()
    Image.new("RGB", (20, 20), (5, 5, 5)).save(source, format="PNG")
    source.seek(0)

    response = client.post(
        "/upscale", files={"image": ("product.png", source, "image/png")}
    )

    assert response.status_code == 200
    result = Image.open(io.BytesIO(response.content))
    assert result.size == (40, 40)


def test_upscale_rejects_invalid_scale():
    source = io.BytesIO()
    Image.new("RGB", (10, 10), (0, 0, 0)).save(source, format="PNG")
    source.seek(0)

    response = client.post(
        "/upscale",
        files={"image": ("product.png", source, "image/png")},
        params={"scale": 10},
    )

    assert response.status_code == 400


def test_upscale_rejects_non_image_upload():
    response = client.post(
        "/upscale",
        files={"image": ("not-an-image.txt", b"hello world", "text/plain")},
    )
    assert response.status_code == 400
