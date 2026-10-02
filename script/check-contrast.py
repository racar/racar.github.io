#!/usr/bin/env python3
"""Verify every foreground/background token pair in the compiled CSS against
WCAG 2.1 thresholds. Exits non-zero on any failure.

4.5:1 body text (AA) | 3:1 large text >=24px or >=19px bold (AA) | 3:1 UI
components and focus indicators (1.4.11)

PARSING IS THE WHOLE PROBLEM here. The compiled CSS contains the dark tokens
twice — once for an explicit choice and once inside a media query:

    :root { ...light... }
    :root[data-theme='dark'] { ...dark... }
    @media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { ...dark... } }

Splitting on the media query boundary and calling everything before it "light"
silently reads the dark block instead. That happened once already and reported
44 passes for a scheme it never looked at. So each scheme is extracted from its
OWN rule block, by brace-matching, and asserted against the expected values.
"""
import re
import sys
from pathlib import Path

css_path = Path("_site/css/main.css")
if not css_path.exists():
    sys.exit("No compiled CSS — run `bundle exec jekyll build` first.")
css = css_path.read_text()


def block_after(selector_pattern, start=0):
    """Return the declarations inside the rule whose selector matches, and the
    index just past it. Brace-matched, so nested at-rules do not confuse it.
    No `^` anchor: minified CSS is one long line, so `^` only ever matches at
    offset 0. The patterns are instead written so the selector is followed
    immediately by optional whitespace and a brace, which distinguishes
    ":root[data-theme=dark]{...}" from the later
    ":root[data-theme=dark] .theme-toggle__sun{...}" icon rules."""
    m = re.compile(selector_pattern).search(css, start)
    if not m:
        return None, start
    # Search from m.start(), not m.end(): the pattern may already have consumed
    # the opening brace (":root\{" matches through the brace), and searching
    # from m.end() would then land on the NEXT rule's brace.
    i = css.index("{", m.start())
    depth, j = 1, i + 1
    while depth:
        if css[j] == "{":
            depth += 1
        elif css[j] == "}":
            depth -= 1
        j += 1
    return css[i + 1 : j - 1], j


def declarations(block):
    return {k: v.strip() for k, v in re.findall(r"(--[\w-]+)\s*:\s*([^;}]+)", block)}


def to_rgb(c):
    c = c.strip()
    if c.startswith("#"):
        h = c[1:]
        if len(h) == 3:
            h = "".join(x * 2 for x in h)
        return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))
    m = re.match(r"rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)", c)
    return tuple(int(float(m.group(i))) for i in (1, 2, 3)) if m else None


