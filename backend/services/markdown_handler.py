"""
Markdown Handler - Structure-preserving translation.

Approach:
1. Parse markdown into AST (Abstract Syntax Tree)
2. Extract only translatable text nodes
3. Send text-only to Gemini (no formatting)
4. Replace text in AST with translations
5. Render back to markdown

This GUARANTEES structure preservation - Gemini never sees formatting!

Skeleton & State (Chunk Tagging):
- build_skeleton_and_dict() decouples Markdown syntax from translatable text.
- The skeleton stores [CHUNK_001] tags in place of text.
- The chunk_dict maps tag -> original English text.
- Export is a deterministic string replacement: no AST needed at export time.
"""

import re
from typing import List, Tuple, Dict, Optional
from dataclasses import dataclass, field
from enum import Enum


class NodeType(str, Enum):
    """Types of markdown nodes."""
    HEADER = "header"
    PARAGRAPH = "paragraph"
    LIST_ITEM = "list_item"
    TABLE_CELL = "table_cell"
    CODE_BLOCK = "code_block"      # Don't translate
    CODE_INLINE = "code_inline"    # Don't translate
    LINK_TEXT = "link_text"
    IMAGE_ALT = "image_alt"
    BLOCKQUOTE = "blockquote"
    TEXT = "text"
    FORMATTING = "formatting"      # Bold, italic wrappers
    SEPARATOR = "separator"        # ---, ===
    EMPTY = "empty"


@dataclass
class TextNode:
    """A translatable text segment."""
    id: int
    text: str
    node_type: NodeType
    prefix: str = ""      # Formatting before text (e.g., "## ", "- ", "| ")
    suffix: str = ""      # Formatting after text (e.g., " |")
    translatable: bool = True
    
    def __str__(self):
        return f"{self.prefix}{self.text}{self.suffix}"


@dataclass
class MarkdownAST:
    """Abstract Syntax Tree for markdown document."""
    nodes: List[TextNode] = field(default_factory=list)
    raw_lines: List[str] = field(default_factory=list)
    
    def get_translatable_texts(self) -> List[Tuple[int, str]]:
        """Get list of (id, text) for translatable nodes."""
        return [
            (node.id, node.text) 
            for node in self.nodes 
            if node.translatable and node.text.strip()
        ]
    
    def set_translation(self, node_id: int, translated: str):
        """Set translation for a specific node."""
        for node in self.nodes:
            if node.id == node_id:
                node.text = translated
                break
    
    def render(self) -> str:
        """Render AST back to markdown."""
        return "".join(str(node) for node in self.nodes)


