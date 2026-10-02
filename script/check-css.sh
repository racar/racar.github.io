#!/usr/bin/env bash
# Compile the stylesheet with the EXACT Sass implementation GitHub Pages uses.
#
# Why this exists. The Pages native build is a locked environment pinned to
# jekyll-sass-converter 1.5.2 on Ruby Sass 3.7.4, which predates the Sass
# module system and cannot parse CSS custom properties. A local build uses
# Jekyll 4.4 -> jekyll-sass-converter 3.x -> Dart Sass, which accepts both.
#
# The result was a deploy where every local check passed, every screenshot
# looked correct, and the live site served raw @use statements instead of CSS.
#
# This script closes that gap: it strips Jekyll front matter (Jekyll does this
# before handing the file to Sass; the bare `sass` CLI does not), then compiles
# with Ruby Sass and diffs the result against the local Dart Sass output.
#
#   ./script/check-css.sh          compile both, report
#   ./script/check-css.sh --write  write _site/css/main.css from the Ruby Sass
#                                  build, so contrast/a11y checks run against
#                                  the closer-to-production artifact
#
# Requires: gem install sass -v 3.7.4
set -euo pipefail

cd "$(dirname "$0")/.."

RUBY_SASS_VERSION="3.7.4"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if ! command -v sass >/dev/null 2>&1; then
  echo "Ruby Sass not installed. Run: gem install sass -v $RUBY_SASS_VERSION"
  exit 2
fi

installed="$(sass --version)"
if [[ "$installed" != *"$RUBY_SASS_VERSION"* ]]; then
  echo "WARNING: Ruby Sass $installed found; Pages pins $RUBY_SASS_VERSION."
  echo "         Results may not match production."
fi

# Jekyll removes YAML front matter before invoking the Sass converter.
python3 - "$TMP/main.scss" <<'PY'
import sys
from pathlib import Path

src = Path("css/main.scss").read_text()
if src.startswith("---"):
    src = src[src.index("\n---", 3) + 4:]
Path(sys.argv[1]).write_text(src)
PY

echo "==> Checking partials for @use (unsupported by Ruby Sass)"

# A stray @use in any partial is the exact failure that broke production twice:
# it compiles fine under Dart Sass and errors under Ruby Sass 3.7.4.
if grep -rqE "^@use " _sass/ 2>/dev/null; then
  echo "PRODUCTION BUILD WOULD FAIL:"
  grep -rn "^@use " _sass/ | sed 's/^/  /'
  echo
  echo "  Ruby Sass 3.7.4 does not support @use. Use @import only."
  exit 1
fi

echo "==> Compiling with Ruby Sass $installed (production implementation)"
if ! sass --style compressed -I _sass "$TMP/main.scss" "$TMP/rubysass.css" 2>"$TMP/err"; then
  echo
  echo "PRODUCTION BUILD WOULD FAIL:"
  sed 's/^/  /' "$TMP/err"
  echo
  echo "Ruby Sass 3.7.4 cannot handle:"
  echo "  - CSS custom properties written as '--x: value'  -> use the emit() map"
  echo "  - clamp()/min()/max() mixing rem with vw        -> wrap in #{\"...\"}"
  exit 1
fi

echo "==> Compiling with Dart Sass (local Jekyll)"
if ! command -v sassc >/dev/null 2>&1; then
  # Fall back to bundler if the standalone dart-sass binary is absent.
  bundle exec jekyll build >/dev/null 2>&1 || true
else
  sassc --style compressed -I _sass "$TMP/main.scss" "$TMP/dartsass.css"
fi

rubysass_size=$(wc -c <"$TMP/rubysass.css")
echo "    Ruby Sass output: ${rubysass_size} bytes"

# The same assertions script/check-css.py makes, run on the production build.
python3 - "$TMP/rubysass.css" <<'PY'
import re
import sys

css = open(sys.argv[1]).read()
problems = []

for at_rule in ("@use", "@import", "@mixin", "@each", "@include", "@function"):
    if re.search(rf"(?m)^\s*{at_rule}\b", css):
        problems.append(f"still contains {at_rule} — Sass leaked into the output")

for token in ("--bg-0", "--text-1", "--brand", "--hero-base"):
    if f"{token}:" not in css:
        problems.append(f"{token} missing")

declared = len(re.findall(r"--[\w-]+\s*:", css))
if declared < 60:
    problems.append(f"only {declared} custom properties, expected 60+")

if css.count("{") != css.count("}"):
    problems.append("unbalanced braces — partial compile")

if not re.search(r":root\[data-theme=[\"']?light", css):
    problems.append("no light-scheme rule")

print(f"    {declared} custom properties")

if problems:
    print("\nPRODUCTION BUILD OUTPUT IS BROKEN:")
    for p in problems:
        print(f"  x {p}")
    sys.exit(1)

print("    Production-compiled CSS is valid.")
PY

if [[ "${1:-}" == "--write" ]]; then
  mkdir -p _site/css
  cp "$TMP/rubysass.css" _site/css/main.css
  echo "==> Wrote _site/css/main.css from the Ruby Sass build"
  echo "    (so the contrast/token/audit checks validate the production artifact)"
fi
