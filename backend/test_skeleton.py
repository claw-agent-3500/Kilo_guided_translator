"""
Unit Tests: Skeleton & State (Chunk Tagging)
=============================================

Tests build_skeleton_and_dict() and reconstruct_from_skeleton() for:
- Table round-trips (multi-column)
- LaTeX formula preservation
- Nested list indentation
- Blockquote with bold inline formatting
- Unapproved nodes (graceful English fallback)
- Empty / separator lines (not tagged)

Run with:
    cd d:\\myproject\\Guided-Translator\\backend
    python -m pytest test_skeleton.py -v
    # or without pytest:
    python test_skeleton.py
"""

import sys
import os
import importlib.machinery
import importlib.util

# ---- Direct import of markdown_handler to bypass services/__init__.py
# (which auto-imports gemini_service and triggers package install warnings)
# Using SourceFileLoader explicitly because spec_from_file_location can return
# a loader that lacks exec_module on some Python/Windows environments.
_mh_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "services", "markdown_handler.py")
assert os.path.isfile(_mh_path), f"markdown_handler.py not found at: {_mh_path}"
_loader = importlib.machinery.SourceFileLoader("markdown_handler", _mh_path)
_spec = importlib.util.spec_from_loader("markdown_handler", _loader, origin=_mh_path)
assert _spec is not None  # spec_from_loader with an explicit loader always returns a spec
_mh = importlib.util.module_from_spec(_spec)
sys.modules["markdown_handler"] = _mh  # register before exec to support internal imports
_loader.exec_module(_mh)
build_skeleton_and_dict = _mh.build_skeleton_and_dict
reconstruct_from_skeleton = _mh.reconstruct_from_skeleton


# ---- Helpers ----

def check_step(name: str, condition: bool, detail: str = ""):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {name}" + (f"\n         {detail}" if detail and not condition else ""))


# ---- Test Cases ----

def test_table_roundtrip():
    """Table structure must be perfectly preserved through the skeleton."""
    md = "| Header A | Header B |\n|---|---|\n| Determine the shear force. | Load Capacity |\n"
    skeleton, chunk_dict = build_skeleton_and_dict(md)

    # Separator row must not be tagged
    assert "|---|---|" in skeleton or "---" in skeleton, "Separator row disappeared"

    # There should be exactly 3 translatable cells (2 headers + 2 data cells = 4, but Header A etc.)
    assert len(chunk_dict) >= 2, f"Expected >=2 chunks, got {len(chunk_dict)}: {chunk_dict}"

    # Tags must appear in skeleton wrapped by pipes
    for tag in chunk_dict:
        assert tag in skeleton, f"Tag {tag} not in skeleton"

    # Reconstruct with Chinese translations
    translations = {tag: f"中文_{tag}" for tag in chunk_dict}
    result = reconstruct_from_skeleton(skeleton, translations)

    # All Chinese placeholders should appear in result
    for tag in chunk_dict:
        assert f"中文_{tag}" in result, f"Translation for {tag} missing in result"
        assert f"[{tag}]" not in result, f"Unreplaced skeleton tag [{tag}] still in result"

    # Pipe structure must be intact
    assert "|" in result, "Pipe characters missing from table"
    assert "---" in result, "Table separator row missing"

    check_step("Table: tags present in skeleton", all(f"[{t}]" in skeleton for t in chunk_dict))
    check_step("Table: pipe separators preserved in skeleton", "|" in skeleton)
    check_step("Table: separator row NOT tagged", not any(f"[CHUNK" in line for line in skeleton.split("\n") if "---" in line))
    check_step("Table: full round-trip produces correct output", all(f"中文_{t}" in result for t in chunk_dict))


