"""
API Keys Router - Manage API keys at runtime.
"""

import logging
from fastapi import APIRouter
from models.requests import SetApiKeysRequest
from models.responses import ApiKeyStatus
from config import settings, update_api_keys

logger = logging.getLogger(__name__)

router = APIRouter()

# In-memory storage for multiple Gemini keys
gemini_key_pool: list[str] = []
current_key_index: int = 0


def _redact(key: str) -> str:
    """Redact a key for safe logging — show only first 4 and last 4 chars."""
    if len(key) <= 8:
        return "****"
    return f"{key[:4]}...{key[-4:]}"


@router.post("", response_model=ApiKeyStatus)
async def set_api_keys(request: SetApiKeysRequest):
    """Set API keys for Gemini and MinerU."""
    global gemini_key_pool, current_key_index
    
    if request.gemini_keys:
        gemini_key_pool = [k for k in request.gemini_keys if k]
        current_key_index = 0
        if gemini_key_pool:
            update_api_keys(gemini_key=gemini_key_pool[0])
        for i, key in enumerate(gemini_key_pool):
            logger.info(f"Key {i}: {_redact(key)} {'(ACTIVE)' if i == 0 else ''}")
        logger.info(f"Total {len(gemini_key_pool)} Gemini key(s) configured")
    
    if request.mineru_key:
        update_api_keys(mineru_key=request.mineru_key)
        logger.info(f"MinerU key configured: {_redact(request.mineru_key)}")
    
    return ApiKeyStatus(
        gemini_configured=bool(gemini_key_pool),
        gemini_key_count=len(gemini_key_pool),
        mineru_configured=bool(settings.mineru_api_key)
    )


@router.get("/status", response_model=ApiKeyStatus)
async def get_key_status():
    """Get current API key configuration status."""
    return ApiKeyStatus(
        gemini_configured=bool(gemini_key_pool) or bool(settings.gemini_api_key),
        gemini_key_count=len(gemini_key_pool) if gemini_key_pool else (1 if settings.gemini_api_key else 0),
        mineru_configured=bool(settings.mineru_api_key)
    )


def get_current_gemini_key() -> str | None:
    """Get the current active Gemini API key."""
    if gemini_key_pool:
        key = gemini_key_pool[current_key_index]
        logger.debug(f"Using key {current_key_index}/{len(gemini_key_pool)}: {_redact(key)}")
        return key
    key = settings.gemini_api_key or None
    if key:
        logger.debug(f"Using env key: {_redact(key)}")
    return key


def rotate_gemini_key() -> bool:
    """Rotate to next Gemini API key. Returns True if rotation successful."""
    global current_key_index
    
    if len(gemini_key_pool) <= 1:
        logger.debug(f"Cannot rotate — only {len(gemini_key_pool)} key(s) available")
        return False
    
    old_index = current_key_index
    current_key_index = (current_key_index + 1) % len(gemini_key_pool)
    new_key = gemini_key_pool[current_key_index]
    update_api_keys(gemini_key=new_key)
    logger.info(f"Rotated from key {old_index} to key {current_key_index}: {_redact(new_key)}")
    return True


@router.get("/test-gemini")
async def test_gemini_connection():
    """Test Gemini API connectivity and check for rate limiting."""
    import google.generativeai as genai
    
    api_key = get_current_gemini_key()
    
    if not api_key:
        return {
            "status": "no_key",
            "message": "No Gemini API key configured",
            "rate_limited": False
        }
    
    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")
        
        response = model.generate_content(
            "Say 'OK' in one word.",
            generation_config=genai.types.GenerationConfig(max_output_tokens=5)
        )
        
        return {
            "status": "ok",
            "message": "Gemini API is working",
            "rate_limited": False,
            "response": response.text[:50] if response.text else "No response"
        }
        
    except Exception as e:
        error_msg = str(e).lower()
        is_rate_limited = "429" in error_msg or "rate" in error_msg or "quota" in error_msg
        
        return {
            "status": "error" if not is_rate_limited else "rate_limited",
            "message": str(e)[:200],
            "rate_limited": is_rate_limited
        }