class MarkdownHandler:
    """
    Parse and reconstruct markdown while preserving structure.
    
    Key insight: We treat markdown as a sequence of:
    - Formatting markers (prefixes/suffixes)
    - Translatable text content
    
    Only the text content gets sent to Gemini.
    """
    
    # Patterns for non-translatable content
    CODE_BLOCK_PATTERN = re.compile(r'^```.*$', re.MULTILINE)
    CODE_INLINE_PATTERN = re.compile(r'`[^`]+`')
    STANDARD_CODE_PATTERN = re.compile(r'\b(EN|ISO|IEC|DIN|ASTM|GB|JIS)\s*\d+[-\d.:]*\b')
    FORMULA_PATTERN = re.compile(r'\$[^$]+\$|\$\$[^$]+\$\$')
    URL_PATTERN = re.compile(r'https?://[^\s\)]+')
    # A line that is entirely a Markdown image (possibly with surrounding whitespace).
    # These are kept verbatim in the skeleton and never sent to Gemini / review queue.
    IMAGE_LINE_PATTERN = re.compile(r'^\s*!\[.*?\]\(.*?\)\s*$')
    
    def __init__(self):
        self.node_id = 0
    
    def _next_id(self) -> int:
        self.node_id += 1
        return self.node_id
    
    def parse(self, markdown: str) -> MarkdownAST:
        """
        Parse markdown into AST.
        
        Strategy: Process line by line, identifying structure markers.
        """
        self.node_id = 0
        ast = MarkdownAST()
        ast.raw_lines = markdown.split('\n')
        
        lines = markdown.split('\n')
        in_code_block = False
        code_block_content = []
        code_block_prefix = ""
        
        i = 0
        while i < len(lines):
            line = lines[i]
            
            # Handle code blocks (don't translate)
            if line.startswith('```'):
                if not in_code_block:
                    in_code_block = True
                    code_block_prefix = line + '\n'
                    code_block_content = []
                else:
                    # End of code block
                    full_code = code_block_prefix + '\n'.join(code_block_content) + '\n' + line
                    ast.nodes.append(TextNode(
                        id=self._next_id(),
                        text='\n'.join(code_block_content),
                        node_type=NodeType.CODE_BLOCK,
                        prefix=code_block_prefix,
                        suffix='\n' + line + '\n',
                        translatable=False
                    ))
                    in_code_block = False
                i += 1
                continue
            
            if in_code_block:
                code_block_content.append(line)
                i += 1
                continue
            
            # Empty line
            if not line.strip():
                ast.nodes.append(TextNode(
                    id=self._next_id(),
                    text="",
                    node_type=NodeType.EMPTY,
                    prefix="\n",
                    translatable=False
                ))
                i += 1
                continue
            
            # Headers (# ## ### etc.)
            header_match = re.match(r'^(#{1,6})\s+(.+)$', line)
            if header_match:
                prefix = header_match.group(1) + ' '
                text = header_match.group(2)
                ast.nodes.append(TextNode(
                    id=self._next_id(),
                    text=text,
                    node_type=NodeType.HEADER,
                    prefix=prefix,
                    suffix='\n',
                    translatable=True
                ))
                i += 1
                continue
            
            # Horizontal rules
            if re.match(r'^[-*_]{3,}\s*$', line):
                ast.nodes.append(TextNode(
                    id=self._next_id(),
                    text=line,
                    node_type=NodeType.SEPARATOR,
                    suffix='\n',
                    translatable=False
                ))
                i += 1
                continue
            
            # Table rows
            if '|' in line and re.match(r'^\s*\|', line):
                self._parse_table_row(ast, line)
                i += 1
                continue
            
            # List items
            list_match = re.match(r'^(\s*)([-*+]|\d+\.)\s+(.*)$', line)
            if list_match:
                indent = list_match.group(1)
                marker = list_match.group(2)
                text = list_match.group(3)
                ast.nodes.append(TextNode(
                    id=self._next_id(),
                    text=text,
                    node_type=NodeType.LIST_ITEM,
                    prefix=f"{indent}{marker} ",
                    suffix='\n',
                    translatable=True
                ))
                i += 1
                continue
            
            # Blockquote
            if line.startswith('>'):
                quote_match = re.match(r'^(>\s*)(.*)$', line)
                if quote_match:
                    ast.nodes.append(TextNode(
                        id=self._next_id(),
                        text=quote_match.group(2),
                        node_type=NodeType.BLOCKQUOTE,
                        prefix=quote_match.group(1),
                        suffix='\n',
                        translatable=True
                    ))
                i += 1
                continue
            
            # Standalone image line — keep verbatim, do NOT translate
            if self.IMAGE_LINE_PATTERN.match(line):
                ast.nodes.append(TextNode(
                    id=self._next_id(),
                    text=line,
                    node_type=NodeType.PARAGRAPH,
                    suffix='\n',
                    translatable=False
                ))
                i += 1
                continue

            # Regular paragraph
            ast.nodes.append(TextNode(
                id=self._next_id(),
                text=line,
                node_type=NodeType.PARAGRAPH,
                suffix='\n',
                translatable=True
            ))
            i += 1
        
        return ast
    
    def _parse_table_row(self, ast: MarkdownAST, line: str):
        """Parse a table row, preserving cell structure."""
        # Check if it's a separator row (|---|---|  or  |:---|:---:|---:|)
        # Use [-\s:] so "-" is treated as a literal, not a range operator
        if re.match(r'^\s*\|[-\s:|]+\|[-\s:|]*$', line):
            ast.nodes.append(TextNode(
                id=self._next_id(),
                text=line,
                node_type=NodeType.SEPARATOR,
                suffix='\n',
                translatable=False
            ))
            return
        
        # Split by | but preserve structure
        cells = line.split('|')
        
        # First empty cell (before first |)
        if cells[0].strip() == '':
            ast.nodes.append(TextNode(
                id=self._next_id(),
                text="",
                node_type=NodeType.TABLE_CELL,
                prefix="|",
                translatable=False
            ))
            cells = cells[1:]
        
        # Process each cell
        for i, cell in enumerate(cells):
            is_last = (i == len(cells) - 1)
            cell_text = cell.strip()
            
            # Calculate padding
            leading_space = len(cell) - len(cell.lstrip())
            trailing_space = len(cell) - len(cell.rstrip())
            
            if is_last and cell_text == '':
                # Trailing empty cell
                ast.nodes.append(TextNode(
                    id=self._next_id(),
                    text="",
                    node_type=NodeType.TABLE_CELL,
                    suffix='\n',
                    translatable=False
                ))
            else:
                ast.nodes.append(TextNode(
                    id=self._next_id(),
                    text=cell_text,
                    node_type=NodeType.TABLE_CELL,
                    prefix=' ' * leading_space,
                    suffix=' ' * trailing_space + ('|' if not is_last else '|\n'),
                    translatable=bool(cell_text)
                ))
    
    def extract_translatable(self, ast: MarkdownAST) -> List[Dict]:
        """
        Extract translatable text segments.
        
        Returns list of {id, text, type} for translation.
        """
        segments = []
        for node in ast.nodes:
            if node.translatable and node.text.strip():
                # Further process to protect inline elements
                processed_text, protected = self._protect_inline_elements(node.text)
                segments.append({
                    'id': node.id,
                    'text': processed_text,
                    'type': node.node_type.value,
                    'protected': protected
                })
        return segments
    
    def _protect_inline_elements(self, text: str) -> Tuple[str, Dict[str, str]]:
        """
        Replace inline code, URLs, standards codes with placeholders.
        
        Returns: (processed_text, {placeholder: original})
        """
        protected = {}
        result = text
        
        # Protect inline code
        for i, match in enumerate(self.CODE_INLINE_PATTERN.finditer(text)):
            placeholder = f"__CODE_{i}__"
            protected[placeholder] = match.group()
            result = result.replace(match.group(), placeholder, 1)
        
        # Protect standards codes (EN 13001, ISO 9001, etc.)
        for i, match in enumerate(self.STANDARD_CODE_PATTERN.finditer(result)):
            placeholder = f"__STD_{i}__"
            if placeholder not in protected:
                protected[placeholder] = match.group()
                result = result.replace(match.group(), placeholder, 1)
        
        # Protect formulas
        for i, match in enumerate(self.FORMULA_PATTERN.finditer(result)):
            placeholder = f"__FORMULA_{i}__"
            if placeholder not in protected:
                protected[placeholder] = match.group()
                result = result.replace(match.group(), placeholder, 1)
        
        # Protect URLs
        for i, match in enumerate(self.URL_PATTERN.finditer(result)):
            placeholder = f"__URL_{i}__"
            if placeholder not in protected:
                protected[placeholder] = match.group()
                result = result.replace(match.group(), placeholder, 1)
        
        return result, protected
    
    def restore_protected(self, text: str, protected: Dict[str, str]) -> str:
        """Restore protected elements in translated text."""
        result = text
        for placeholder, original in protected.items():
            result = result.replace(placeholder, original)
        return result
    
    def apply_translations(
        self,
        ast: MarkdownAST,
        translations: Dict[int, str],
        protected_map: Dict[int, Dict[str, str]]
    ):
        """
        Apply translations back to AST.
        
        Args:
            ast: The parsed AST
            translations: {node_id: translated_text}
            protected_map: {node_id: {placeholder: original}}
        """
        for node in ast.nodes:
            if node.id in translations:
                translated = translations[node.id]
                # Restore protected elements
                if node.id in protected_map:
                    translated = self.restore_protected(translated, protected_map[node.id])
                node.text = translated