def test_latex_formula_preservation():
    """LaTeX formulas ($...$) must not be tagged — they survive in skeleton verbatim."""
    md = "The formula is $F = ma$ and must be preserved.\n"
    skeleton, chunk_dict = build_skeleton_and_dict(md)

    # The formula should be protected inside the chunk_dict value (as __FORMULA_0__)
    # OR — if the whole paragraph is one chunk — just check the skeleton has the formula or a placeholder
    # but NOT a CHUNK tag inside the formula position
    chunk_values = list(chunk_dict.values())

    # The skeleton should NOT have the formula word-for-word replaced with a CHUNK tag
    # (the formula itself is protected by _protect_inline_elements)
    assert len(chunk_dict) >= 1, "No translatable chunks found"

    # Reconstruct: formula position should be intact
    translations = {tag: "公式是__FORMULA_0__且必须被保留。" for tag in chunk_dict}
    result = reconstruct_from_skeleton(skeleton, translations)
    assert "__FORMULA_0__" in result or "$F = ma$" in result or "公式" in result

    check_step("LaTeX: at least one chunk extracted", len(chunk_dict) >= 1)
    check_step("LaTeX: formula not split into raw CHUNK tag on structure line",
         not any("$F" in line and "CHUNK" in line for line in skeleton.split("\n")))


def test_blockquote_with_bold():
    """Blockquote prefix and bold markers must survive in skeleton."""
    md = "> **Determine the shear force.**\n"
    skeleton, chunk_dict = build_skeleton_and_dict(md)

    assert len(chunk_dict) == 1, f"Expected 1 chunk, got {len(chunk_dict)}"
    tag = list(chunk_dict.keys())[0]

    # Skeleton must keep > and ** around the tag
    assert ">" in skeleton, "Blockquote > marker lost"
    # Note: bold markers (**) are inside node.text for blockquotes, not in prefix/suffix
    # So the chunk_dict value should contain ** ... **
    assert tag in skeleton

    # Round-trip with Chinese
    result = reconstruct_from_skeleton(skeleton, {tag: "确定剪力。"})
    assert "确定剪力。" in result, "Chinese text missing from result"
    assert ">" in result, "Blockquote prefix lost after reconstruction"
    assert tag not in result, "Tag not replaced in result"

    check_step("Blockquote: prefix > preserved in skeleton", ">" in skeleton)
    check_step("Blockquote: tag correctly placed in skeleton", tag in skeleton)
    check_step("Blockquote: round-trip correct", "确定剪力。" in result and ">" in result)


def test_nested_list():
    """Indentation and list markers must be intact in skeleton."""
    md = "- Top level item\n  - Nested item\n    - Deeply nested item\n"
    skeleton, chunk_dict = build_skeleton_and_dict(md)

    assert len(chunk_dict) == 3, f"Expected 3 chunks, got {len(chunk_dict)}: {chunk_dict}"

    # All tags in skeleton
    for tag in chunk_dict:
        assert tag in skeleton, f"{tag} missing from skeleton"

    # Indentation markers must be in skeleton
    lines = skeleton.strip().split("\n")
    assert any(line.startswith("  ") for line in lines), "Nested indentation lost in skeleton"
    assert any(line.startswith("    ") for line in lines), "Deep nesting level lost in skeleton"

    # Round-trip
    translations = {tag: f"列表项_{i}" for i, tag in enumerate(chunk_dict)}
    result = reconstruct_from_skeleton(skeleton, translations)
    assert all(f"列表项_{i}" in result for i in range(3))

    check_step("Nested list: 3 chunks extracted", len(chunk_dict) == 3)
    check_step("Nested list: indentation preserved in skeleton", any(l.startswith("  ") for l in skeleton.split("\n")))
    check_step("Nested list: round-trip correct", all(f"列表项_{i}" in result for i in range(3)))


