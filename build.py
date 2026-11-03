#!/usr/bin/env python3
"""
build.py — converts content/posts/*.md into static HTML pages under posts/,
and regenerates posts.json (consumed client-side by js/filter.js for the
homepage "latest posts" and the filterable posts index).

No third-party dependencies — pure standard library, so `python build.py`
works out of the box. The markdown support is a deliberately small subset
(headers, bold/italic/code, links/images, lists, blockquotes, fenced code
blocks, hr) plus HTML block passthrough, which is enough for investigation
write-ups that embed raw SVG diagrams and HTML correlation tables directly.

Usage:
    python build.py            # build everything
    python build.py --watch    # rebuild on file change (polling, no deps)
"""

import html
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONTENT_DIR = ROOT / "content" / "posts"
OUTPUT_DIR = ROOT / "posts"
TEMPLATE_PATH = ROOT / "templates" / "post-template.html"
POSTS_JSON_PATH = ROOT / "posts.json"


# ---------------------------------------------------------------------------
# Frontmatter parsing
# ---------------------------------------------------------------------------

def parse_frontmatter(text):
    """Splits a leading `---\n...\n---` block from the markdown body.
    Frontmatter is simple `key: value` lines (no nested YAML structures)."""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.DOTALL)
    if not match:
        raise ValueError("Missing frontmatter block (--- ... ---) at top of file")

    fm_block, body = match.groups()
    meta = {}
    for line in fm_block.splitlines():
        if not line.strip() or ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip().lower()] = value.strip()

    meta["tags"] = [t.strip() for t in meta.get("tags", "").split(",") if t.strip()]
    meta["tools_list"] = [t.strip() for t in meta.get("tools", "").split(",") if t.strip()]
    return meta, body


# ---------------------------------------------------------------------------
# Minimal markdown -> HTML converter
# ---------------------------------------------------------------------------

INLINE_CODE_RE = re.compile(r"`([^`]+)`")
BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
ITALIC_RE = re.compile(r"(?<!\*)\*([^*]+)\*(?!\*)")
IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")

used_ids = {}


def slugify(text):
    slug = re.sub(r"[^a-z0-9\s-]", "", text.lower()).strip()
    slug = re.sub(r"\s+", "-", slug)
    return slug or "section"


def unique_id(text):
    base = slugify(text)
    if base not in used_ids:
        used_ids[base] = 0
        return base
    used_ids[base] += 1
    return f"{base}-{used_ids[base]}"


def render_inline(text):
    text = IMAGE_RE.sub(lambda m: f'<img src="{m.group(2)}" alt="{html.escape(m.group(1))}">', text)
    text = LINK_RE.sub(lambda m: f'<a href="{m.group(2)}">{m.group(1)}</a>', text)
    text = BOLD_RE.sub(r"<strong>\1</strong>", text)
    text = ITALIC_RE.sub(r"<em>\1</em>", text)
    text = INLINE_CODE_RE.sub(lambda m: f"<code>{html.escape(m.group(1))}</code>", text)
    return text


def markdown_to_html(md_text):
    used_ids.clear()
    lines = md_text.split("\n")
    out = []
    i = 0
    n = len(lines)

    def flush_paragraph(buf):
        if buf:
            out.append("<p>" + render_inline(" ".join(buf).strip()) + "</p>")
            buf.clear()

    paragraph_buf = []

    while i < n:
        line = lines[i]
        stripped = line.strip()

        # Blank line
        if not stripped:
            flush_paragraph(paragraph_buf)
            i += 1
            continue

        # Raw HTML block: a line starting with '<' passes through untouched
        # until a blank line. Lets posts embed SVG diagrams / correlation
        # tables / figures directly.
        if stripped.startswith("<"):
            flush_paragraph(paragraph_buf)
            html_lines = []
            depth_done = False
            while i < n and lines[i].strip() != "":
                html_lines.append(lines[i])
                i += 1
            out.append("\n".join(html_lines))
            continue

        # Fenced code block
        fence_match = re.match(r"^```(\w*)\s*$", stripped)
        if fence_match:
            flush_paragraph(paragraph_buf)
            lang = fence_match.group(1)
            i += 1
            code_lines = []
            while i < n and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1  # skip closing fence
            code_html = html.escape("\n".join(code_lines))
            cls = f' class="language-{lang}"' if lang else ""
            out.append(f"<pre><code{cls}>{code_html}</code></pre>")
            continue

        # Horizontal rule
        if re.match(r"^-{3,}$", stripped) or re.match(r"^\*{3,}$", stripped):
            flush_paragraph(paragraph_buf)
            out.append("<hr>")
            i += 1
            continue

        # Headers
        header_match = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if header_match:
            flush_paragraph(paragraph_buf)
            level = len(header_match.group(1))
            text = header_match.group(2).strip()
            heading_id = unique_id(text)
            out.append(f'<h{level} id="{heading_id}">{render_inline(text)}</h{level}>')
            i += 1
            continue

        # Blockquote
        if stripped.startswith(">"):
            flush_paragraph(paragraph_buf)
            quote_lines = []
            while i < n and lines[i].strip().startswith(">"):
                quote_lines.append(lines[i].strip().lstrip(">").strip())
                i += 1
            out.append("<blockquote><p>" + render_inline(" ".join(quote_lines)) + "</p></blockquote>")
            continue

        # Unordered list (continuation lines, indented or not, fold into
        # the current <li> until a blank line or the next bullet/number)
        if re.match(r"^[-*]\s+", stripped) and not re.match(r"^-{3,}$", stripped):
            flush_paragraph(paragraph_buf)
            items = []
            current = None
            while i < n and lines[i].strip() != "":
                item_line = lines[i].strip()
                if re.match(r"^[-*]\s+", item_line):
                    if current is not None:
                        items.append(current)
                    current = re.sub(r"^[-*]\s+", "", item_line)
                elif re.match(r"^\d+\.\s+", item_line):
                    break  # start of an ordered list
                else:
                    current += " " + item_line
                i += 1
            if current is not None:
                items.append(current)
            out.append("<ul>" + "".join(f"<li>{render_inline(t)}</li>" for t in items) + "</ul>")
            continue

        # Ordered list (same continuation-folding behavior)
        if re.match(r"^\d+\.\s+", stripped):
            flush_paragraph(paragraph_buf)
            items = []
            current = None
            while i < n and lines[i].strip() != "":
                item_line = lines[i].strip()
                if re.match(r"^\d+\.\s+", item_line):
                    if current is not None:
                        items.append(current)
                    current = re.sub(r"^\d+\.\s+", "", item_line)
                elif re.match(r"^[-*]\s+", item_line):
                    break  # start of an unordered list
                else:
                    current += " " + item_line
                i += 1
            if current is not None:
                items.append(current)
            out.append("<ol>" + "".join(f"<li>{render_inline(t)}</li>" for t in items) + "</ol>")
            continue

        # Regular paragraph text — accumulate until blank/structural line
        paragraph_buf.append(stripped)
        i += 1

    flush_paragraph(paragraph_buf)
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Build pipeline
# ---------------------------------------------------------------------------

