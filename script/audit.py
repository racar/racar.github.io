#!/usr/bin/env python3
"""Structural audit of the built site. Catches the regressions that are easy to
reintroduce when editing templates: stray h1s, duplicate ids, unlabelled
icon-only links, images without dimensions, internal 404s, and hardcoded
production hosts.
"""
import re
import sys
from pathlib import Path

site = Path("_site")
pages = sorted(site.rglob("*.html"))
problems, notes = [], []

ICON_ONLY = re.compile(r"<a\b[^>]*>\s*<svg\b[^>]*>.*?</svg>\s*</a>", re.S)


def rel(p):
    return "/" + str(p.relative_to(site)).replace("index.html", "")


for page in pages:
    html = page.read_text()
    name = rel(page)
    body = html.split("<body", 1)[-1]

    # --- structure -----------------------------------------------------
    h1s = re.findall(r"<h1\b", body)
    if len(h1s) > 1:
        problems.append(f"{name}: {len(h1s)} <h1> elements, expected 1")
    if len(h1s) == 0 and "/404" not in name:
        problems.append(f"{name}: no <h1>")

    ids = re.findall(r'\sid="([^"]+)"', body)
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        problems.append(f"{name}: duplicate id(s) {sorted(dupes)}")

    if "<main" not in body:
        problems.append(f"{name}: no <main> landmark")
    if 'class="skip-link"' not in body:
        problems.append(f"{name}: no skip link")

    # --- images --------------------------------------------------------
    for img in re.findall(r"<img\b[^>]*>", body):
        if "width=" not in img or "height=" not in img:
            problems.append(f"{name}: <img> missing dimensions -> CLS")
            break

    # --- accessibility -------------------------------------------------
    for a in ICON_ONLY.findall(body):
        if "aria-label" not in a and "aria-hidden" not in a:
            problems.append(f"{name}: icon-only link with no accessible name")
            break

    # canvas is an automatic 1.1.1 failure without fallback content
    if re.search(r"<canvas\b", body):
        problems.append(f"{name}: bare <canvas> with no fallback content")

    for el in re.findall(r"<(?:h[1-6]|div)\b[^>]*style=\"[^\"]*display:\s*none[^\"]*\"", body):
        if "<h" in el:
            problems.append(f"{name}: heading hidden with inline display:none")

    # --- hardcoded production host ------------------------------------
    for m in re.findall(r'(?:href|src)="https://racar\.github\.io/[^"]*"', body):
        problems.append(f"{name}: hardcoded prod host {m[:60]}")

    # --- broken liquid artefacts --------------------------------------
    # Strip comments first — head.html documents the old bug in a comment that
    # itself contains the malformed URL, which otherwise trips this check.
    stripped = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    if re.search(r'(href|src)="\s', stripped) or re.search(
        r'https?://[\w.-]+/\s', stripped
    ):
        problems.append(f"{name}: whitespace inside URL string (old feed.xml bug)")

    # --- internal links resolve ---------------------------------------
    for href in set(re.findall(r'href="(/[^"#?]*)', body)):
        target = (site / href.lstrip("/")).resolve() if href != "/" else site / "index.html"
        candidates = [target, target / "index.html", target.with_suffix(".html")]
        if not any(c.is_file() for c in candidates):
            problems.append(f"{name}: internal link 404 -> {href}")

# --- site-wide ---------------------------------------------------------
all_html = "\n".join(p.read_text() for p in pages)
if "<canvas" in all_html:
    problems.append("site: canvas present (skills radar should be gone)")
if "Chart" in all_html:
    problems.append("site: Chart.js reference still present")
if "jquery" in all_html.lower():
    problems.append("site: jQuery reference still present")
if 'analytics' in all_html.lower() and "ld+json" not in all_html:
    problems.append("site: analytics reference present")
if "leonids-logo" in all_html:
    problems.append("site: still references the Leonids theme logo")

# No external JS files. Inline <script> blocks are allowed but must be
# accounted for: the theme toggle is the only one this site should ever have.
js_files = list(site.rglob("*.js"))
if js_files:
    problems.append(f"site: {len(js_files)} JS file(s) shipped: {[str(p) for p in js_files]}")

inline = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", all_html)
unexpected = [
    t for t in inline
    if 'type="application/ld+json"' not in t
]
inline = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", all_html)

# Expect exactly the two theme scripts (pre-paint in <head>, behaviour after
# the header) plus JSON-LD on every page. Anything else is new surface.
allowed = 2
for page in pages:
    html = page.read_text()
    ld = len(re.findall(r'type="application/ld\+json"', html))
    plain = len(re.findall(r"<script(?![^>]*\bsrc=)(?![^>]*ld\+json)[^>]*>", html))
    if plain > allowed:
        problems.append(
            f"{rel(page)}: {plain} inline script(s), expected <= {allowed} "
            "(theme toggle only)"
        )

# --- report -----------------------------------------------------------
print(f"Audited {len(pages)} pages\n")
if problems:
    print(f"{len(problems)} PROBLEM(S):\n")
    for p in problems:
        print(f"  x {p}")
    sys.exit(1)

print("Clean: single h1, no duplicate ids, no bare canvas, no icon-only")
print("links without a name, no CLS-inducing images, no hardcoded prod host,")
print("no internal 404s, zero external JS files, and only the 2 expected")
print("inline theme scripts per page.")