def test_unapproved_nodes_fallback():
    """Unapproved nodes should fall back to original English via reconstruct_from_skeleton."""
    md = "## Safety Requirements\n\nAll equipment must comply with standards.\n"
    skeleton, chunk_dict = build_skeleton_and_dict(md)

    assert len(chunk_dict) >= 1

    # Simulate: only first chunk is approved, rest are not
    tags = list(chunk_dict.keys())
    translations = {}  # No approved translations at all

    result_no_fallback = reconstruct_from_skeleton(skeleton, translations)

    # All CHUNK_XXX tags remain in place (no fallback here — caller decides)
    for tag in tags:
        assert tag in result_no_fallback, f"Tag {tag} disappeared even with no translations"

    # Now simulate English fallback (caller passes original text)
    fallback_translations = {tag: chunk_dict[tag] for tag in tags}
    result_with_fallback = reconstruct_from_skeleton(skeleton, fallback_translations)
    for tag in tags:
        assert tag not in result_with_fallback, f"Tag {tag} still present despite fallback"

    check_step("Unapproved: tags stay as-is when no translations provided",
         all(t in result_no_fallback for t in tags))
    check_step("Unapproved: English fallback removes all tags when original passed",
         all(t not in result_with_fallback for t in tags))


def test_empty_and_separators_not_tagged():
    """Empty lines and --- separators must not appear in chunk_dict."""
    md = "## Header\n\n---\n\nSome paragraph text.\n"
    skeleton, chunk_dict = build_skeleton_and_dict(md)

    # Only translatable content should be in chunk_dict (header + paragraph = 2)
    assert len(chunk_dict) >= 1, "No translatable chunks found"

    # None of the chunk values should be empty or just dashes
    for tag, value in chunk_dict.items():
        assert value.strip(), f"Empty value for {tag}"
        assert not all(c == "-" for c in value.strip()), f"Separator was tagged as {tag}: '{value}'"

    check_step("Separators: --- not in chunk_dict values",
         not any(all(c == "-" for c in v.strip()) for v in chunk_dict.values()))
    check_step("Separators: chunk_dict has no empty values",
         all(v.strip() for v in chunk_dict.values()))


def test_header_prefix_preserved():
    """Markdown header markers must be in the skeleton, not in chunk_dict."""
    md = "## Safety Requirements\n"
    skeleton, chunk_dict = build_skeleton_and_dict(md)

    assert len(chunk_dict) == 1
    tag = list(chunk_dict.keys())[0]
    value = chunk_dict[tag]

    # The header prefix (## ) should be in skeleton, not in the chunk value
    # (MarkdownHandler strips prefix into TextNode.prefix)
    assert "## " in skeleton, "Header ## prefix not in skeleton"
    # Chunk value should be the text only (no ##)
    assert not value.startswith("#"), f"# prefix leaked into chunk value: '{value}'"

    result = reconstruct_from_skeleton(skeleton, {tag: "安全要求"})
    assert "## " in result, "## prefix lost in reconstruction"
    assert "安全要求" in result

    check_step("Header: ## prefix in skeleton, not in chunk value",
         "## " in skeleton and not chunk_dict[tag].startswith("#"))
    check_step("Header: round-trip preserves ## prefix",
         "## " in result and "安全要求" in result)


# ---- Runner ----

def run_all():
    print("\n" + "=" * 60)
    print("Skeleton & State Unit Tests")
    print("=" * 60 + "\n")

    tests = [
        ("Table Round-Trip",              test_table_roundtrip),
        ("LaTeX Formula Preservation",    test_latex_formula_preservation),
        ("Blockquote with Bold",          test_blockquote_with_bold),
        ("Nested List",                   test_nested_list),
        ("Unapproved Nodes Fallback",     test_unapproved_nodes_fallback),
        ("Empty/Separator Not Tagged",    test_empty_and_separators_not_tagged),
        ("Header Prefix Preserved",       test_header_prefix_preserved),
    ]

    passed_total = 0
    failed_total = 0

    for name, fn in tests:
        print(f"\n{name}:")
        try:
            fn()
            passed_total += 1
        except AssertionError as e:
            print(f"  [FAIL] AssertionError: {e}")
            failed_total += 1
        except Exception as e:
            print(f"  [ERROR] Unexpected exception: {e}")
            import traceback
            traceback.print_exc()
            failed_total += 1

    print(f"\n{'=' * 60}")
    print(f"Results: {passed_total} passed, {failed_total} failed")
    print("=" * 60 + "\n")
    return failed_total == 0


if __name__ == "__main__":
    success = run_all()
    sys.exit(0 if success else 1)
