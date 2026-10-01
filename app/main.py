import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from app.api import (
    account_routes,
    audio_routes,
    bookmarks_routes,
    books_routes,
    export_routes,
    pages_routes,
    profiles_routes,
    shelf_routes,
    topics_routes,
    usage_routes,
    voices_routes,
)
from app.api_errors import install_error_handlers
from app.app_context import AppContext
from app.auth import auth_routes
from app.config import Settings, get_settings
from app.db import Database
from app.pipeline.ocr_gemini import GeminiOcrProvider
from app.pipeline.tts_azure import AzureTtsProvider
from app.pipeline.tts_gemini import GeminiTtsProvider
from app.pipeline.worker import Worker
from app.request_size_limit import RequestSizeLimitMiddleware
from app.storage_health import data_dir_durability_error

log = logging.getLogger("app")

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


def _is_audio_path(path: str) -> bool:
    return path.startswith("/audio/") or (path.startswith("/api/chunks/") and path.endswith("/audio"))


class SelectiveGZipMiddleware:
    """GZip text responses, but pass audio (chunk audio + ambient tracks) and Range requests through untouched
    so streaming, seeking and Content-Length/206 semantics are preserved."""

    def __init__(self, app: ASGIApp, minimum_size: int = 1000) -> None:
        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=minimum_size)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and (
            _is_audio_path(scope["path"]) or any(k == b"range" for k, _ in scope.get("headers") or [])
        ):
            await self.app(scope, receive, send)
            return
        await self.gzip(scope, receive, send)


def _configure_logging(level: str) -> None:
    logging.basicConfig(level=level.upper(), format="%(asctime)s %(levelname)s %(name)s %(message)s")


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    for d in (settings.data_dir, settings.library_dir, settings.tmp_dir):
        d.mkdir(parents=True, exist_ok=True)
    db = Database(settings.db_path)
    await db.connect()
    ctx = AppContext.build(settings, db)
    app.state.ctx = ctx
    removed = await ctx.sessions.delete_expired()
    log.info("startup data_dir=%s expired_sessions_removed=%d", settings.data_dir, removed)
    if durability := data_dir_durability_error(settings.data_dir):
        log.error("startup data_dir_not_durable reason=%s", durability)
    worker: Worker | None = None
    if settings.worker_enabled:
        worker = Worker(
            ctx,
            ocr_provider=GeminiOcrProvider(settings.gemini_api_key, settings.gemini_ocr_model),
            tts_providers={
                "gemini": GeminiTtsProvider(settings.gemini_api_key, settings.gemini_tts_model, settings.gemini_tts_style),
                "azure": AzureTtsProvider(settings.azure_speech_key, settings.azure_speech_region),
            },
        )
        ctx.worker = worker
        await worker.start()
    try:
        yield
    finally:
        if worker is not None:
            await worker.stop()
        await db.close()
        log.info("shutdown complete")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    _configure_logging(settings.log_level)
    app = FastAPI(title="BookSnap", lifespan=_lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    install_error_handlers(app)
    app.add_middleware(RequestSizeLimitMiddleware, max_body_bytes=settings.max_upload_bytes + 256 * 1024)
    app.add_middleware(SelectiveGZipMiddleware, minimum_size=1000)

    app.include_router(auth_routes.public_router)
    app.include_router(auth_routes.router)
    app.include_router(books_routes.router)
    app.include_router(pages_routes.router)
    app.include_router(audio_routes.router)
    app.include_router(voices_routes.router)
    app.include_router(export_routes.router)
    app.include_router(bookmarks_routes.router)
    app.include_router(topics_routes.router)
    app.include_router(account_routes.router)
    app.include_router(profiles_routes.router)
    app.include_router(shelf_routes.router)
    app.include_router(usage_routes.router)

    @app.get("/health", include_in_schema=False)
    async def health(request: Request) -> JSONResponse:
        ctx: AppContext = request.app.state.ctx
        checks: dict[str, str] = {}
        try:
            await ctx.db.fetchone("SELECT 1")
            checks["db"] = "ok"
        except Exception as exc:  # noqa: BLE001 - health must report, not raise
            checks["db"] = f"error: {type(exc).__name__}"
        probe = ctx.settings.data_dir / ".health-probe"
        try:
            probe.write_text("ok")
            probe.unlink()
            durability = data_dir_durability_error(ctx.settings.data_dir)
            checks["data_dir"] = f"error: {durability}" if durability else "ok"
        except OSError as exc:
            checks["data_dir"] = f"error: {type(exc).__name__}"
        ok = all(v == "ok" for v in checks.values())
        return JSONResponse({"status": "ok" if ok else "error", **checks}, status_code=200 if ok else 503)

    @app.middleware("http")
    async def _static_cache_headers(request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if not path.startswith("/api/") and "cache-control" not in response.headers:
            # Always revalidate app shell files; the service worker handles offline caching.
            response.headers["Cache-Control"] = "no-cache"
        return response

    if WEB_DIR.is_dir():
        app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
    return app


app = create_app()
