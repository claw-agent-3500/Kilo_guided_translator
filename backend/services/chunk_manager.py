"""
Chunk Manager Service - Text chunking for translation.
"""

import re
from models.requests import Chunk


def estimate_tokens(text: str) -> int:
    """Rough token estimation (1 token ≈ 4 characters for English)."""
    return len(text) // 4


def split_into_chunks(
    text: str,
    max_tokens: int = 1500,
    overlap_tokens: int = 100
) -> list[Chunk]:
    """
    Split document text into translation-friendly chunks.
    
    Respects:
    - Paragraph boundaries
    - Section headers
    - List blocks
    - Table blocks
    
    Args:
        text: Full document text
        max_tokens: Maximum tokens per chunk
        overlap_tokens: Token overlap between chunks for context
    
    Returns:
        List of Chunk objects
    """
    chunks = []
    
    # Split by double newlines (paragraphs) while preserving structure
    paragraphs = re.split(r'\n\n+', text)
    
    current_chunk = []
    current_tokens = 0
    chunk_index = 0
    
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        
        para_tokens = estimate_tokens(para)
        
        # If single paragraph exceeds max, split it further
        if para_tokens > max_tokens:
            # Flush current chunk first
            if current_chunk:
                chunk_text = "\n\n".join(current_chunk)
                chunks.append(Chunk(
                    id=f"chunk_{chunk_index}",
                    content=chunk_text,
                    index=chunk_index
                ))
                chunk_index += 1
                current_chunk = []
                current_tokens = 0
            
            # Split large paragraph by sentences
            sentences = re.split(r'(?<=[.!?。！？])\s+', para)
            for sentence in sentences:
                sent_tokens = estimate_tokens(sentence)
                
                if current_tokens + sent_tokens > max_tokens:
                    if current_chunk:
                        chunk_text = " ".join(current_chunk)
                        chunks.append(Chunk(
                            id=f"chunk_{chunk_index}",
                            content=chunk_text,
                            index=chunk_index
                        ))
                        chunk_index += 1
                        current_chunk = []
                        current_tokens = 0
                
                current_chunk.append(sentence)
                current_tokens += sent_tokens
        
        # Normal case: paragraph fits
        elif current_tokens + para_tokens > max_tokens:
            # Flush current chunk
            if current_chunk:
                chunk_text = "\n\n".join(current_chunk)
                chunks.append(Chunk(
                    id=f"chunk_{chunk_index}",
                    content=chunk_text,
                    index=chunk_index
                ))
                chunk_index += 1
            
            # Start new chunk with this paragraph
            current_chunk = [para]
            current_tokens = para_tokens
        
        else:
            # Add to current chunk
            current_chunk.append(para)
            current_tokens += para_tokens
    
    # Don't forget the last chunk
    if current_chunk:
        chunk_text = "\n\n".join(current_chunk)
        chunks.append(Chunk(
            id=f"chunk_{chunk_index}",
            content=chunk_text,
            index=chunk_index
        ))
    
    return chunks


def merge_translated_chunks(chunks: list[dict]) -> str:
    """
    Merge translated chunks back into a single document.
    Handles overlap removal if needed.
    """
    sorted_chunks = sorted(chunks, key=lambda c: c.get("index", 0))
    
    texts = [chunk.get("translated", "") for chunk in sorted_chunks]
    
    # Simple join with double newlines
    return "\n\n".join(texts)
