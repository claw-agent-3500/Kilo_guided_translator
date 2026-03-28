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
        After the initial line-by-line pass, a merge step joins paragraph
        continuation lines that MinerU may have split across separate lines
        (e.g. a list-item body wrapped onto the next bare line).
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

        # Post-parse: merge paragraph continuation lines produced by wrapping
        # (e.g. MinerU sometimes splits one logical paragraph into bare lines).
        self._merge_paragraph_continuations(ast)

        return ast

    # Sentence-terminal characters: a paragraph ending with one of these is
    # a natural break and must NOT be merged with the following line.
    _SENTENCE_END_RE = re.compile(r'[.?!。！？]\s*$')
    # Fragment signals: lines ending with these are almost certainly continuations.
    _FRAGMENT_END_RE = re.compile(r'[,;:]\s*$|\w\s*$')

    # Maximum combined character count for merging through a blank line.
    # Prevents merging two genuinely independent short paragraphs.
    _MAX_MERGE_CHARS = 300

    def _merge_paragraph_continuations(self, ast: MarkdownAST) -> None:
        """
        Merge consecutive PARAGRAPH nodes that are continuation lines.

        MinerU often wraps a single logical paragraph (or list-item body)
        across multiple bare lines, each of which the parser turns into its
        own PARAGRAPH node.  This pass collapses them.

        Two merge patterns are supported:

        Pattern 1 — Direct adjacency (PARAGRAPH → PARAGRAPH):
          Merge if the first paragraph does NOT end with sentence-terminal
          punctuation (.?!。！？).

        Pattern 2 — Through a single blank line (PARAGRAPH → EMPTY → PARAGRAPH):
          MinerU frequently inserts a blank line between reflowed lines of the
          same logical paragraph.  We merge through ONE blank line when:
            a) the first paragraph does NOT end with sentence-terminal punct,
            b) the next non-EMPTY node is also a translatable PARAGRAPH,
            c) the combined character count is ≤ _MAX_MERGE_CHARS,
            d) there is NOT a double-blank (EMPTY → EMPTY → …) which signals
               a true paragraph break.

        Both patterns consume the merged node and (for pattern 2) the
        intervening EMPTY node, keeping the AST compact.
        """
        merged = True
        while merged:
            merged = False
            new_nodes: list = []
            skip_count = 0
            for idx, node in enumerate(ast.nodes):
                if skip_count > 0:
                    skip_count -= 1
                    continue

                # Only attempt merge when the current node is a translatable PARAGRAPH
                if (
                    node.node_type != NodeType.PARAGRAPH
                    or not node.translatable
                    or not node.text.strip()
                    or self._SENTENCE_END_RE.search(node.text)
                ):
                    new_nodes.append(node)
                    continue

                # --- Pattern 1: direct adjacency ---
                if idx + 1 < len(ast.nodes):
                    nxt = ast.nodes[idx + 1]
                    if (
                        nxt.node_type == NodeType.PARAGRAPH
                        and nxt.translatable
                        and nxt.text.strip()
                    ):
                        node.text = node.text.rstrip() + ' ' + nxt.text.lstrip()
                        skip_count = 1
                        merged = True
                        new_nodes.append(node)
                        continue

                # --- Pattern 2: through a single blank line ---
                if idx + 2 < len(ast.nodes):
                    mid = ast.nodes[idx + 1]
                    nxt = ast.nodes[idx + 2]
                    if (
                        mid.node_type == NodeType.EMPTY
                        and nxt.node_type == NodeType.PARAGRAPH
                        and nxt.translatable
                        and nxt.text.strip()
                        # Character budget guard
                        and (len(node.text) + len(nxt.text)) <= self._MAX_MERGE_CHARS
                    ):
                        node.text = node.text.rstrip() + ' ' + nxt.text.lstrip()
                        skip_count = 2   # skip the EMPTY and the merged PARAGRAPH
                        merged = True
                        new_nodes.append(node)
                        continue

                new_nodes.append(node)
            ast.nodes = new_nodes

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

        Each match is replaced at its **exact span** (working right-to-left so
        earlier offsets are not invalidated). This guarantees that:
        - Identical tokens appearing more than once each get a unique placeholder.
        - No placeholder ever appears in an untranslated chunk because of a
          collision with a placeholder from a different chunk.

        Returns: (processed_text, {placeholder: original})
        """
        protected = {}

        def _substitute(pattern: re.Pattern, prefix: str, text: str) -> str:
            """Replace every match of *pattern* in *text* with a unique placeholder."""
            matches = list(pattern.finditer(text))
            # Process right-to-left so span indices stay valid as we mutate the string.
            for i, match in enumerate(reversed(matches)):
                idx = len(matches) - 1 - i  # ascending index for placeholder name
                placeholder = f"__{prefix}_{idx}__"
                protected[placeholder] = match.group()
                text = text[:match.start()] + placeholder + text[match.end():]
            return text

        result = text
        result = _substitute(self.CODE_INLINE_PATTERN, "CODE", result)
        result = _substitute(self.STANDARD_CODE_PATTERN, "STD", result)
        result = _substitute(self.FORMULA_PATTERN, "FORMULA", result)
        result = _substitute(self.URL_PATTERN, "URL", result)

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

# Minimum word count for a chunk to stand alone.
# Chunks below this threshold are merged with their successor.
MIN_CHUNK_WORDS = 8

# Maximum character count for merging adjacent short LIST_ITEM chunks.
MAX_MERGE_CHARS = 200
# Minimum word count below which a LIST_ITEM is considered "short" and
# eligible for grouping with its neighbours.
MIN_LIST_WORDS = 6
# Separator used to join grouped LIST_ITEM texts inside a single chunk.
LIST_GROUP_SEP = ' | '


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

    Short-chunk consolidation:
        Any chunk whose word count is < MIN_CHUNK_WORDS is merged with the
        immediately following chunk (if one exists and is the same node type).
        This prevents TOC entries, terms-and-definitions lines, and list-item
        continuations from each becoming their own microscopic chunk.

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
    # Track the node type for each chunk tag so the consolidation pass
    # can decide whether merging is appropriate.
    chunk_types: dict[str, NodeType] = {}
    tag_counter = 0

    for node in ast.nodes:
        if not node.translatable or not node.text.strip():
            continue

        tag_counter += 1
        tag = f"CHUNK_{tag_counter:03d}"

        # Store the raw original text — do NOT call _protect_inline_elements here.
        # Protecting at this layer would store __STD_0__ / __CODE_0__ etc. in the
        # database (user-visible), and discards the restore dict, making the
        # placeholders permanent. The system prompt already instructs Gemini not to
        # translate standards codes / inline code.
        chunk_dict[tag] = node.text
        chunk_types[tag] = node.node_type

        # Replace the node's text with the bracketed tag so render() produces the skeleton.
        node.text = f"[{tag}]"

    # Remember which tags existed before consolidation so we can clean up the skeleton.
    all_tags_before = set(chunk_dict.keys())

    # --- Short-chunk consolidation pass ---
    # Two sub-passes:
    #   A) PARAGRAPH chunks shorter than MIN_CHUNK_WORDS → merge into successor PARAGRAPH.
    #   B) LIST_ITEM chunks shorter than MIN_LIST_WORDS at the same indent level
    #      → group into a single combined chunk joined by LIST_GROUP_SEP.
    #
    # We deliberately SKIP HEADER, TABLE_CELL, and BLOCKQUOTE types.
    # They must always remain independent chunks.

    tags = list(chunk_dict.keys())  # insertion order preserved (Python 3.7+)

    # --- Sub-pass A: PARAGRAPH short-chunk consolidation ---
    i = 0
    while i < len(tags) - 1:
        tag = tags[i]
        text = chunk_dict.get(tag)
        if text is None:
            i += 1
            continue
        if chunk_types.get(tag) != NodeType.PARAGRAPH:
            i += 1
            continue
        word_count = len(text.split())
        next_tag = tags[i + 1]
        if word_count < MIN_CHUNK_WORDS and chunk_types.get(next_tag) == NodeType.PARAGRAPH:
            next_text = chunk_dict.get(next_tag, "")
            merged_text = text.rstrip() + " " + next_text.lstrip()
            chunk_dict[next_tag] = merged_text.strip()
            del chunk_dict[tag]
            del chunk_types[tag]
            tags.pop(i)
        else:
            i += 1

    # --- Sub-pass B: LIST_ITEM short-chunk grouping ---
    # Groups adjacent short LIST_ITEMs that share the same indent level.
    # We look up the original TextNode to read the prefix (indent + marker)
    # and use the whitespace length as the indent key.
    #
    # The grouped text is joined with LIST_GROUP_SEP so the translation
    # layer (or user in review UI) sees them as one card.  At export time
    # only the first tag of the group remains in the skeleton; orphaned tags
    # are cleaned up below.
    prefix_by_tag: dict[str, str] = {}
    for node in ast.nodes:
        # Match [CHUNK_NNN] in node.text to find the tag that this node carries
        m = re.match(r'\[CHUNK_(\d+)\]', node.text) if node.text else None
        if m:
            prefix_by_tag[f"CHUNK_{m.group(1)}"] = node.prefix

    def _indent_len(tag: str) -> int:
        """Return the leading whitespace length of the original list marker."""
        pfx = prefix_by_tag.get(tag, "")
        return len(pfx) - len(pfx.lstrip())

    tags = list(chunk_dict.keys())  # refresh after sub-pass A
    i = 0
    while i < len(tags) - 1:
        tag = tags[i]
        text = chunk_dict.get(tag)
        if text is None or chunk_types.get(tag) != NodeType.LIST_ITEM:
            i += 1
            continue
        word_count = len(text.split())
        if word_count >= MIN_LIST_WORDS:
            i += 1
            continue

        # Start building a group from this tag
        group_tags = [tag]
        group_text = text
        indent = _indent_len(tag)
        j = i + 1
        while j < len(tags):
            next_tag = tags[j]
            next_text = chunk_dict.get(next_tag, "")
            if (
                chunk_types.get(next_tag) != NodeType.LIST_ITEM
                or len(next_text.split()) >= MIN_LIST_WORDS
                or _indent_len(next_tag) != indent
            ):
                break
            # Check character budget
            candidate = group_text + LIST_GROUP_SEP + next_text
            if len(candidate) > MAX_MERGE_CHARS:
                break
            group_text = candidate
            group_tags.append(next_tag)
            j += 1

        if len(group_tags) > 1:
            # Keep the first tag, merge all others into it
            chunk_dict[tag] = group_text
            for merged_tag in group_tags[1:]:
                del chunk_dict[merged_tag]
                del chunk_types[merged_tag]
                tags.remove(merged_tag)
            # i stays put — check if the combined chunk can merge further
        else:
            i += 1

    skeleton = ast.render()

    # --- Skeleton cleanup for merged/orphaned tags ---
    # Tags deleted during consolidation are no longer in chunk_dict but their
    # [CHUNK_XXX] placeholder is still in the skeleton (because the AST was rendered
    # after the tags were placed but those nodes were not cleared).  If left as-is,
    # the exported MD would contain literal "[CHUNK_XXX]" strings.
    # Remove them so the reconstruction is clean.
    orphaned = all_tags_before - set(chunk_dict.keys())
    for orphaned_tag in orphaned:
        # Remove the tag and any immediately following newline to avoid blank lines.
        skeleton = skeleton.replace(f"[{orphaned_tag}]\n", "")
        skeleton = skeleton.replace(f"[{orphaned_tag}]", "")

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
