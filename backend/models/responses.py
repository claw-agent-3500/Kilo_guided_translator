"""
Pydantic models for API response bodies.
"""

from pydantic import BaseModel, Field
from typing import Optional, Literal


class DocumentStructure(BaseModel):
    """Parsed document structure."""
    text: str = Field(..., description="Full document text in Markdown")
    pages: int = Field(..., description="Number of pages")
    word_count: int = Field(..., description="Total word count")
    language: Literal["en", "zh", "unknown"] = Field(default="en")


class TermMatch(BaseModel):
    """A matched glossary term in text."""
    term: str
    translation: str
    start_index: int
    end_index: int


class TranslatedChunk(BaseModel):
    """Result of translating a single chunk."""
    id: str
    original: str
    translated: str
    terms_used: list[TermMatch] = Field(default_factory=list)
    tokens_used: Optional[int] = None


class TranslationProgress(BaseModel):
    """SSE event for translation progress."""
    event: Literal["progress", "chunk_complete", "error", "done"]
    chunk_id: Optional[str] = None
    current: int = 0
    total: int = 0
    translated_chunk: Optional[TranslatedChunk] = None
    error_message: Optional[str] = None


class ApiKeyStatus(BaseModel):
    """Status of configured API keys."""
    gemini_configured: bool
    gemini_key_count: int = 0
    mineru_configured: bool


class ParseResult(BaseModel):
    """Result of document parsing."""
    success: bool
    document: Optional[DocumentStructure] = None
    doc_id: Optional[int] = Field(
        default=None,
        description="Backend database ID of the created document. "
                    "Used to request the Skeleton+State Markdown export."
    )
    error: Optional[str] = None