# Convenience functions

def parse_markdown(markdown: str) -> MarkdownAST:
    """Parse markdown into AST."""
    handler = MarkdownHandler()
    return handler.parse(markdown)


def extract_for_translation(markdown: str) -> Tuple[MarkdownAST, List[Dict], Dict[int, Dict]]:
    """
    Extract translatable content from markdown.
    
    Returns:
        - ast: Parsed AST
        - segments: List of {id, text, type} to translate
        - protected_map: Map of node_id -> protected elements
    """
    handler = MarkdownHandler()
    ast = handler.parse(markdown)
    
    segments = []
    protected_map = {}
    
    for node in ast.nodes:
        if node.translatable and node.text.strip():
            processed, protected = handler._protect_inline_elements(node.text)
            segments.append({
                'id': node.id,
                'text': processed,
                'type': node.node_type.value
            })
            if protected:
                protected_map[node.id] = protected
    
    return ast, segments, protected_map


def apply_and_render(
    ast: MarkdownAST,
    translations: Dict[int, str],
    protected_map: Dict[int, Dict[str, str]]
) -> str:
    """
    Apply translations and render back to markdown.
    
    Args:
        ast: Parsed AST
        translations: {node_id: translated_text}
        protected_map: {node_id: {placeholder: original}}
    
    Returns:
        Translated markdown with preserved structure
    """
    handler = MarkdownHandler()
    handler.apply_translations(ast, translations, protected_map)
    return ast.render()


