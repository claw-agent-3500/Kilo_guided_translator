"""
MinerU Service - PDF to Markdown extraction.
Based on official MinerU API documentation.

Flow:
1. POST /file-urls/batch → get batch_id + upload_url
2. PUT upload_url with file data
3. GET /extract-results/batch/{batch_id} → poll until extract_result exists
4. Download full_zip_url → extract markdown from ZIP
"""

import httpx
import requests
import asyncio
import uuid
import json
import io
import zipfile
import tempfile
import os
from typing import Optional, Callable
from config import settings
from models.responses import DocumentStructure


def log(msg: str):
    """Debug logger with timestamp."""
    import datetime
    ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{ts}] [MinerU] {msg}")


def is_mineru_configured() -> bool:
    """Check if MinerU API key is configured."""
    api_key = getattr(settings, 'mineru_api_key', '')
    configured = bool(api_key)
    log(f"Config check - api_key: {'SET' if configured else 'NOT SET'}")
    return configured


# ==================== Step 1: Get Upload URL ====================

async def get_upload_url(filename: str) -> tuple[str, str]:
    """
    Step 1: Request pre-signed upload URL from MinerU.
    Returns (batch_id, upload_url)
    """
    data_id = str(uuid.uuid4())[:8]
    
    log(f"Step 1: Requesting upload URL for: {filename}")
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{settings.mineru_api_base}/file-urls/batch",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.mineru_api_key}"
            },
            json={
                "files": [{"name": filename, "data_id": data_id}],
                "model_version": "vlm"
            }
        )
        
        log(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            raise Exception(f"MinerU API error: {response.status_code} - {response.text[:200]}")
        
        result = response.json()
        log(f"Response: code={result.get('code')}, msg={result.get('msg')}")
        
        if result.get("code") != 0:
            raise Exception(f"MinerU error: {result.get('msg')}")
        
        batch_id = result["data"]["batch_id"]
        upload_url = result["data"]["file_urls"][0]
        
        log(f"Got batch_id: {batch_id}")
        log(f"Got upload_url: {upload_url[:80]}...")
        
        return batch_id, upload_url


# ==================== Step 2: Upload File ====================

async def upload_file(upload_url: str, file_content: bytes, filename: str) -> None:
    """
    Step 2: Upload file to pre-signed URL.
    Uses temp file + open() pattern from official example.
    """
    file_size_mb = len(file_content) / (1024 * 1024)
    log(f"Step 2: Uploading {filename} ({file_size_mb:.2f} MB)")
    
    # Save to temp file (matching official example pattern)
    temp_path = None
    try:
        fd, temp_path = tempfile.mkstemp(suffix='.pdf')
        os.write(fd, file_content)
        os.close(fd)
        
        def _upload():
            # Official pattern: with open(file, 'rb') as f: requests.put(url, data=f)
            with open(temp_path, 'rb') as f:
                return requests.put(upload_url, data=f, timeout=600)
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, _upload)
        
        log(f"Upload response status: {response.status_code}")
        
        if response.status_code != 200:
            raise Exception(f"Upload failed: {response.status_code}")
        
        log("Upload successful!")
        
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


# ==================== Step 3: Poll Task Status ====================

