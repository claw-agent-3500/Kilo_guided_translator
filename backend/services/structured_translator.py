import logging
logger = logging.getLogger(__name__)
"""
Structure-Preserving Translation Service.

Uses logical markdown handling:
1. Parse markdown into AST
2. Extract only text content (no formatting)
3. Send text-only to Gemini
4. Reconstruct with original structure

This GUARANTEES structure preservation - Gemini never sees formatting!
"""

import asyncio
from typing import List, Dict, Optional, Callable
from services.markdown_handler import (
    extract_for_translation,
    apply_and_render,
)
from models.requests import GlossaryEntry
import google.generativeai as genai
from routers.keys import get_current_gemini_key


def log(msg: str):
    import datetime
    ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    logger.info(f"[StructuredTranslator] {msg}")


def build_text_only_prompt(texts: List[str], glossary: List[GlossaryEntry]) -> str:
    """
    Build a simple translation prompt for text-only content.
    NO formatting instructions needed - text is already extracted.
    """
    glossary_section = ""
    if glossary:
        terms = "\n".join([f"- {g.english} → {g.chinese}" for g in glossary])
        glossary_section = f"""
## Terminology (use these exact translations):
{terms}
"""
    
    # Number each text segment for easy matching
    numbered_texts = "\n".join([
        f"[{i+1}] {text}" 
        for i, text in enumerate(texts)
    ])
    
    return f"""Translate the following text segments from English to Simplified Chinese.

## Rules:
1. Translate ONLY the text content
2. Keep placeholders like __CODE_0__, __STD_0__ unchanged
3. Return translations in the SAME numbered format
4. One translation per line, matching the input numbers
{glossary_section}
## Input:
{numbered_texts}

## Output (Chinese):"""


def parse_numbered_response(response: str, expected_count: int) -> List[str]:
    """
    Parse numbered translation response.
    
    Expected format:
    [1] 翻译文本1
    [2] 翻译文本2
    """
    import re
    
    translations = []
    lines = response.strip().split('\n')
    
    # Try to parse numbered format
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        # Match [n] text or just numbered text
        match = re.match(r'^\[?(\d+)\]?\s*(.+)$', line)
        if match:
            translations.append(match.group(2))
        elif translations:  # Continuation of previous
            translations[-1] += ' ' + line
    
    # Fallback: if parsing failed, split by lines
    if len(translations) != expected_count:
        log(f"Warning: Expected {expected_count} translations, got {len(translations)}. Using line split.")
        translations = [l.strip() for l in lines if l.strip()][:expected_count]
    
    # Pad if still not enough
    while len(translations) < expected_count:
        translations.append("[TRANSLATION MISSING]")
    
    return translations[:expected_count]


async def translate_with_structure_preservation(
    markdown: str,
    glossary: List[GlossaryEntry] = None,
    on_progress: Optional[Callable[[int, int], None]] = None,
    batch_size: int = 20
) -> str:
    """
    Translate markdown while preserving exact structure.
    
    Args:
        markdown: Source markdown text
        glossary: Optional glossary terms
        on_progress: Progress callback (current, total)
        batch_size: Number of text segments per API call
    
    Returns:
        Translated markdown with identical structure
    """
    glossary = glossary or []
    
    log(f"Starting structure-preserving translation...")
    log(f"Input: {len(markdown)} chars")
    
    # Step 1: Parse and extract
    ast, segments, protected_map = extract_for_translation(markdown)
    
    if not segments:
        log("No translatable content found")
        return markdown
    
    log(f"Extracted {len(segments)} translatable segments")
    
    # Step 2: Batch translate
    api_key = get_current_gemini_key()
    if not api_key:
        raise Exception("No Gemini API key configured")
    
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.0-flash")
    
    translations: Dict[int, str] = {}
    total_batches = (len(segments) + batch_size - 1) // batch_size
    
    for batch_idx in range(total_batches):
        start = batch_idx * batch_size
        end = min(start + batch_size, len(segments))
        batch = segments[start:end]
        
        log(f"Translating batch {batch_idx + 1}/{total_batches} ({len(batch)} segments)")
        
        # Build prompt with just the text
        texts = [seg['text'] for seg in batch]
        prompt = build_text_only_prompt(texts, glossary)
        
        try:
            response = model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.3,
                    max_output_tokens=4096
                )
            )
            
            # Parse response
            translated_texts = parse_numbered_response(response.text, len(batch))
            
            # Map back to node IDs
            for seg, trans in zip(batch, translated_texts):
                translations[seg['id']] = trans
                
        except Exception as e:
            log(f"Batch {batch_idx + 1} failed: {e}")
            # Use original text as fallback
            for seg in batch:
                translations[seg['id']] = f"[FAILED: {seg['text'][:50]}...]"
        
        if on_progress:
            on_progress(end, len(segments))
        
        # Rate limit protection
        if batch_idx < total_batches - 1:
            await asyncio.sleep(0.5)
    
    # Step 3: Apply translations and render
    result = apply_and_render(ast, translations, protected_map)
    
    log(f"Translation complete. Output: {len(result)} chars")
    
    return result


async def translate_single_segment(
    text: str,
    glossary: List[GlossaryEntry] = None
) -> str:
    """
    Translate a single text segment (no markdown handling).
    Used for individual node retranslation.
    """
    glossary = glossary or []
    
    api_key = get_current_gemini_key()
    if not api_key:
        raise Exception("No Gemini API key configured")
    
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.0-flash")
    
    glossary_text = ""
    if glossary:
        terms = ", ".join([f"{g.english}={g.chinese}" for g in glossary])
        glossary_text = f"\nUse these terms: {terms}"
    
    prompt = f"""Translate to Simplified Chinese:{glossary_text}

{text}

Translation:"""
    
    response = model.generate_content(
        prompt,
        generation_config=genai.types.GenerationConfig(
            temperature=0.3,
            max_output_tokens=1024
        )
    )
    
    return response.text.strip()
