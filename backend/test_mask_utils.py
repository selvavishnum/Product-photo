import io

from PIL import Image

from services.mask_utils import alpha_to_mask


def test_alpha_to_mask_inverts_transparency():
    img = Image.new("RGBA", (2, 1), (0, 0, 0, 0))
    img.putpixel((0, 0), (255, 0, 0, 255))  # opaque product pixel
    img.putpixel((1, 0), (0, 0, 0, 0))  # transparent background pixel
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    mask_bytes = alpha_to_mask(buf.getvalue())
    mask = Image.open(io.BytesIO(mask_bytes))

    assert mask.mode == "L"
    assert mask.getpixel((0, 0)) == 0  # opaque product -> keep (black)
    assert mask.getpixel((1, 0)) == 255  # transparent background -> regenerate (white)