def reading_time(text):
    words = len(re.findall(r"\w+", text))
    return max(1, round(words / 200))


def difficulty_class(difficulty):
    d = difficulty.lower()
    if d == "beginner":
        return "badge-beginner"
    if d == "advanced":
        return "badge-advanced"
    return "badge-intermediate"


def format_date_display(iso_date):
    try:
        from datetime import datetime
        dt = datetime.strptime(iso_date, "%Y-%m-%d")
        return dt.strftime("%B %-d, %Y") if sys.platform != "win32" else dt.strftime("%B %d, %Y").replace(" 0", " ")
    except Exception:
        return iso_date


def build_post(md_path, template):
    text = md_path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(text)
    content_html = markdown_to_html(body)

    tags_html = "".join(f'<span class="tag">{html.escape(t)}</span>' for t in meta["tags"])

    rendered = template
    replacements = {
        "{{TITLE}}": html.escape(meta.get("title", "Untitled")),
        "{{SUMMARY}}": html.escape(meta.get("summary", "")),
        "{{DATE_DISPLAY}}": format_date_display(meta.get("date", "")),
        "{{READING_TIME}}": str(reading_time(body)),
        "{{DIFFICULTY}}": html.escape(meta.get("difficulty", "Intermediate")),
        "{{DIFFICULTY_CLASS}}": difficulty_class(meta.get("difficulty", "Intermediate")),
        "{{TOOLS}}": html.escape(meta.get("tools", "")),
        "{{TAGS_HTML}}": tags_html,
        "{{KILLCHAIN}}": render_inline(meta.get("killchain", "")),
        "{{CONTENT}}": content_html,
    }
    for placeholder, value in replacements.items():
        rendered = rendered.replace(placeholder, value)

    slug = md_path.stem
    out_path = OUTPUT_DIR / f"{slug}.html"
    out_path.write_text(rendered, encoding="utf-8")

    return {
        "title": meta.get("title", "Untitled"),
        "date": meta.get("date", ""),
        "difficulty": meta.get("difficulty", "Intermediate"),
        "tools": meta["tools_list"],
        "tags": meta["tags"],
        "summary": meta.get("summary", ""),
        "file": f"{slug}.html",
    }


def build_all():
    if not TEMPLATE_PATH.exists():
        print(f"ERROR: template not found at {TEMPLATE_PATH}", file=sys.stderr)
        sys.exit(1)

    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    OUTPUT_DIR.mkdir(exist_ok=True)

    md_files = sorted(CONTENT_DIR.glob("*.md"))
    if not md_files:
        print(f"No markdown posts found in {CONTENT_DIR}")

    posts_meta = []
    for md_path in md_files:
        try:
            meta = build_post(md_path, template)
            posts_meta.append(meta)
            print(f"built  {md_path.name} -> posts/{meta['file']}")
        except Exception as exc:
            print(f"ERROR building {md_path.name}: {exc}", file=sys.stderr)

    posts_meta.sort(key=lambda p: p["date"], reverse=True)
    POSTS_JSON_PATH.write_text(json.dumps(posts_meta, indent=2), encoding="utf-8")
    print(f"wrote  posts.json ({len(posts_meta)} posts)")


def watch():
    print("Watching content/posts/*.md and templates/post-template.html for changes (Ctrl+C to stop)...")
    mtimes = {}

    def snapshot():
        files = list(CONTENT_DIR.glob("*.md")) + [TEMPLATE_PATH]
        return {str(f): f.stat().st_mtime for f in files if f.exists()}

    build_all()
    mtimes = snapshot()
    try:
        while True:
            time.sleep(1)
            current = snapshot()
            if current != mtimes:
                print("\nchange detected, rebuilding...")
                build_all()
                mtimes = current
    except KeyboardInterrupt:
        print("\nstopped.")


if __name__ == "__main__":
    if "--watch" in sys.argv:
        watch()
    else:
        build_all()
