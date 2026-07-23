import io
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

import main
from services.fal_client import FalAPIError

client = TestClient(main.app)


def _fake_png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (10, 10), (0, 0, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


def _fake_cutout_bytes() -> bytes:
    """A cutout with a fully opaque 'product' half and transparent half,
    so mask derivation from alpha has something real to invert."""
    img = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    for x in range(5):
        for y in range(10):
            img.putpixel((x, y), (255, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
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


def test_ai_themes_lists_expected_keys():
    response = client.get("/ai/themes")
    assert response.status_code == 200
    assert set(response.json()["themes"]) == {
        "marble_table",
        "luxury_podium",
        "nature_sunlight",
    }


def test_ai_remove_background_returns_cutout_url():
    source = io.BytesIO()
    Image.new("RGB", (50, 50), (200, 30, 30)).save(source, format="JPEG")
    source.seek(0)

    with patch(
        "main.background_removal.remove_background",
        return_value="https://fal.media/files/fake-cutout.png",
    ) as mock_remove:
        response = client.post(
            "/ai/remove-background",
            files={"image": ("product.jpg", source, "image/jpeg")},
        )

    assert mock_remove.called
    assert response.status_code == 200
    assert response.json() == {"cutout_url": "https://fal.media/files/fake-cutout.png"}


def test_ai_remove_background_propagates_fal_error_as_502():
    source = io.BytesIO()
    Image.new("RGB", (50, 50), (200, 30, 30)).save(source, format="JPEG")
    source.seek(0)

    with patch(
        "main.background_removal.remove_background",
        side_effect=FalAPIError("fal.ai birefnet returned 500"),
    ):
        response = client.post(
            "/ai/remove-background",
            files={"image": ("product.jpg", source, "image/jpeg")},
        )

    assert response.status_code == 502


def test_ai_generate_background_with_theme_key():
    source = io.BytesIO(_fake_cutout_bytes())

    with patch(
        "main.background_generation.generate_background",
        return_value="https://fal.media/files/fake-studio-shot.png",
    ) as mock_generate:
        response = client.post(
            "/ai/generate-background",
            files={"image": ("cutout.png", source, "image/png")},
            data={"theme_key": "marble_table"},
        )

    assert response.status_code == 200
    assert response.json() == {"generated_url": "https://fal.media/files/fake-studio-shot.png"}
    # The theme key should have been resolved to its prompt text before calling fal.ai.
    called_prompt = mock_generate.call_args.args[2]
    assert "marble table" in called_prompt


def test_ai_generate_background_with_custom_prompt_overrides_theme():
    source = io.BytesIO(_fake_cutout_bytes())

    with patch(
        "main.background_generation.generate_background",
        return_value="https://fal.media/files/fake-studio-shot.png",
    ) as mock_generate:
        response = client.post(
            "/ai/generate-background",
            files={"image": ("cutout.png", source, "image/png")},
            data={"theme_key": "marble_table", "prompt": "a custom neon backdrop"},
        )

    assert response.status_code == 200
    called_prompt = mock_generate.call_args.args[2]
    assert called_prompt == "a custom neon backdrop"


def test_ai_generate_background_requires_theme_or_prompt():
    source = io.BytesIO(_fake_cutout_bytes())

    response = client.post(
        "/ai/generate-background",
        files={"image": ("cutout.png", source, "image/png")},
    )

    assert response.status_code == 400


def test_ai_generate_background_propagates_fal_error_as_502():
    source = io.BytesIO(_fake_cutout_bytes())

    with patch(
        "main.background_generation.generate_background",
        side_effect=FalAPIError("fal.ai flux job failed"),
    ):
        response = client.post(
            "/ai/generate-background",
            files={"image": ("cutout.png", source, "image/png")},
            data={"theme_key": "luxury_podium"},
        )

    assert response.status_code == 502


def test_ai_upscale_returns_upscaled_url():
    source = io.BytesIO()
    Image.new("RGB", (20, 20), (10, 10, 10)).save(source, format="PNG")
    source.seek(0)

    with patch(
        "main.upscale_ai.upscale_with_ai",
        return_value="https://fal.media/files/upscaled.png",
    ) as mock_upscale:
        response = client.post(
            "/ai/upscale",
            files={"image": ("product.png", source, "image/png")},
            params={"scale": 3},
        )

    assert mock_upscale.called
    assert response.status_code == 200
    assert response.json() == {"upscaled_url": "https://fal.media/files/upscaled.png"}


def test_ai_upscale_rejects_invalid_scale():
    source = io.BytesIO()
    Image.new("RGB", (20, 20), (10, 10, 10)).save(source, format="PNG")
    source.seek(0)

    response = client.post(
        "/ai/upscale",
        files={"image": ("product.png", source, "image/png")},
        params={"scale": 10},
    )

    assert response.status_code == 400


def test_ai_upscale_propagates_fal_error_as_502():
    source = io.BytesIO()
    Image.new("RGB", (20, 20), (10, 10, 10)).save(source, format="PNG")
    source.seek(0)

    with patch(
        "main.upscale_ai.upscale_with_ai",
        side_effect=FalAPIError("fal.ai real-esrgan job failed"),
    ):
        response = client.post(
            "/ai/upscale",
            files={"image": ("product.png", source, "image/png")},
            params={"scale": 2},
        )

    assert response.status_code == 502
