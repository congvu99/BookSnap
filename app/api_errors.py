"""Uniform error body for every /api response: {"error": {"code", "message", "field"}}."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, field: str | None = None, headers: dict | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.field = field
        self.headers = headers


def _body(code: str, message: str, field: str | None = None) -> dict:
    return {"error": {"code": code, "message": message, "field": field}}


def not_found(what: str = "Không tìm thấy") -> ApiError:
    return ApiError(404, "not_found", what)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(_body(exc.code, exc.message, exc.field), status_code=exc.status, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        loc = [str(p) for p in first.get("loc", ()) if p not in ("body", "query", "path", "form")]
        return JSONResponse(
            _body("invalid_request", "Dữ liệu không hợp lệ", loc[-1] if loc else None), status_code=400
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed", 413: "request_too_large"}.get(
            exc.status_code, "http_error"
        )
        message = "Dữ liệu không hợp lệ" if exc.status_code == 400 else str(exc.detail)
        if exc.status_code == 400:
            code = "invalid_request"
        return JSONResponse(_body(code, message), status_code=exc.status_code, headers=exc.headers)
