"""
PDF Export Service - Generate text-based PDFs with Chinese support.
Uses fpdf2 with font support for CJK character rendering.
"""

import logging

logger = logging.getLogger(__name__)

import os
import re
import urllib.request
from pathlib import Path
from fpdf import FPDF
from typing import List, Dict, Any

# Font configuration
FONTS_DIR = Path(__file__).parent.parent / "fonts"
FONT_NAME = "ChineseFont"


def get_chinese_font_path() -> str:
    """Find a usable Chinese font. Returns font file path."""
    FONTS_DIR.mkdir(exist_ok=True)
    
    # Check for previously downloaded font
    local_font = FONTS_DIR / "chinese_font.ttf"
    if local_font.exists() and local_font.stat().st_size > 100000:
        logger.info(f"[PDF Export] Using local font: {local_font}")
        return str(local_font)
    
    # Windows system fonts (prefer TTF over TTC)
    # Note: fpdf2 doesn't support .ttc files well
    windows_ttf_fonts = [
        "C:/Windows/Fonts/simhei.ttf",      # SimHei
        "C:/Windows/Fonts/SIMHEI.TTF",      # SimHei (uppercase)
        "C:/Windows/Fonts/simsunbd.ttf",    # SimSun Bold
        "C:/Windows/Fonts/simfang.ttf",     # FangSong
        "C:/Windows/Fonts/simkai.ttf",      # KaiTi
        "C:/Windows/Fonts/STKAITI.TTF",     # STKaiti
        "C:/Windows/Fonts/STSONG.TTF",      # STSong
        "C:/Windows/Fonts/STFANGSO.TTF",    # STFangSong
    ]
    
    for font_path in windows_ttf_fonts:
        if os.path.exists(font_path):
            logger.info(f"[PDF Export] Using system font: {font_path}")
            return font_path
    
    # Try downloading a font
    font_urls = [
        # Noto Sans SC from various sources
        "https://github.com/AikoCute-Offical/Aikopanel-Pro/raw/main/public/fonts/NotoSansSC-Regular.ttf",
        "https://github.com/AikoCute-Offical/Aikopanel-Pro/raw/refs/heads/main/public/fonts/NotoSansSC-Regular.ttf",
    ]
    
    for url in font_urls:
        try:
            logger.info(f"[PDF Export] Trying to download font from: {url}")
            urllib.request.urlretrieve(url, local_font)
            if local_font.exists() and local_font.stat().st_size > 100000:
                logger.info(f"[PDF Export] Font downloaded: {local_font.stat().st_size} bytes")
                return str(local_font)
        except Exception as e:
            logger.info(f"[PDF Export] Font download failed: {e}")
            continue
    
    # Return None - will use built-in font (ASCII only)
    logger.info("[PDF Export] WARNING: No Chinese font found. Using built-in font (limited to ASCII).")
    return None


