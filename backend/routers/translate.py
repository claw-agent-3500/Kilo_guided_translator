"""
Translation Router - Single chunk and batch translation with SSE streaming.
"""

import logging
import asyncio
from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

from models.requests import TranslateChunkRequest, TranslateBatchRequest
from models.responses import TranslatedChunk, TranslationProgress
from services.gemini_service import translate_chunk
from routers.keys import get_current_gemini_key

logger = logging.getLogger(__name__)

router = APIRouter()

# Limits
MAX_BATCH_SIZE = 500  # Maximum chunks per batch request
MAX_CHUNK_CONTENT_LENGTH = 50_000  # Maximum chars per chunk


@router.post("/chunk", response_model=TranslatedChunk)
async def translate_single_chunk(request: TranslateChunkRequest):
    """
    Translate a single chunk with glossary constraints.
    """
    if not get_current_gemini_key():
        raise HTTPException(status_code=400, detail="No Gemini API key configured. Set via /api/keys endpoint.")
    
    if len(request.chunk.content) > MAX_CHUNK_CONTENT_LENGTH:
        raise HTTPException(status_code=400, detail=f"Chunk content too large ({len(request.chunk.content)} chars, max {MAX_CHUNK_CONTENT_LENGTH})")
    
    try:
        result = await translate_chunk(chunk=request.chunk, glossary=request.glossary)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch")
async def translate_batch(request: TranslateBatchRequest):
    """
    Batch translate multiple chunks with SSE streaming progress.
    """
    if not get_current_gemini_key():
        raise HTTPException(status_code=400, detail="No Gemini API key configured. Set via /api/keys endpoint.")
    
    if len(request.chunks) > MAX_BATCH_SIZE:
        raise HTTPException(status_code=400, detail=f"Batch too large ({len(request.chunks)} chunks, max {MAX_BATCH_SIZE})")
    
    for chunk in request.chunks:
        if len(chunk.content) > MAX_CHUNK_CONTENT_LENGTH:
            raise HTTPException(status_code=400, detail=f"Chunk {chunk.id} too large ({len(chunk.content)} chars)")
    
    async def event_generator():
        """Generate SSE events for translation progress."""
        total = len(request.chunks)
        
        logger.info(f"Starting batch translation: {total} chunks")
        
        for i, chunk in enumerate(request.chunks):
            try:
                # Progress event
                yield {
                    "event": "progress",
                    "data": TranslationProgress(
                        event="progress", chunk_id=chunk.id, current=i, total=total
                    ).model_dump_json()
                }
                
                # Translate
                result = await translate_chunk(chunk=chunk, glossary=request.glossary)
                
                logger.debug(f"Chunk {i+1}/{total} translated: {chunk.id}")
                
                # Chunk complete event
                yield {
                    "event": "chunk_complete",
                    "data": TranslationProgress(
                        event="chunk_complete", chunk_id=chunk.id,
                        current=i + 1, total=total, translated_chunk=result
                    ).model_dump_json()
                }
                
                # Rate limiting delay
                await asyncio.sleep(0.3)
                
            except Exception as e:
                logger.error(f"Error translating chunk {chunk.id}: {e}")
                yield {
                    "event": "error",
                    "data": TranslationProgress(
                        event="error", chunk_id=chunk.id,
                        current=i, total=total, error_message=str(e)
                    ).model_dump_json()
                }
        
        # Done event
        yield {
            "event": "done",
            "data": TranslationProgress(event="done", current=total, total=total).model_dump_json()
        }
        logger.info(f"Batch translation complete: {total} chunks")
    
    return EventSourceResponse(event_generator())


@router.post("/batch/sync", response_model=list[TranslatedChunk])
async def translate_batch_sync(request: TranslateBatchRequest):
    """
    Batch translate multiple chunks synchronously (no streaming).
    """
    if not get_current_gemini_key():
        raise HTTPException(status_code=400, detail="No Gemini API key configured.")
    
    if len(request.chunks) > MAX_BATCH_SIZE:
        raise HTTPException(status_code=400, detail=f"Batch too large ({len(request.chunks)} chunks, max {MAX_BATCH_SIZE})")
    
    results = []
    for chunk in request.chunks:
        try:
            result = await translate_chunk(chunk=chunk, glossary=request.glossary)
            results.append(result)
            await asyncio.sleep(0.5)
        except Exception as e:
            results.append(TranslatedChunk(
                id=chunk.id, original=chunk.content,
                translated=f"[Translation Error: {e}]", terms_used=[]
            ))
    
    return results