async def poll_task_status(batch_id: str, on_progress: Optional[Callable[[int], None]] = None) -> str:
    """
    Step 3: Poll task status until complete.
    Returns full_zip_url when extract_result is available.
    
    IMPORTANT: Use /extract-results/batch/{batch_id} for batch uploads
    (NOT /extract/task/{task_id} which is for single-file URL submissions)
    """
    poll_interval = 5
    max_wait = 600
    elapsed = 0
    
    log(f"Step 3: Polling batch status for: {batch_id}")
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        while elapsed < max_wait:
            response = await client.get(
                f"{settings.mineru_api_base}/extract-results/batch/{batch_id}",
                headers={"Authorization": f"Bearer {settings.mineru_api_key}"}
            )
            
            if response.status_code != 200:
                log(f"Poll error: {response.status_code}")
                await asyncio.sleep(poll_interval)
                elapsed += poll_interval
                continue
            
            result = response.json()
            
            if result.get("code") != 0:
                log(f"API error: {result.get('msg')}")
                await asyncio.sleep(poll_interval)
                elapsed += poll_interval
                continue
            
            data = result.get("data", {})
            extract_result = data.get("extract_result", [])
            
            log(f"Polling... extract_result count: {len(extract_result)}")
            
            if on_progress:
                on_progress(30 + min(50, elapsed // 5))
            
            if extract_result:
                first = extract_result[0]
                state = first.get("state", "unknown")
                
                log(f"Task state: {state}")
                
                if state == "done":
                    zip_url = first.get("full_zip_url")
                    if zip_url:
                        log(f"Task complete! ZIP URL: {zip_url[:80]}...")
                        return zip_url
                    else:
                        # Try alternative field names
                        log(f"Result keys: {first.keys()}")
                        raise Exception("Task done but no ZIP URL found")
                
                if state == "failed":
                    err_msg = first.get("err_msg", "Unknown error")
                    raise Exception(f"MinerU extraction failed: {err_msg}")
            
            # Continue polling
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
    
    raise Exception(f"Task timed out after {max_wait}s")


# ==================== Step 4: Download and Extract ZIP ====================

async def download_and_extract_markdown(zip_url: str) -> str:
    """
    Step 4: Download ZIP and extract markdown content.
    MinerU returns results in a ZIP file containing .md files.
    """
    log(f"Step 4: Downloading results from ZIP...")
    
    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        response = await client.get(zip_url)
        
        if response.status_code != 200:
            raise Exception(f"Failed to download ZIP: {response.status_code}")
        
        log(f"Downloaded ZIP: {len(response.content)} bytes")
        
        # Extract markdown from ZIP
        zip_buffer = io.BytesIO(response.content)
        
        with zipfile.ZipFile(zip_buffer, 'r') as zf:
            file_list = zf.namelist()
            log(f"ZIP contains: {file_list}")
            
            # Find markdown file(s)
            md_files = [f for f in file_list if f.endswith('.md')]
            
            if not md_files:
                log(f"No .md files found, looking for alternatives...")
                for name in file_list:
                    log(f"  - {name}")
                raise Exception("No markdown file found in ZIP")
            
            # Read the main markdown file
            markdown_content = ""
            for md_file in md_files:
                content = zf.read(md_file).decode('utf-8')
                markdown_content += content + "\n\n"
                log(f"Extracted {md_file}: {len(content)} chars")
            
            return markdown_content.strip()


# ==================== HTML Table to Markdown Conversion ====================

def convert_html_tables_to_markdown(content: str) -> str:
    """
    Convert HTML <table> elements to Markdown table format.
    MinerU sometimes outputs tables as HTML which is harder to translate.
    Also unescapes all HTML entities (e.g. &lt; → <, &amp; → &) in the
    full output so they never leak into chunk text.
    """
    import re
    import html as html_lib

    def html_table_to_markdown(match: re.Match) -> str:
        """Convert a single HTML table to Markdown."""
        table_html = match.group(0)

        # Extract all rows
        rows = re.findall(r'<tr[^>]*>(.*?)</tr>', table_html, re.DOTALL | re.IGNORECASE)
        if not rows:
            return table_html  # Return original if can't parse

        markdown_rows = []

        for row_idx, row in enumerate(rows):
            # Extract cells (both <td> and <th>)
            cells = re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', row, re.DOTALL | re.IGNORECASE)

            # Clean cell content (remove HTML tags, decode entities, normalize whitespace)
            cleaned_cells = []
            for cell in cells:
                # Remove nested HTML tags
                clean = re.sub(r'<[^>]+>', '', cell)
                # Decode HTML entities (&lt; → <, &amp; → &, &le; → ≤, etc.)
                clean = html_lib.unescape(clean)
                # Normalize whitespace
                clean = ' '.join(clean.split())
                # Escape pipe characters for Markdown table syntax
                clean = clean.replace('|', '\\|')
                cleaned_cells.append(clean)

            if cleaned_cells:
                # Build markdown row
                md_row = '| ' + ' | '.join(cleaned_cells) + ' |'
                markdown_rows.append(md_row)

                # Add separator after first row (header)
                if row_idx == 0:
                    separator = '|' + '|'.join(['---' for _ in cleaned_cells]) + '|'
                    markdown_rows.append(separator)

        if markdown_rows:
            return '\n'.join(markdown_rows)
        return table_html  # Return original if conversion failed

    # Find and replace all HTML tables
    pattern = r'<table[^>]*>.*?</table>'
    result = re.sub(pattern, html_table_to_markdown, content, flags=re.DOTALL | re.IGNORECASE)

    # Count conversions for logging
    original_count = len(re.findall(r'<table', content, re.IGNORECASE))
    remaining_count = len(re.findall(r'<table', result, re.IGNORECASE))
    if original_count > 0:
        log(f"Converted {original_count - remaining_count}/{original_count} HTML tables to Markdown")

    # Unescape any residual HTML entities in non-table text that MinerU may
    # have encoded (e.g. bare &lt; in paragraph text, &amp; in formulae, etc.)
    result = html_lib.unescape(result)

    return result


# ==================== Main Entry Point ====================

async def extract_with_mineru(
    file_content: bytes,
    filename: str,
    on_progress: Optional[Callable[[int], None]] = None
) -> DocumentStructure:
    """
    Main extraction function using MinerU Cloud API.
    
    Flow:
    1. Request upload URL
    2. Upload file
    3. Poll for completion
    4. Download and extract markdown from ZIP
    """
    log("="*60)
    log(f"EXTRACT_WITH_MINERU: {filename}")
    log(f"File size: {len(file_content)/1024/1024:.2f} MB")
    log("="*60)
    
    if not is_mineru_configured():
        raise Exception("MinerU API key not configured")
    
    try:
        # Step 1: Get upload URL
        if on_progress:
            on_progress(5)
        batch_id, upload_url = await get_upload_url(filename)
        
        # Step 2: Upload file
        if on_progress:
            on_progress(15)
        await upload_file(upload_url, file_content, filename)
        
        # Step 3: Poll for completion
        if on_progress:
            on_progress(30)
        zip_url = await poll_task_status(batch_id, on_progress)
        
        # Step 4: Download and extract markdown
        if on_progress:
            on_progress(85)
        markdown_content = await download_and_extract_markdown(zip_url)
        
        # Step 4.5: Convert HTML tables to Markdown
        markdown_content = convert_html_tables_to_markdown(markdown_content)
        
        log(f"SUCCESS! Markdown length: {len(markdown_content)} chars")
        
        if on_progress:
            on_progress(100)
        
        # Build result
        language = detect_language(markdown_content)
        word_count = len(markdown_content.split())
        pages = max(1, word_count // 500)
        
        return DocumentStructure(
            text=markdown_content,
            pages=pages,
            word_count=word_count,
            language=language
        )
        
    except Exception as e:
        log(f"EXTRACTION FAILED: {e}")
        raise


# ==================== Helper ====================

def detect_language(text: str) -> str:
    """Detect language based on Chinese character ratio."""
    chinese_chars = len([c for c in text if '\u4e00' <= c <= '\u9fff'])
    total_chars = len(text)
    if total_chars > 0 and chinese_chars / total_chars > 0.1:
        return "zh"
    return "en"
