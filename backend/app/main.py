from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routes import admin, auth, bindings, chats, reports, templates as templates_route

settings = get_settings()

# --- Logging -----------------------------------------------------------
_log_level = logging.DEBUG if settings.debug else logging.INFO
logging.basicConfig(
    level=_log_level,
    format="%(asctime)s %(levelname)-5s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
    force=True,
)
# keep some noisy libs at INFO even in debug
logging.getLogger("telethon").setLevel(logging.INFO if settings.debug else logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("apscheduler.scheduler").setLevel(logging.INFO)
logging.getLogger("apscheduler.executors").setLevel(logging.WARNING)
logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .services import scheduler

    if settings.scheduler_enabled:
        scheduler.start()
    try:
        yield
    finally:
        if settings.scheduler_enabled:
            scheduler.shutdown()


app = FastAPI(
    title="Personal Chat Manager API",
    version="0.1.0",
    lifespan=lifespan,
)

if settings.cors_origin_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.middleware("http")
async def request_logger(request: Request, call_next):
    req_id = uuid.uuid4().hex[:8]
    t0 = time.perf_counter()
    logger.debug("→ %s %s %s", req_id, request.method, request.url.path)
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("✗ %s %s %s failed", req_id, request.method, request.url.path)
        raise
    dt_ms = (time.perf_counter() - t0) * 1000
    logger.info("← %s %s %s → %d (%.0f ms)", req_id, request.method, request.url.path, response.status_code, dt_ms)
    return response


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(chats.router, prefix="/api/chats", tags=["chats"])
app.include_router(bindings.router, prefix="/api/bindings", tags=["bindings"])
app.include_router(reports.router, prefix="/api/reports", tags=["reports"])
app.include_router(templates_route.router, prefix="/api/templates", tags=["templates"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
