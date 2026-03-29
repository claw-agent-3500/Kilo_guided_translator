import logging
logger = logging.getLogger(__name__)
"""
Smart Batcher Service - Semantic chunking for optimal API usage.

Intelligently groups text blocks into batches that:
1. Respect semantic boundaries (don't split mid-sentence)
2. Keep headers with their content
3. Target ~2000 characters per batch for API efficiency
4. Use look-ahead to avoid awkward splits
"""

import re
from typing import List, Tuple, Optional
from dataclasses import dataclass
from enum import Enum


class BlockType(str, Enum):
    HEADER = "header"
    PARAGRAPH = "paragraph"
    LIST_ITEM = "list_item"
    TABLE = "table"
    CODE = "code"
    EMPTY = "empty"


@dataclass
class TextBlock:
    """A semantic block of text."""
    content: str
    block_type: BlockType
    level: int = 0  # Header level (1-6) or indent level
    
    @property
    def char_count(self) -> int:
        return len(self.content)
    
    @property
    def is_boundary(self) -> bool:
        """True if this block should start a new batch."""
        return self.block_type == BlockType.HEADER


@dataclass
class SemanticBatch:
    """A batch of text blocks grouped semantically."""
    blocks: List[TextBlock]
    context_header: Optional[str] = None  # Header for context
    
    @property
    def total_chars(self) -> int:
        return sum(b.char_count for b in self.blocks)
    
    @property
    def text(self) -> str:
        """Combined text with preserved formatting."""
        return "\n\n".join(b.content for b in self.blocks)
    
    @property
    def text_with_context(self) -> str:
        """Text with header context prepended."""
        if self.context_header:
            return f"{self.context_header}\n\n{self.text}"
        return self.text


