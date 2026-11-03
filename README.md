# Root Cause — DFIR blog template

A static DFIR/incident-response blog: plain HTML/CSS/JS, dark terminal-style theme with a
light toggle, no external CDNs at runtime, and a small dependency-free Python script that
converts Markdown investigation write-ups into the post template at build time.

## Folder layout

```
dfir-blog/
├── index.html                  # homepage (intro, latest posts, CTA)
├── about.html
├── contact.html
├── posts/
│   ├── index.html              # posts index, filterable by topic
│   └── *.html                  # generated post pages (build.py output — do not hand-edit)
├── content/
│   └── posts/
│       └── *.md                # write your posts here (frontmatter + Markdown)
├── templates/
│   └── post-template.html      # the HTML shell build.py fills in per post
├── css/
│   ├── style.css                # layout, theme variables, components
│   └── syntax-highlight.css     # token colors + mobile nav drawer
├── js/
│   ├── main.js                  # theme toggle, mobile nav, scroll-reveal
│   ├── filter.js                 # loads posts.json, renders cards, topic filter
│   ├── toc.js                    # per-post table of contents + active-section highlight
│   ├── highlight.js               # tiny self-hosted syntax highlighter (no CDN)
│   └── evidence.js                # search + confidence-filter for the artifact correlation table
├── assets/images/                # screenshots, diagrams
├── build.py                       # Markdown -> HTML build script (stdlib only)
├── posts.json                     # generated post index (don't hand-edit — build.py writes it)
└── .github/workflows/deploy.yml   # builds + deploys to GitHub Pages on push to main
```

## How a post gets built

1. Write `content/posts/YYYY-MM-DD-slug.md` with frontmatter:

   ```
   ---
   title: Your Investigation Title
   date: 2026-01-15
   difficulty: Beginner | Intermediate | Advanced
   tools: Tool One, Tool Two, Tool Three
   tags: Windows, Lateral Movement, Memory Forensics
   killchain: One or two sentence kill-chain summary.
   summary: One sentence used as the card blurb and meta description.
   ---

   ## Section heading
   Narrative prose...
   ```

2. Write the body as plain Markdown: `##`/`###` headings, `**bold**`, `*italic*`,
   `` `code` ``, `[links](url)`, `![alt](src)`, fenced code blocks with a language
   (```` ```powershell ````) for syntax highlighting, `-`/`1.` lists, `>` blockquotes.

3. For diagrams, screenshots, the timeline, and the interactive correlation table, drop raw
   HTML directly into the Markdown (see `content/posts/2026-01-15-pass-the-hash-lateral-movement.md`
   for a full worked example of all of these) — the converter passes any block starting
   with `<` straight through untouched:
   - **Screenshots**: `<figure><img src="../assets/images/x.png" alt="..."><figcaption>...</figcaption></figure>`
   - **Diagrams**: inline `<svg>...</svg>` wrapped in `<div class="diagram-wrap">`
     (or swap in the Mermaid CDN script + `<pre class="mermaid">` if you'd rather author
     diagrams as text — inline SVG is used here to keep the site CDN-free)
   - **Reconstructed timeline**: an `<ol>` inside `<div class="timeline-section">`, one `<li>`
     per event with `<span class="tl-time">`, `<span class="tl-event">`, and
     `<span class="tl-source">` — always name the artifact an event rests on; if there's no
     source, it's a guess and doesn't belong in the timeline
   - **Artifact correlation table**: copy the `.ev-controls` + `.ev-table-wrap` block from
     the sample post — columns are Artifact / Source / Establishes / Does not establish /
     Confidence, each row tagged `data-conf="high|medium|low"`. `js/evidence.js` auto-wires
     the search box (`#ev-q`) and the confidence chips (`.filter-chip[data-conf]`) for any
     table with class `ev-table`; keep the "Does not establish" column honest — it's the
     point of the table

4. Run the build:

   ```bash
   python build.py
   ```

   This regenerates `posts/<slug>.html` from `templates/post-template.html` and rewrites
   `posts.json` (which `js/filter.js` fetches to populate the homepage and posts index).
   `python build.py --watch` rebuilds automatically while you write.

## Local preview

`js/filter.js` fetches `posts.json` — that requires an actual HTTP server, not a
double-clicked `file://` page (fetch of local files is blocked under `file://`). From the
`dfir-blog/` folder:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploying to GitHub Pages

**Option A — GitHub Actions (recommended, matches the included workflow):**

1. Create a new GitHub repo and push this folder's contents to `main`:

   ```bash
   git init
   git add .
   git commit -m "Initial DFIR blog"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```

2. In the repo: **Settings → Pages → Build and deployment → Source → GitHub Actions.**
3. Push to `main` (or re-run the workflow from the Actions tab). `.github/workflows/deploy.yml`
   runs `python build.py` and deploys the result — so you never need to commit generated
   `posts/*.html` or `posts.json`, just the Markdown source.
4. Your site is live at `https://<you>.github.io/<repo>/`.

**Option B — no Actions, commit the build output:**

Run `python build.py` locally before every push, commit the generated `posts/*.html` and
`posts.json` along with your source, then set **Settings → Pages → Source → Deploy from a
branch → main / (root)**.

## Customizing

- **Colors/theme**: CSS variables at the top of `css/style.css` (`:root` = dark/default,
  `[data-theme="light"]` = light).
- **Nav/branding**: edit the `<header class="site-header">` block — it's duplicated across
  `index.html`, `about.html`, `contact.html`, `posts/index.html`, and
  `templates/post-template.html` (kept as plain HTML rather than templated, on purpose, to
  keep the site dependency-free at runtime).
- **Topic filter chips**: edit the `data-tag` buttons in `posts/index.html`'s `.filter-bar`
  to match whatever tags you actually use in your posts' frontmatter.
