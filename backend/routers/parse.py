"""
Document Parsing Router - PDF and Markdown parsing endpoints.
"""

import logging
import traceback
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from models.responses import ParseResult, DocumentStructure
from services.mineru_service import extract_with_mineru, is_mineru_configured
from services.markdown_handler import build_skeleton_and_dict
from services.database import get_database

logger = logging.getLogger(__name__)

router = APIRouter()

# Limits
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
MINERU_SIZE_LIMIT = 30 * 1024 * 1024  # 30MB


def _ingest_document_skeleton(doc_id: int, markdown_text: str) -> int:
    """
    After a document is created in the DB, build its skeleton and store it.
    Creates one node per translatable chunk, with chunk_tag populated.

    Returns the number of nodes created.
    """
    db = get_database()
    skeleton, chunk_dict = build_skeleton_and_dict(markdown_text)

    # Persist skeleton
    db.save_skeleton(doc_id, skeleton)

    # Create nodes from the chunk dict (preserves order via dict insertion order, Python 3.7+)
    blocks = [
        {
            "content": original_text,
            "chunk_tag": tag,
            "type": "paragraph"   # block_type; refined later if needed
        }
        for tag, original_text in chunk_dict.items()
    ]
    db.create_nodes_batch(doc_id, blocks)
    return len(blocks)


@router.post("/pdf", response_model=ParseResult)
async def parse_pdf(
    file: UploadFile = File(...),
    use_mineru: bool = Form(default=True)
):
    """
    Parse a PDF file and extract structured content.
    
    - **file**: PDF file to parse
    - **use_mineru**: Use MinerU Cloud API for extraction (recommended for complex PDFs)
    """
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="File must be a PDF")
    
    # Check file size (max 50MB for general, but MinerU has ~30MB limit)
    content = await file.read()
    file_size_mb = len(content) / (1024 * 1024)
    
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size must be less than 50MB")
    
    # MinerU has stricter limits
    MINERU_SIZE_LIMIT_MB = 30
    if use_mineru and file_size_mb > MINERU_SIZE_LIMIT_MB:
        raise HTTPException(
            status_code=400, 
            detail=f"File size ({file_size_mb:.1f}MB) exceeds MinerU API limit of {MINERU_SIZE_LIMIT_MB}MB. "
                   f"Please use a smaller PDF or disable MinerU to use legacy parsing."
        )
    
    try:
        logger.info(f"[Parse] PDF Upload received: {file.filename}, use_mineru={use_mineru}")
        logger.info(f"[Parse] File size: {file_size_mb:.2f} MB")
        
        if use_mineru:
            logger.info(f"[Parse] Checking MinerU configuration...")
            configured = is_mineru_configured()
            logger.info(f"[Parse] MinerU configured: {configured}")
            
            if not configured:
                raise HTTPException(
                    status_code=400, 
                    detail="MinerU API key not configured. Set via /api/keys endpoint."
                )
            
            logger.info(f"[Parse] Calling extract_with_mineru...")
            document = await extract_with_mineru(content, file.filename)
            logger.info(f"[Parse] Extraction successful! Text length: {len(document.text)}")
        else:
            # Fallback: basic text extraction without MinerU
            raise HTTPException(
                status_code=501, 
                detail="Legacy PDF parsing not yet implemented. Please enable MinerU."
            )

        # --- Skeleton & State: persist to DB ---
        db = get_database()
        doc_id = db.create_document(
            name=file.filename,
            source_text=document.text,
            pages=document.pages,
            word_count=document.word_count,
            language=document.language,
        )
        node_count = _ingest_document_skeleton(doc_id, document.text)
        logger.info(f"[Parse] Skeleton stored: doc_id={doc_id}, nodes={node_count}")

        return ParseResult(success=True, document=document, doc_id=doc_id)
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_msg = str(e)
        logger.info(f"[Parse] ERROR during PDF parsing: {error_msg}")
        logger.info(f"[Parse] Full traceback:\n{traceback.format_exc()}")
        
        # Improve error message for common MinerU errors
        if "413" in error_msg:
            error_msg = f"MinerU API error: File too large. MinerU has a ~30MB limit. Your file is {file_size_mb:.1f}MB."
        elif "MinerU API error: Invalid API key" in error_msg:
            error_msg = "MinerU API authentication failed. Please check your API key."
        elif "MinerU API error: Access forbidden" in error_msg:
            error_msg = "MinerU API access forbidden. Your API key may not have sufficient permissions."
        elif "429" in error_msg:
            error_msg = "MinerU API rate limited. Please wait a moment and try again."
        elif "Failed to upload file to temporary storage" in error_msg:
            error_msg = "Failed to upload PDF to temporary storage. Please try again."
        # Keep original error for debugging
        
        return ParseResult(success=False, error=error_msg)


@router.post("/markdown", response_model=ParseResult)
async def parse_markdown(file: UploadFile = File(...)):
    """
    Parse a Markdown file and extract structured content.
    
    - **file**: Markdown (.md) file to parse
    """
    if not file.filename or not file.filename.lower().endswith('.md'):
        raise HTTPException(status_code=400, detail="File must be a Markdown file (.md)")
    
    try:
        content = await file.read()
        text = content.decode('utf-8')
        
        # Simple word count
        word_count = len(text.split())
        
        # Detect language
        chinese_chars = len([c for c in text if '\u4e00' <= c <= '\u9fff'])
        if chinese_chars / max(len(text), 1) > 0.1:
            language = "zh"
        else:
            language = "en"
        
        document = DocumentStructure(
            text=text,
            pages=max(1, word_count // 500),
            word_count=word_count,
            language=language
        )

        # --- Skeleton & State: persist to DB ---
        db = get_database()
        doc_id = db.create_document(
            name=file.filename,
            source_text=text,
            pages=document.pages,
            word_count=word_count,
            language=language,
        )
        node_count = _ingest_document_skeleton(doc_id, text)
        logger.info(f"[Parse] Markdown skeleton stored: doc_id={doc_id}, nodes={node_count}")

        return ParseResult(success=True, document=document, doc_id=doc_id)
    
    except Exception as e:
        return ParseResult(success=False, error=str(e))
