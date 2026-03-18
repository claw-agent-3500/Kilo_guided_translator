"""
Export Router - PDF and Markdown export endpoints.
"""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional, Literal

from services.pdf_export import generate_translation_pdf
from services.markdown_handler import reconstruct_from_skeleton
from services.database import get_database

router = APIRouter()


class ChunkData(BaseModel):
    """Chunk data for PDF export."""
    id: str
    text: str
    translation: str
    type: Literal['heading', 'paragraph', 'list', 'table'] = 'paragraph'
    position: int = 0


class ExportPdfRequest(BaseModel):
    """Request model for PDF export."""
    chunks: List[ChunkData]
    title: str = "Technical Translation"
    include_original: bool = False


@router.post("/pdf")
async def export_pdf(request: ExportPdfRequest):
    """
    Generate a text-based PDF from translated chunks.
    
    Returns a downloadable PDF file with:
    - Selectable/searchable Chinese text
    - Preserved markdown formatting
    - Page numbers and headers
    """
    if not request.chunks:
        raise HTTPException(status_code=400, detail="No chunks provided")
    
    try:
        # Convert to dict format for PDF generator
        chunks_data = [
            {
                "translation": chunk.translation,
                "type": chunk.type,
                "text": chunk.text,
            }
            for chunk in request.chunks
        ]
        
        print(f"[PDF Export] Generating PDF with {len(chunks_data)} chunks...")
        pdf_bytes = generate_translation_pdf(chunks_data, request.title)
        
        print(f"[PDF Export] PDF generated: {len(pdf_bytes)} bytes")
        
        # Return PDF as downloadable file
        filename = f"translation_{request.title[:30].replace(' ', '_')}.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(len(pdf_bytes))
            }
        )
        
    except Exception as e:
        print(f"[PDF Export] Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")


@router.get("/pdf/test")
async def test_pdf():
    """Test PDF generation with sample content."""
    test_chunks = [
        {"translation": "# 技术标准翻译测试", "type": "heading"},
        {"translation": "这是一个测试段落，包含中文和English混合内容。\n\nPDF生成成功！", "type": "paragraph"},
        {"translation": "## 第二章 安全要求", "type": "heading"},
        {"translation": "- 第一项安全要求\n- 第二项安全要求\n- 第三项安全要求", "type": "paragraph"},
        {"translation": "1. 操作前检查设备状态\n2. 确认所有安全装置正常\n3. 开始操作程序", "type": "paragraph"},
    ]
    
    try:
        pdf_bytes = generate_translation_pdf(test_chunks, "PDF测试文档")
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": 'attachment; filename="test_translation.pdf"'
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Test PDF failed: {str(e)}")


# ==================== Markdown Export (Skeleton & State) ====================

@router.get("/markdown/{document_id}")
async def export_markdown(
    document_id: int,
    include_untranslated: bool = Query(
        default=True,
        description="If True, unapproved chunks fall back to original English. "
                    "If False, unapproved chunks are left as [CHUNK_XXX] placeholder tags."
    )
):
    """
    Export the final translated Markdown document.

    Uses the Skeleton + State pattern:
    1. Fetches the Markdown skeleton (stored at parse time).
    2. Fetches all approved/completed nodes (chunk_tag -> translation).
    3. Performs a deterministic string replacement of each [CHUNK_XXX] tag.
    4. Returns a downloadable .md file.

    Unapproved nodes are handled according to include_untranslated:
    - True  (default): substitute original English — document is always complete.
    - False:           leave [CHUNK_XXX] tags in place for inspection.
    """
    db = get_database()

    # 1. Fetch skeleton
    skeleton = db.get_skeleton(document_id)
    if skeleton is None:
        # Might be a legacy document without a skeleton
        doc = db.get_document(document_id)
        if not doc:
            raise HTTPException(status_code=404, detail=f"Document {document_id} not found")
        raise HTTPException(
            status_code=422,
            detail=(
                f"Document {document_id} has no Markdown skeleton. "
                "It was uploaded before the Skeleton & State feature was enabled. "
                "Please re-upload the document to use this export."
            )
        )

    # 2. Fetch nodes — include_pending=True so we can fall back to English
    nodes = db.get_nodes_with_tags(document_id, include_pending=True)

    # 3. Build the substitution dictionary
    translations: dict[str, str] = {}
    for node in nodes:
        tag = node["chunk_tag"]
        if not tag:
            continue
        state = node.get("state", "")
        is_approved = state in ("approved", "completed")

        if is_approved and node.get("translation"):
            translations[tag] = node["translation"]
        elif include_untranslated:
            # Graceful fallback: restore original English
            translations[tag] = node["content"]
        # else: leave [CHUNK_XXX] in skeleton as-is

    # 4. Deterministic reconstruction
    final_markdown = reconstruct_from_skeleton(skeleton, translations)

    # 5. Return as downloadable file
    doc_info = db.get_document(document_id)
    doc_name = doc_info["name"] if doc_info else f"document_{document_id}"
    # Strip extension if present, add _translated.md
    base_name = doc_name.rsplit(".", 1)[0] if "." in doc_name else doc_name
    filename = f"{base_name}_translated.md"

    print(f"[Markdown Export] doc_id={document_id}, nodes={len(nodes)}, "
          f"approved={sum(1 for n in nodes if n.get('state') in ('approved','completed'))}, "
          f"skeleton_len={len(skeleton)}, output_len={len(final_markdown)}")

    return Response(
        content=final_markdown.encode("utf-8"),
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(final_markdown.encode("utf-8")))
        }
    )