class ChinesePDF(FPDF):
    """Custom PDF class with optional Chinese font support."""
    
    def __init__(self, font_path: str = None):
        super().__init__()
        
        # Set margins first
        self.set_margins(left=15, top=15, right=15)
        self.set_auto_page_break(auto=True, margin=20)
        
        self.custom_font_loaded = False
        self.font_family_name = "Helvetica"  # Default
        
        if font_path:
            try:
                self.add_font(FONT_NAME, "", font_path, uni=True)
                self.font_family_name = FONT_NAME
                self.custom_font_loaded = True
                logger.info(f"[PDF Export] Custom font loaded: {FONT_NAME}")
            except Exception as e:
                logger.info(f"[PDF Export] Failed to load font: {e}")
                self.font_family_name = "Helvetica"
    
    def _safe_text(self, text: str) -> str:
        """Ensure text is safe for current font."""
        if self.custom_font_loaded:
            return text
        # For built-in font, replace non-ASCII with [?]
        return ''.join(c if ord(c) < 128 else '[?]' for c in text)
        
    def header(self):
        """Page header - empty to preserve original document structure."""
        pass  # No header text - preserve original structure
        
    def footer(self):
        """Page footer with page number."""
        self.set_y(-15)
        self.set_font(self.font_family_name, "", 9)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, f"Page {self.page_no()}", 0, align="C")
        
    def add_title(self, title: str):
        """Add document title."""
        self.set_font(self.font_family_name, "", 18)
        self.set_text_color(0, 0, 0)
        self.multi_cell(0, 10, self._safe_text(title))
        self.ln(3)
        
    def add_metadata(self, text: str):
        """Add metadata text (small, gray)."""
        self.set_font(self.font_family_name, "", 10)
        self.set_text_color(100, 100, 100)
        self.multi_cell(0, 5, self._safe_text(text))
        self.ln(3)
        
    def add_heading(self, text: str, level: int = 1):
        """Add heading with size based on level (1-6)."""
        sizes = {1: 16, 2: 14, 3: 13, 4: 12, 5: 11, 6: 10}
        size = sizes.get(level, 12)
        
        self.set_font(self.font_family_name, "", size)
        self.set_text_color(30, 30, 50)
        
        # Add some spacing before heading
        if self.get_y() > 30:
            self.ln(3)
            
        self.multi_cell(0, size * 0.6, self._safe_text(text))
        self.ln(2)
        
    def add_paragraph(self, text: str):
        """Add normal paragraph text."""
        self.set_font(self.font_family_name, "", 10)
        self.set_text_color(50, 50, 50)
        self.multi_cell(0, 5, self._safe_text(text))
        self.ln(2)
        
    def add_list_item(self, text: str, indent: int = 0):
        """Add bulleted list item."""
        self.set_font(self.font_family_name, "", 10)
        self.set_text_color(50, 50, 50)
        
        bullet = "-" if not self.custom_font_loaded else "•"
        x = self.get_x() + indent * 5
        self.set_x(x)
        self.cell(5, 5, bullet)
        self.multi_cell(0, 5, self._safe_text(text))
        
    def render_markdown(self, text: str):
        """Parse and render markdown-like text."""
        lines = text.split('\n')
        
        for line in lines:
            stripped = line.strip()
            
            if not stripped:
                self.ln(2)
                continue
                
            # Heading detection
            if stripped.startswith('######'):
                self.add_heading(stripped[6:].strip(), 6)
            elif stripped.startswith('#####'):
                self.add_heading(stripped[5:].strip(), 5)
            elif stripped.startswith('####'):
                self.add_heading(stripped[4:].strip(), 4)
            elif stripped.startswith('###'):
                self.add_heading(stripped[3:].strip(), 3)
            elif stripped.startswith('##'):
                self.add_heading(stripped[2:].strip(), 2)
            elif stripped.startswith('#'):
                self.add_heading(stripped[1:].strip(), 1)
            # List items
            elif stripped.startswith('- ') or stripped.startswith('* '):
                self.add_list_item(stripped[2:])
            elif re.match(r'^\d+\. ', stripped):
                self.add_list_item(re.sub(r'^\d+\. ', '', stripped))
            # Normal paragraph
            else:
                self.add_paragraph(stripped)


def generate_translation_pdf(
    chunks: List[Dict[str, Any]],
    title: str = "Technical Translation"
) -> bytes:
    """
    Generate a text-based PDF from translated chunks.
    
    Args:
        chunks: List of translated chunk dictionaries with 'translation' and 'type' fields
        title: Document title
        
    Returns:
        PDF file as bytes
    """
    # Try to get a Chinese font
    font_path = get_chinese_font_path()
    
    pdf = ChinesePDF(font_path)
    
    # Set PDF document metadata (not visible on page, but in document properties)
    from datetime import datetime
    pdf.set_title(title)
    pdf.set_author("Guided Translator")
    pdf.set_creation_date(datetime.now())
    
    pdf.add_page()
    
    # No visible header - preserve original document structure
    
    # Render each chunk
    for i, chunk in enumerate(chunks):
        translation = chunk.get('translation', chunk.get('translated', ''))
        chunk_type = chunk.get('type', 'paragraph')
        
        if not translation:
            continue
            
        # Render based on chunk type
        if chunk_type == 'heading':
            # Try to detect heading level from content
            if translation.startswith('#'):
                pdf.render_markdown(translation)
            else:
                pdf.add_heading(translation, 2)
        else:
            pdf.render_markdown(translation)
    
    # fpdf2's output() returns bytearray, convert to bytes
    return bytes(pdf.output())


# Test function
if __name__ == "__main__":
    test_chunks = [
        {"translation": "# Technical Standard Translation", "type": "heading"},
        {"translation": "This is a test paragraph with mixed content.", "type": "paragraph"},
        {"translation": "## Chapter 2 Safety Requirements", "type": "heading"},
        {"translation": "- First requirement\n- Second requirement\n- Third requirement", "type": "paragraph"},
    ]
    
    pdf_bytes = generate_translation_pdf(test_chunks, "Test Document")
    with open("test_output.pdf", "wb") as f:
        f.write(pdf_bytes)
    logger.info(f"Test PDF generated: test_output.pdf ({len(pdf_bytes)} bytes)")
