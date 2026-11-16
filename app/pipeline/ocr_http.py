"""HTTP call shared by the REST OCR fallbacks (Cloudflare, OpenRouter, Mistral): one POST, errors mapped to OcrError."""

import httpx

from app.pipeline.ocr_provider import OcrError

TIMEOUT_SECONDS = 120.0


async def post_json(
    url: str, api_key: str, body: dict, *, service: str, transport: httpx.AsyncBaseTransport | None = None
) -> httpx.Response:
    """POST `body` with a bearer key; returns the response only when the status is a success."""
    headers = {"Authorization": f"Bearer {api_key}", "User-Agent": "booksnap"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=transport) as client:
            response = await client.post(url, headers=headers, json=body)
    except httpx.HTTPError as exc:
        raise OcrError(f"Lỗi mạng khi gọi {service}: {exc}", retryable=True) from exc
    _raise_for_status(response, service)
    return response


def _raise_for_status(response: httpx.Response, service: str) -> None:
    code = response.status_code
    if code < 400:
        return
    if code == 429:
        # The body tells an account limit apart from a model throttled upstream for everyone.
        raise OcrError(f"Hết quota {service} tạm thời (429): {response.text[:200]}", retryable=True, quota=True)
    if code >= 500:
        raise OcrError(f"Lỗi {service} tạm thời ({code})", retryable=True)
    raise OcrError(f"Lỗi {service} ({code}): {response.text[:200]}", retryable=False)
