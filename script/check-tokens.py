#!/usr/bin/env python3
"""Catch custom properties that are referenced but never defined.

A var() referencing an undefined property silently resolves to nothing —
no error, no warning, just missing spacing and colour. Sass will not catch it
because it is valid CSS. This is the cheapest high-value check in the repo.
"""
import re
import sys
from pathlib import Path

css_paths = list(Path("_site/css").glob("*.css"))
if not css_paths:
    sys.exit("No compiled CSS in _site/css — run `bundle exec jekyll build` first.")

failures = 0

for path in css_paths:
    css = path.read_text()
    defined = set(re.findall(r"(--[\w-]+)\s*:", css))
    used = set(re.findall(r"var\(\s*(--[\w-]+)", css))

    # Fallbacks are legitimate: var(--x, 10px).
    with_fallback = set(re.findall(r"var\(\s*(--[\w-]+)\s*,", css))
    missing = sorted(used - defined)

    print(f"{path}: {len(used)} referenced, {len(defined)} defined")

    if missing:
        failures += len(missing)
        print(f"  {len(missing)} UNDEFINED:")
        for m in missing:
            note = " (has fallback)" if m in with_fallback else ""
            print(f"    x {m}{note}")
    else:
        print("  all referenced custom properties are defined")

if failures:
    print(f"\n{failures} undefined custom property reference(s).")
    sys.exit(1)

print("\nClean.")
