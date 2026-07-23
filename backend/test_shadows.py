import io

from PIL import Image

from services.shadows import add_drop_shadow


def _fake_cutout_bytes(size=(40, 40)) -> bytes:
    """A fully opaque square on an otherwise transparent canvas."""
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    for x in range(10, 30):
        for y in range(10, 30):
            img.putpixel((x, y), (200, 30, 30, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_add_drop_shadow_pads_canvas_larger_than_source():
    result = add_drop_shadow(_fake_cutout_bytes(), blur_radius=10)
    result_img = Image.open(io.BytesIO(result))
    assert result_img.size[0] > 40
    assert result_img.size[1] > 40


def test_add_drop_shadow_keeps_subject_opaque():
    result = add_drop_shadow(_fake_cutout_bytes(), blur_radius=10)
    result_img = Image.open(io.BytesIO(result)).convert("RGBA")
    pad = 20  # blur_radius * 2
    # Center of the original opaque square, now offset by the padding.
    center_pixel = result_img.getpixel((pad + 20, pad + 20))
    assert center_pixel[3] == 255  # fully opaque, unblurred subject


def test_add_drop_shadow_adds_shadow_pixels_below_subject():
    result = add_drop_shadow(
        _fake_cutout_bytes(), offset=(12, 24), blur_radius=10, shadow_opacity=110
    )
    result_img = Image.open(io.BytesIO(result)).convert("RGBA")
    pad = 20
    # Below-right of the subject (in the shadow's offset direction), outside
    # the original opaque square -- should now have semi-transparent dark
    # shadow pixels that didn't exist in the source.
    shadow_pixel = result_img.getpixel((pad + 25, pad + 45))
    assert shadow_pixel[3] > 0