class SmartBatcher:
    """
    Semantic text batcher for optimal API usage.
    
    Features:
    - Detects headers, paragraphs, lists, tables, code
    - Groups related content together
    - Respects character limits
    - Preserves context across batches
    """
    
    # Regex patterns
    HEADER_PATTERN = re.compile(r'^(#{1,6})\s+(.+)$', re.MULTILINE)
    LIST_PATTERN = re.compile(r'^(\s*)([-*+]|\d+\.)\s+', re.MULTILINE)
    CODE_BLOCK_PATTERN = re.compile(r'^```', re.MULTILINE)
    TABLE_PATTERN = re.compile(r'^\|.+\|$', re.MULTILINE)
    
    def __init__(
        self,
        target_chars: int = 2000,
        max_chars: int = 3500,
        min_chars: int = 500
    ):
        """
        Initialize the batcher.
        
        Args:
            target_chars: Target characters per batch (~2000)
            max_chars: Maximum characters before forcing a split
            min_chars: Minimum characters to start a new batch
        """
        self.target_chars = target_chars
        self.max_chars = max_chars
        self.min_chars = min_chars
    
    def log(self, msg: str):
        """Debug logger."""
        import datetime
        ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
        logger.info(f"[Batcher] {msg}")
    
    def detect_block_type(self, text: str) -> Tuple[BlockType, int]:
        """
        Detect the type of a text block.
        
        Returns:
            (BlockType, level) where level is header/indent level
        """
        text = text.strip()
        
        if not text:
            return BlockType.EMPTY, 0
        
        # Check for header (# Header)
        header_match = re.match(r'^(#{1,6})\s+', text)
        if header_match:
            level = len(header_match.group(1))
            return BlockType.HEADER, level
        
        # Check for list item
        list_match = re.match(r'^(\s*)([-*+]|\d+\.)\s+', text)
        if list_match:
            indent = len(list_match.group(1)) // 2
            return BlockType.LIST_ITEM, indent
        
        # Check for code block
        if text.startswith('```'):
            return BlockType.CODE, 0
        
        # Check for table row
        if re.match(r'^\|.+\|$', text):
            return BlockType.TABLE, 0
        
        return BlockType.PARAGRAPH, 0
    
    def parse_blocks(self, markdown: str) -> List[TextBlock]:
        """
        Parse markdown into semantic blocks.
        
        Handles:
        - Headers (preserve as boundaries)
        - Paragraphs (split by double newline)
        - Lists (keep items together)
        - Code blocks (keep whole)
        - Tables (keep whole)
        """
        blocks: List[TextBlock] = []
        
        # Split by double newlines (paragraph boundaries)
        raw_blocks = re.split(r'\n\s*\n', markdown)
        
        in_code_block = False
        code_content = []
        
        for raw in raw_blocks:
            raw = raw.strip()
            if not raw:
                continue
            
            # Handle code blocks
            code_fence_count = raw.count('```')
            
            if in_code_block:
                code_content.append(raw)
                if code_fence_count % 2 == 1:
                    # End of code block
                    blocks.append(TextBlock(
                        content="\n\n".join(code_content),
                        block_type=BlockType.CODE
                    ))
                    code_content = []
                    in_code_block = False
                continue
            
            if raw.startswith('```'):
                if code_fence_count == 2:
                    # Complete code block in one segment
                    blocks.append(TextBlock(
                        content=raw,
                        block_type=BlockType.CODE
                    ))
                else:
                    # Start of multi-paragraph code block
                    in_code_block = True
                    code_content = [raw]
                continue
            
            # Normal block
            block_type, level = self.detect_block_type(raw)
            blocks.append(TextBlock(
                content=raw,
                block_type=block_type,
                level=level
            ))
        
        return blocks
    
    def create_batches(self, markdown: str) -> List[SemanticBatch]:
        """
        Create semantic batches from markdown text.
        
        Algorithm:
        1. Parse into blocks
        2. Accumulate blocks until target size
        3. Use look-ahead to find good split points
        4. Never split mid-block
        5. Keep header context for each batch
        """
        blocks = self.parse_blocks(markdown)
        batches: List[SemanticBatch] = []
        
        current_blocks: List[TextBlock] = []
        current_chars = 0
        last_header: Optional[str] = None
        
        for i, block in enumerate(blocks):
            block_chars = block.char_count
            
            # Track headers for context
            if block.block_type == BlockType.HEADER:
                last_header = block.content
            
            # Check if adding this block would exceed limit
            would_exceed = (current_chars + block_chars) > self.max_chars
            at_target = current_chars >= self.target_chars
            
            # Decide whether to start new batch
            should_split = False
            
            if would_exceed and current_blocks:
                # Must split - too large
                should_split = True
            elif at_target and block.is_boundary:
                # Good split point at header
                should_split = True
            elif at_target and current_chars >= self.min_chars:
                # At target and have enough content - use look-ahead
                # Check if next block is a header (good split point)
                if i + 1 < len(blocks) and blocks[i + 1].is_boundary:
                    should_split = True
            
            if should_split and current_blocks:
                # Finalize current batch
                batches.append(SemanticBatch(
                    blocks=current_blocks.copy(),
                    context_header=last_header if batches else None
                ))
                current_blocks = []
                current_chars = 0
            
            # Add block to current batch
            current_blocks.append(block)
            current_chars += block_chars
        
        # Don't forget the last batch
        if current_blocks:
            batches.append(SemanticBatch(
                blocks=current_blocks,
                context_header=last_header if batches else None
            ))
        
        self.log(f"Created {len(batches)} batches from {len(blocks)} blocks")
        for i, batch in enumerate(batches):
            self.log(f"  Batch {i+1}: {len(batch.blocks)} blocks, {batch.total_chars} chars")
        
        return batches
    
    def batch_to_chunks(self, batches: List[SemanticBatch]) -> List[dict]:
        """
        Convert batches to chunk format for translation API.
        
        Returns list of dicts with 'id' and 'content' keys.
        """
        chunks = []
        for i, batch in enumerate(batches):
            chunks.append({
                "id": f"batch-{i}",
                "content": batch.text_with_context
            })
        return chunks


# Global instance
smart_batcher = SmartBatcher()


def create_semantic_batches(markdown: str, target_chars: int = 2000) -> List[SemanticBatch]:
    """
    Convenience function to create semantic batches.
    
    Args:
        markdown: Raw markdown text
        target_chars: Target characters per batch
    
    Returns:
        List of SemanticBatch objects
    """
    batcher = SmartBatcher(target_chars=target_chars)
    return batcher.create_batches(markdown)
