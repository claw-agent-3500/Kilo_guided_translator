"""
Guided Translator Backend - FastAPI Application

Provides API endpoints for:
- Document parsing (PDF via MinerU, Markdown)
- Translation (Gemini API with glossary support)
- API key management
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from routers import parse, translate, keys, export, review, glossary, status
from config import settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown events."""
    logger.info("Starting Guided Translator Backend v1.1.0")
    logger.info("API docs available at: http://localhost:8000/docs")
    yield
    # Shutdown — cancel any in-flight operations
    logger.info("Shutting down backend...")


app = FastAPI(
    title="Guided Translator API",
    description="Backend API for terminology-aware technical document translation",
    version="1.1.0",
    lifespan=lifespan
)

# CORS middleware — locked down to configured origins
cors_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth middleware ──────────────────────────────────────────────────────────
# If API_KEY is set in the environment, every request must carry it in the
# X-API-Key header.  Health/root endpoints and OPTIONS (preflight) are exempt.

EXEMPT_PATHS = {"/", "/health", "/docs", "/openapi.json", "/redoc"}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    # Skip auth if no API key is configured
    if not settings.api_key:
        return await call_next(request)

    # Skip exempt paths and preflight
    if request.url.path in EXEMPT_PATHS or request.method == "OPTIONS":
        return await call_next(request)

    # Check header
    provided = request.headers.get("x-api-key", "")
    if provided != settings.api_key:
        return JSONResponse(
            status_code=401,
            content={"detail": "Invalid or missing API key. Set X-API-Key header."}
        )

    return await call_next(request)


# Register routers
app.include_router(parse.router, prefix="/api/parse", tags=["Parsing"])
app.include_router(translate.router, prefix="/api/translate", tags=["Translation"])
app.include_router(keys.router, prefix="/api/keys", tags=["API Keys"])
app.include_router(export.router, prefix="/api/export", tags=["Export"])
app.include_router(review.router, prefix="/api", tags=["Review"])
app.include_router(glossary.router, prefix="/api", tags=["Glossary"])
app.include_router(status.router, tags=["Status"])


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "Guided Translator Backend",
        "version": "1.1.0"
    }


@app.get("/health")
async def health_check():
    """Detailed health check."""
    return {
        "status": "healthy",
        "version": "1.1.0",
        "gemini_configured": bool(settings.gemini_api_key),
        "mineru_configured": bool(settings.mineru_api_key)
    }
