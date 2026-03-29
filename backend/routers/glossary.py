"""
Glossary Router - CSV upload and term management for consistent translations.
"""

import csv
import io
import logging
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import List, Optional
import sqlite3
from contextlib import contextmanager
import os

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/glossary", tags=["glossary"])


# ==================== Request/Response Models ====================

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


# ==================== Database Setup ====================

def get_db_path() -> str:
    return os.environ.get("TRANSLATOR_DB", "translator.db")


@contextmanager
def get_connection():
    """Get database connection."""
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_glossary_table():
    """Initialize glossary table if not exists."""
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS glossary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                english TEXT NOT NULL UNIQUE,
                chinese TEXT NOT NULL,
                notes TEXT,
                category TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_glossary_english ON glossary(english)")


# Initialize on import
init_glossary_table()


# ==================== Endpoints ====================

@router.post("/upload", response_model=UploadResult)
async def upload_glossary(file: UploadFile = File(...)):
    """
    Upload a CSV file with glossary terms.
    
    Expected CSV format:
    - Column 1: English term
    - Column 2: Chinese translation
    - Column 3 (optional): Notes
    - Column 4 (optional): Category
    
    Header row is optional (auto-detected).
    """
    if not file.filename.endswith('.csv'):
        raise HTTPException(400, "File must be a CSV")
    
    content = await file.read()
    text = content.decode('utf-8-sig')  # Handle BOM
    
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    
    if not rows:
        raise HTTPException(400, "CSV file is empty")
    
    # Detect header row
    first_row = rows[0]
    has_header = any(h.lower() in ['english', 'chinese', 'term', 'translation', '英文', '中文'] 
                     for h in first_row if h)
    
    if has_header:
        rows = rows[1:]
    
    terms_added = 0
    terms_updated = 0
    errors = []
    
    with get_connection() as conn:
        for i, row in enumerate(rows, start=2 if has_header else 1):
            if len(row) < 2:
                if row and row[0].strip():
                    errors.append(f"Row {i}: Missing Chinese translation")
                continue
            
            english = row[0].strip()
            chinese = row[1].strip()
            notes = row[2].strip() if len(row) > 2 else None
            category = row[3].strip() if len(row) > 3 else None
            
            if not english or not chinese:
                errors.append(f"Row {i}: Empty term or translation")
                continue
            
            try:
                # Try insert, update on conflict
                cursor = conn.execute("""
                    INSERT INTO glossary (english, chinese, notes, category)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(english) DO UPDATE SET
                        chinese = excluded.chinese,
                        notes = excluded.notes,
                        category = excluded.category,
                        updated_at = CURRENT_TIMESTAMP
                """, (english, chinese, notes, category))
                
                if cursor.rowcount > 0:
                    # Check if it was insert or update
                    existing = conn.execute(
                        "SELECT created_at, updated_at FROM glossary WHERE english = ?",
                        (english,)
                    ).fetchone()
                    if existing and existing['created_at'] != existing['updated_at']:
                        terms_updated += 1
                    else:
                        terms_added += 1
                        
            except Exception as e:
                errors.append(f"Row {i}: {str(e)}")
    
    return UploadResult(
        success=True,
        terms_added=terms_added,
        terms_updated=terms_updated,
        errors=errors[:10]  # Limit errors shown
    )


@router.get("", response_model=List[GlossaryTerm])
async def list_glossary(
    category: Optional[str] = None,
    search: Optional[str] = None
):
    """
    List all glossary terms.
    
    Optional filters:
    - category: Filter by category
    - search: Search in english/chinese terms
    """
    with get_connection() as conn:
        query = "SELECT * FROM glossary WHERE 1=1"
        params = []
        
        if category:
            query += " AND category = ?"
            params.append(category)
        
        if search:
            query += " AND (english LIKE ? OR chinese LIKE ?)"
            params.extend([f"%{search}%", f"%{search}%"])
        
        query += " ORDER BY english"
        
        rows = conn.execute(query, params).fetchall()
        return [GlossaryTerm(**dict(row)) for row in rows]


@router.get("/categories", response_model=List[str])
async def list_categories():
    """List all unique categories."""
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT DISTINCT category FROM glossary 
            WHERE category IS NOT NULL AND category != ''
            ORDER BY category
        """).fetchall()
        return [row['category'] for row in rows]


@router.get("/{term_id}", response_model=GlossaryTerm)
async def get_term(term_id: int):
    """Get a single glossary term by ID."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM glossary WHERE id = ?",
            (term_id,)
        ).fetchone()
        
        if not row:
            raise HTTPException(404, f"Term {term_id} not found")
        
        return GlossaryTerm(**dict(row))


@router.post("", response_model=GlossaryTerm)
async def create_term(term: GlossaryTerm):
    """Create a new glossary term."""
    with get_connection() as conn:
        try:
            cursor = conn.execute("""
                INSERT INTO glossary (english, chinese, notes, category)
                VALUES (?, ?, ?, ?)
            """, (term.english, term.chinese, term.notes, term.category))
            
            term.id = cursor.lastrowid
            return term
            
        except sqlite3.IntegrityError:
            raise HTTPException(409, f"Term '{term.english}' already exists")


@router.put("/{term_id}", response_model=GlossaryTerm)
async def update_term(term_id: int, term: GlossaryTerm):
    """Update an existing glossary term."""
    with get_connection() as conn:
        # Check exists
        existing = conn.execute(
            "SELECT id FROM glossary WHERE id = ?",
            (term_id,)
        ).fetchone()
        
        if not existing:
            raise HTTPException(404, f"Term {term_id} not found")
        
        conn.execute("""
            UPDATE glossary 
            SET english = ?, chinese = ?, notes = ?, category = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (term.english, term.chinese, term.notes, term.category, term_id))
        
        term.id = term_id
        return term


@router.delete("/{term_id}", response_model=ActionResponse)
async def delete_term(term_id: int):
    """Delete a glossary term."""
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM glossary WHERE id = ?",
            (term_id,)
        )
        
        if cursor.rowcount == 0:
            raise HTTPException(404, f"Term {term_id} not found")
        
        return ActionResponse(success=True, message=f"Term {term_id} deleted")


@router.delete("/clear/all", response_model=ActionResponse)
async def clear_glossary():
    """Delete all glossary terms. Use with caution!"""
    with get_connection() as conn:
        cursor = conn.execute("DELETE FROM glossary")
        count = cursor.rowcount
        
        return ActionResponse(
            success=True,
            message=f"Deleted {count} terms"
        )


# ==================== Helper for Translation Service ====================

def get_all_terms() -> List[dict]:
    """Get all glossary terms for injection into translation prompts."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT english, chinese, notes FROM glossary ORDER BY english"
        ).fetchall()
        return [dict(row) for row in rows]


def find_matching_terms(text: str) -> List[dict]:
    """Find glossary terms that appear in the given text."""
    text_lower = text.lower()
    all_terms = get_all_terms()
    
    return [
        term for term in all_terms
        if term['english'].lower() in text_lower
    ]
