"""Cut a page photo into a top and a bottom half at the blankest row near the middle.

Used when Gemini refuses a whole page as recitation of published text: two shorter
transcriptions are far less likely to match a long published span. Cutting on the
blankest row keeps every text line whole in exactly one half.
"""

from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

SPLIT_MIME = "image/jpeg"
_SEARCH_BAND = (0.35, 0.65)  # only cut inside the middle 30% so both halves carry real text
_MIN_HEIGHT_PX = 4
_JPEG_QUALITY = 92


def split_page_horizontally(image: bytes) -> tuple[bytes, bytes] | None:
    """Return (top, bottom) as JPEG bytes, or None when the bytes cannot be decoded or are too small to cut."""
    try:
        with Image.open(BytesIO(image)) as opened:
            # Phone photos often store rotation in EXIF only; cut what the reader actually sees.
            page = ImageOps.exif_transpose(opened).convert("RGB")
    except (UnidentifiedImageError, OSError):
        return None
    if page.height < _MIN_HEIGHT_PX:
        return None
    cut = _blankest_row(page)
    top = page.crop((0, 0, page.width, cut))
    bottom = page.crop((0, cut, page.width, page.height))
    return _encode_jpeg(top), _encode_jpeg(bottom)


def _blankest_row(page: Image.Image) -> int:
    start = int(page.height * _SEARCH_BAND[0])
    end = max(start + 1, int(page.height * _SEARCH_BAND[1]))
    band = page.convert("L").crop((0, start, page.width, end))
    # Averaging each row down to one pixel: the brightest row has the least ink, i.e. a gap between lines.
    row_means = band.resize((1, band.height), Image.Resampling.BOX).tobytes()  # mode "L": one byte per row
    return start + max(range(len(row_means)), key=row_means.__getitem__)


def _encode_jpeg(part: Image.Image) -> bytes:
    buffer = BytesIO()
    part.save(buffer, format="JPEG", quality=_JPEG_QUALITY)
    return buffer.getvalue()
