"""
Glossary Router - CSV upload and term management for consistent translations.
Uses the shared Database service (no separate SQLite connections).
"""

import csv
import io
import logging
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import List, Optional

from services.database import get_database

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/glossary", tags=["glossary"])


# ==================== Models ====================

class GlossaryTerm(BaseModel):
    id: Optional[int] = None
    english: str
    chinese: str
    notes: Optional[str] = None
    category: Optional[str] = None


class UploadResult(BaseModel):
    success: bool
    terms_added: int
    terms_updated: int
    errors: List[str]


class ActionResponse(BaseModel):
    success: bool
    message: str


# ==================== Endpoints ====================

@router.post("/upload", response_model=UploadResult)
async def upload_glossary(file: UploadFile = File(...)):
    """Upload a CSV file with glossary terms (English, Chinese, Notes?, Category?)."""
    if not file.filename or not file.filename.endswith('.csv'):
        raise HTTPException(400, "File must be a CSV")

    content = await file.read()
    text = content.decode('utf-8-sig')

    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        raise HTTPException(400, "CSV file is empty")

    # Auto-detect header row
    first_row = rows[0]
    has_header = any(
        h.lower() in ['english', 'chinese', 'term', 'translation', '英文', '中文']
        for h in first_row if h
    )
    if has_header:
        rows = rows[1:]

    # Normalize to (english, chinese, notes, category) tuples
    normalized = []
    for row in rows:
        english = row[0].strip() if len(row) > 0 else ""
        chinese = row[1].strip() if len(row) > 1 else ""
        notes = row[2].strip() if len(row) > 2 else None
        category = row[3].strip() if len(row) > 3 else None
        normalized.append((english, chinese, notes or None, category or None))

    db = get_database()
    result = db.upload_glossary_csv(normalized)

    return UploadResult(
        success=True,
        terms_added=result["terms_added"],
        terms_updated=result["terms_updated"],
        errors=result["errors"]
    )


@router.get("", response_model=List[GlossaryTerm])
async def list_glossary(category: Optional[str] = None, search: Optional[str] = None):
    """List all glossary terms with optional category/search filters."""
    db = get_database()
    terms = db.list_glossary(category=category, search=search)
    return [GlossaryTerm(**t) for t in terms]


@router.get("/categories", response_model=List[str])
async def list_categories():
    """List all unique categories."""
    db = get_database()
    return db.list_glossary_categories()


@router.get("/{term_id}", response_model=GlossaryTerm)
async def get_term(term_id: int):
    """Get a single glossary term by ID."""
    db = get_database()
    term = db.get_glossary_term(term_id)
    if not term:
        raise HTTPException(404, f"Term {term_id} not found")
    return GlossaryTerm(**term)


@router.post("", response_model=GlossaryTerm)
async def create_term(term: GlossaryTerm):
    """Create a new glossary term."""
    db = get_database()
    try:
        result = db.create_glossary_term(term.english, term.chinese, term.notes, term.category)
        return GlossaryTerm(**result)
    except Exception as e:
        if "UNIQUE" in str(e):
            raise HTTPException(409, f"Term '{term.english}' already exists")
        raise HTTPException(500, str(e))


@router.put("/{term_id}", response_model=GlossaryTerm)
async def update_term(term_id: int, term: GlossaryTerm):
    """Update an existing glossary term."""
    db = get_database()
    if not db.get_glossary_term(term_id):
        raise HTTPException(404, f"Term {term_id} not found")
    db.update_glossary_term(term_id, term.english, term.chinese, term.notes, term.category)
    return GlossaryTerm(id=term_id, **term.model_dump(exclude={"id"}))


@router.delete("/{term_id}", response_model=ActionResponse)
async def delete_term(term_id: int):
    """Delete a glossary term."""
    db = get_database()
    if not db.delete_glossary_term(term_id):
        raise HTTPException(404, f"Term {term_id} not found")
    return ActionResponse(success=True, message=f"Term {term_id} deleted")


@router.delete("/clear/all", response_model=ActionResponse)
async def clear_glossary():
    """Delete all glossary terms. Use with caution!"""
    db = get_database()
    count = db.clear_glossary()
    return ActionResponse(success=True, message=f"Deleted {count} terms")


# ==================== Helpers for Translation ====================

def get_all_terms() -> List[dict]:
    """Get all glossary terms for injection into translation prompts."""
    db = get_database()
    return db.list_glossary()


def find_matching_terms(text: str) -> List[dict]:
    """Find glossary terms that appear in the given text."""
    text_lower = text.lower()
    return [t for t in get_all_terms() if t['english'].lower() in text_lower]