def lum(rgb):
    def ch(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(x) for x in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(fg, bg):
    a, b = to_rgb(fg), to_rgb(bg)
    if a is None or b is None:
        return None
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


# --- extract each scheme from its own rule ------------------------------
# Sass strips the quotes, so the attribute selectors arrive as
# :root[data-theme=light] / :root[data-theme=dark] with no quotes.
#
# DARK IS THE DEFAULT here: the bare :root rule carries the dark tokens, and
# light is the :root[data-theme='light'] opt-in. So the labels are chosen from
# which selector produced the block, not from source order — and the assertion
# below catches it if that assumption ever stops holding.
default_block, _ = block_after(r"(?:^|\})[^{};]*?:root\s*\{", 0)
light_block, _ = block_after(r":root\[data-theme=[^\]]*light[^\]]*\]\s*\{", 0)
dark_block, _ = block_after(r":root\[data-theme=[^\]]*dark[^\]]*\]\s*\{", 0)

if not light_block or not dark_block or not default_block:
    sys.exit(
        "Could not isolate both scheme blocks. Expected a bare :root rule plus "
        ":root[data-theme='light'] and :root[data-theme='dark']."
    )

dark = declarations(dark_block)
light = declarations(light_block)

# The :root default must equal the dark scheme. If it ever does not, the
# "default" claim in the docs is wrong and every default-visitor check below
# would be testing the wrong values.
root_tokens = declarations(default_block)
for key, val in dark.items():
    if root_tokens.get(key) != val:
        sys.exit(
            f"REFUSING TO REPORT: :root (the default) disagrees with "
            f":root[data-theme='dark'] at {key}: "
            f"{root_tokens.get(key)} vs {val}."
        )

# Neither scheme redeclares --hero-text*, because the hero sits on a dark
# surface in both and white text is correct on it either way. Inherit so the
# hero checks run against real values instead of reporting an unresolved
# colour.
for inherited in ("--hero-text", "--hero-text-2", "--hero-text-3"):
    fallback = default_block
    dark.setdefault(inherited, declarations(fallback).get(inherited, ""))

# --- assert we parsed the right blocks, before trusting any result -------
# Cheap, and it is the exact failure that already happened once.
if light.get("--bg-0") == dark.get("--bg-0"):
    sys.exit(
        "REFUSING TO REPORT: light and dark parsed to the same --bg-0 "
        f"({light.get('--bg-0')}). The parser is broken, not the palette."
    )


def lum01(hexc):
    return lum(to_rgb(hexc))


if lum01(light["--bg-0"]) < lum01(dark["--bg-0"]):
    sys.exit(
        "REFUSING TO REPORT: the 'light' block is darker than the 'dark' block. "
        "The selector pattern is matching the wrong rules."
    )

BODY, LARGE, UI = 4.5, 3.0, 3.0

CHECKS = [
    ("--text-1", "--bg-0", BODY, "body text on page"),
    ("--text-1", "--bg-1", BODY, "body text on alt surface"),
    ("--text-1", "--bg-2", BODY, "body text on sunken surface"),
    ("--text-2", "--bg-0", BODY, "secondary text"),
    ("--text-2", "--bg-1", BODY, "secondary text on alt surface"),
    ("--text-3", "--bg-0", BODY, "muted text"),
    ("--text-3", "--bg-1", BODY, "muted text on alt surface"),
    ("--text-3", "--surface-sunken", BODY, "muted text in code/comments"),
    ("--text-brand", "--bg-0", BODY, "brand link on page"),
    ("--text-brand", "--bg-1", BODY, "brand link on alt surface"),
    ("--text-brand", "--surface-brand", BODY, "tier chip text on tint"),
    ("--text-inverse", "--brand", BODY, "primary button label"),
    ("--text-1", "--surface-card", BODY, "card heading"),
    ("--brand", "--bg-0", UI, "accent underline"),
    ("--line-strong", "--bg-0", UI, "input + control border"),
    ("--line-strong", "--bg-1", UI, "control border on alt surface"),
    ("--brand-decorative", "--bg-0", None, "DECORATION ONLY"),
    ("--line-hairline", "--bg-0", None, "DECORATION ONLY"),
    ("--brand-large-text", "--bg-0", LARGE, "large accent text only"),
    ("--hero-text", "--hero-base", BODY, "hero heading"),
    ("--hero-text-2", "--hero-base", BODY, "hero kicker + sub"),
    ("--hero-text-3", "--hero-base", BODY, "hero meta"),
    ("--focus-ring", "--bg-0", UI, "focus ring on page"),
    ("--focus-ring", "--bg-1", UI, "focus ring on alt surface"),
]

failures, checked = [], 0

for scheme, tokens in (("light", light), ("dark", dark)):
    bg0 = tokens.get("--bg-0")
    print(f"\n{'=' * 64}\n{scheme.upper()}  (--bg-0 = {bg0})\n{'=' * 64}")
    for fg, bg, thresh, label in CHECKS:
        r = ratio(tokens.get(fg, ""), tokens.get(bg, ""))
        if thresh is None:
            print(f"  n/a  {label:38s} {r:5.2f}:1  (decoration)")
            continue
        if r is None:
            failures.append(f"{scheme}: {label} -- could not resolve colours")
            continue
        checked += 1
        ok = r >= thresh
        print(f"  {'PASS' if ok else 'FAIL'}  {label:38s} {r:5.2f}:1  (needs {thresh})")
        if not ok:
            failures.append(f"{scheme}: {label} = {r:.2f}:1, needs {thresh}  ({fg} on {bg})")

print(f"\n{'=' * 64}")
print(f"parsed {len(light)} light tokens, {len(dark)} dark tokens")
if failures:
    print(f"\n{len(failures)} FAILURE(S) across {checked} checks:\n")
    for f in failures:
        print(f"  x {f}")
    sys.exit(1)

print(f"\nAll {checked} contrast checks pass WCAG AA — in BOTH schemes, verified separately.")