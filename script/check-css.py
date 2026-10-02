#!/usr/bin/env python3
"""Assert the built CSS is real compiled CSS, not Sass source.

This exists because the deployed site once served `css/main.css` as literal
`@use` statements: GitHub Pages' native build is pinned to
jekyll-sass-converter 1.x (legacy Ruby Sass), which does not support the Sass
module system. Every local check passed, every screenshot looked correct, and
the live site was completely unstyled.

Nothing in the audit or contrast scripts catches that — they either parse the
file happily or find nothing to parse. This checks the shape of the output
directly, and it is the check that would have caught it.

Exits non-zero on failure.
"""
import re
import sys
from pathlib import Path

css_path = Path("_site/css/main.css")
if not css_path.exists():
    sys.exit("No _site/css/main.css — run `bundle exec jekyll build` first.")

raw = css_path.read_bytes()
css = raw.decode("utf-8", errors="replace")
problems = []

# 1. Sass source must never reach the browser. @use/@import/@mixin/@each are
#    all at-rule syntax that cannot appear in valid CSS output.
for at_rule in ("@use", "@import", "@mixin", "@each", "@include", "@function"):
    hits = re.findall(rf"(?m)^\s*{re.escape(at_rule)}\b", css)
    if hits:
        problems.append(
            f"served CSS still contains {at_rule} ({len(hits)}x) — the Sass "
            "compiler did not run"
        )

# 2. The stylesheet must actually contain our tokens.
for token in ("--bg-0", "--text-1", "--brand", "--hero-base"):
    if f"{token}:" not in css:
        problems.append(f"{token} missing from compiled CSS")

# 3. Custom-property declarations must survive. Sass drops declarations it
#    cannot parse, so a missing one is the earliest signal that something went
#    wrong upstream.
declared = len(re.findall(r"--[\w-]+\s*:", css))
if declared < 60:
    problems.append(f"only {declared} custom properties declared, expected 60+")

# 4. Sanity: a real stylesheet is far larger than Sass source would suggest.
if len(raw) < 8000:
    problems.append(f"stylesheet is only {len(raw)} bytes — suspiciously small")

# 5. The light and dark schemes must both be present as separate rules. The
#    attribute selector may or may not be quoted depending on the Sass
#    implementation, so match either.
if not re.search(r":root\[data-theme=[\"']?light", css):
    problems.append("no light-scheme rule in the compiled CSS")
if not re.search(r":root\[data-theme=[\"']?dark", css):
    problems.append("no dark-scheme rule in the compiled CSS")

# 6. Curly braces must balance. Unbalanced output means a partial compile.
if css.count("{") != css.count("}"):
    problems.append(
        f"unbalanced braces: {css.count('{')} open vs {css.count('}')} close"
    )

print(f"_site/css/main.css: {len(raw):,} bytes, {declared} custom properties")
if problems:
    print(f"\n{len(problems)} PROBLEM(S):\n")
    for p in problems:
        print(f"  x {p}")
    print(
        "\nIf the Sass compiler did not run, the cause is almost always the\n"
        "jekyll-sass-converter version: GitHub Pages' native build is pinned to\n"
        "1.x (legacy Ruby Sass), which does NOT support the @use module system."
    )
    sys.exit(1)

print("Compiled CSS verified: no Sass at-rules, both schemes present, balanced.")