# ============================================================
# Skeleton & State (Chunk Tagging) — Primary Export Path
# ============================================================

def build_skeleton_and_dict(
    markdown: str
) -> Tuple[str, Dict[str, str]]:
    """
    Parse markdown and produce two decoupled objects:

    skeleton   — Full markdown with translatable text replaced by [CHUNK_001] tags.
                 All structural syntax (|, #, >, -, **, $...$) is preserved exactly.

    chunk_dict — {"CHUNK_001": "Original English text", ...}
                 Contains only the plain translatable text, indexed by tag.
                 Inline elements (formulas, URLs, inline code) are stored as
                 protected placeholders inside chunk_dict values so they survive
                 translation and are restored at export time.

    Usage:
        skeleton, chunk_dict = build_skeleton_and_dict(markdown_text)
        # Store skeleton in DB once — never touch it again.
        # Feed chunk_dict values to Gemini for translation.
        # At export: for tag, translation in finalized_dict.items():
        #                skeleton = skeleton.replace(f"[{tag}]", translation)
    """
    handler = MarkdownHandler()
    ast = handler.parse(markdown)

    chunk_dict: dict[str, str] = {}
    tag_counter = 0

    for node in ast.nodes:
        if not node.translatable or not node.text.strip():
            continue

        tag_counter += 1
        tag = f"CHUNK_{tag_counter:03d}"

        # Protect inline elements within this node's text so the LLM never
        # sees formulas, URLs, or inline code — they round-trip perfectly.
        processed_text, _protected = handler._protect_inline_elements(node.text)

        # Store the (lightly processed) original English in the dict.
        chunk_dict[tag] = processed_text

        # Replace the node's text with the bracketed tag so render() produces the skeleton.
        # e.g. "Determine the shear force." → "[CHUNK_001]"
        node.text = f"[{tag}]"

    skeleton = ast.render()
    return skeleton, chunk_dict


def reconstruct_from_skeleton(
    skeleton: str,
    translations: Dict[str, str]
) -> str:
    """
    Deterministic export: replace each [CHUNK_XXX] tag in the skeleton with
    the corresponding translated (or original) text.

    Args:
        skeleton:     The tagged Markdown string produced by build_skeleton_and_dict().
        translations: {"CHUNK_001": "确定剪力。", ...}
                      Only approved/finalized entries need be present.
                      Any unreplaced tags remain as-is (graceful fallback).

    Returns:
        Final translated Markdown string with full structural fidelity.
    """
    result = skeleton
    for tag, translated_text in translations.items():
        result = result.replace(f"[{tag}]", translated_text)
    return result
