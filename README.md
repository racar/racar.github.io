# racar.github.io

Personal site for **Rafael A. Carrascal Reyes** — backend engineer, Colombia.
Ruby on Rails and Python, fintech and insurtech.

Jekyll, deployed by GitHub Pages' native build. No npm, no bundler, no
build tooling beyond Jekyll's own Sass converter, and **zero JavaScript files**
— the only script is a small inline block for the light/dark theme toggle.

---

## Local development

```bash
bundle install
bundle exec jekyll serve      # http://localhost:4000
```

`Gemfile` pins Jekyll so the local build is reproducible. **It does not, and
cannot, make the local build identical to production** — GitHub Pages' native
build is a locked environment with its own pinned gem set. That gap is why
`script/check-css.py` exists; see the Sass note below.

Build output lands in `_site/` (gitignored). Deploys happen on push to the
default branch — no CI configuration, no workflow, nothing to maintain.

---

## Verification

Three checks run against `_site/`. Build first, then:

```bash
bundle install
bundle exec jekyll build

python3 script/check-css.py       # is the served CSS actually compiled CSS?
python3 script/audit.py           # structure, a11y, links, zero-JS assertion
python3 script/check-contrast.py  # every token pair vs WCAG AA thresholds
python3 script/check-tokens.py    # var() references that were never defined
node    script/check-theme.mjs    # dark default, light opt-in, persistence, no-flash
node    script/shoot.mjs out/     # screenshots at real viewports, both schemes
```

Each exits non-zero on failure, so they work as a pre-commit gate.

### The Sass dialect is a deployment constraint, not a preference

GitHub Pages' native build is a **locked** environment pinned to
`jekyll-sass-converter 1.x`, which uses legacy Ruby Sass. That implementation
does **not** support the Sass module system. This site therefore uses
`@import`, not `@use`.

This is not a hypothetical. A deploy with `@use` shipped **live with an
unstyled site**: `https://racar.github.io/css/main.css` returned literal
`@use 'abstracts/semantic';@use 'base/reset';...`. Every local check passed
and every screenshot looked correct, because the local `Gemfile` resolves
Jekyll 4.4 → `jekyll-sass-converter` 3.x → Dart Sass. Only Pages was broken.

`@import` is deprecated in Dart Sass and removed in Dart Sass 3.0, so this is a
deliberate trade: it works on the platform we deploy to, and local and
production output stay byte-identical. Revisit only if this site moves off the
native build to a GitHub Actions workflow — then use `@use` and pin the
converter.

The consequence for the partials: under `@import` everything shares one global
scope, so `main.scss` import order is load-bearing. `abstracts/primitives`
must precede any file referencing `$space-*`, `$blue-*`, etc., and
`abstracts/mixins` must precede the first `@include`.

**`audit.py`** catches the regressions that are easy to reintroduce while
editing templates: more than one `<h1>`, duplicate `id`s, a bare `<canvas>`,
icon-only links with no accessible name, images without `width`/`height`
(layout shift), the production host hardcoded into `href`s, whitespace inside
URL strings (the bug that made `/feed.xml` a dead link sitewide), internal
404s, and any `.js` file appearing in the output.

**`check-css.py`** asserts the built stylesheet is real compiled CSS rather
than Sass source: no `@use`/`@import`/`@mixin` at-rules, tokens present, both
schemes present, braces balanced. This is the check that would have caught the
unstyled deploy — every other script parsed the broken file without complaint,
because `@use 'abstracts/semantic';...` is still valid text to read. It has been
verified by feeding it the exact 45-byte broken file the production server
returned, and confirming it fails.

**`check-contrast.py`** reads the compiled CSS and computes real contrast
ratios for each token pair in **both** colour schemes, at the threshold that
actually applies to that pair.

The parsing is the subtle part. Each scheme has to be pulled from its own
brace-matched rule, and the label comes from *which selector* produced the
block rather than from source order. Getting that wrong happened once: the
checker split the file on a media-query boundary, read the dark block, and
reported 44 passes for a scheme it had never examined.

Three assertions now guard it, and the script exits rather than reporting:

1. the two blocks must not parse to the same `--bg-0`
2. the "light" block must actually be lighter than the "dark" block
3. the bare `:root` default must equal `:root[data-theme='dark']` at every key,
   so the "dark is the default" claim is verified rather than assumed

**`check-tokens.py`** finds `var(--x)` references with no matching
definition. This is the highest-value cheap check in the repo: Sass will not
flag it, it is valid CSS, and the symptom is silently missing spacing.

**`check-theme.mjs`** asserts the nine things CSS cannot express on its own:
dark is the default *on a light OS* (if the default only applied to readers
whose OS agreed with it, it would not be a default), no `data-theme` attribute
is needed to get it, the toggle reaches light and persists it, the preference
survives navigation, an explicit choice is never overridden by an OS change,
the OS never moves the theme at all, the page still renders dark with
JavaScript disabled, and the first painted frame is already the stored theme.
Expected colours are read out of the stylesheet rather than hardcoded — a
palette change previously broke six assertions that looked like theme
regressions but were stale expectations.

**`shoot.mjs`** drives headless Chromium over the DevTools Protocol using
Node's built-in `WebSocket`. It exists because two things cannot be reached
with `chromium --screenshot`:

- **Viewports below Chromium's ~500px minimum window width.** Screenshotting at
  `--window-size=390` actually renders at 500, and cropping to 390 produces a
  convincing but entirely fictional overflow bug. CDP's
  `setDeviceMetricsOverride` gives a true 390px viewport.
- **Each scheme as a reader sees it.** These are driven by the stored
  preference, not by emulating `prefers-color-scheme`, because the site default
  does not consult the OS. (`--force-dark-mode` is Chrome's auto-dark filter,
  not the media query, so it never exercised our tokens in the first place.)

Every shot also reports real layout facts — `scrollWidth` vs viewport, `<h1>`
count, computed body background — and flags overflow, ignoring anything inside
a scrollable ancestor.

`script/overflow-probe.html` and `script/mobile-shot.html` are the manual
equivalents — load them through a served `_site/` to inspect any width.

---

## Content

All page content is data-driven. Edit the YAML, not the templates.

| File | Drives |
|---|---|
| `_data/index/projects.yml` | Featured project card + `/rentafic/` case study |
| `_data/index/careers.yml` | Experience timeline |
| `_data/index/stack.yml` | Skills section |
| `_data/index/education.yml` | Credentials strip in the contact section |
| `_config.yml` → `owner` | Name, email, GitHub, LinkedIn |

Three conventions are load-bearing:

- **`careers.yml` durations are precomputed strings.** Liquid cannot do date
  arithmetic, so `duration: 2 yrs 10 mos` is maintained by hand. Change a
  `start` or `end` and you must update it.
- **`careers.yml` entries are ordered by relevance, not recency.** The `tier`
  field (`featured` / `standard` / `brief`) drives the visual treatment.
  Corficolombiana is six years of regulated-banking work and is deliberately
  placed late and given full treatment; recency alone would rank an 11-month
  contract above it.
- **The 2015–2020 consulting era is one entry, not three.** It previously
  appeared as three overlapping stints (CINTE Iberia, Various Startups, and
  Grupo Ditech). Three short overlapping contracts read as a series of jobs;
  one multi-client engagement with named clients reads as deliberate
  independence. This matches how the CV presents it.

`_config.yml` → `owner` is intentionally short. An earlier version carried 25
empty social placeholders, each driving a conditional in a template that
produced nothing.

### Figures are aligned with the CV

Every number on the site matches `~/Downloads/Rafael_Carrascal_Reyes.pdf`. If
you revise one, revise the other — a recruiter who reads both will notice.

| Figure | Value | Meaning |
|---|---|---|
| Years in technology | 15+ | from Mar 2009, Corficolombiana |
| Ruby on Rails | 10 yrs | `stack.yml` |
| FICs / FPVs tracked | 900+ / 500+ | RentaFIC |
| Users served | 5,000+ | across 5 products at Monokera |
| Query performance | +40% | PostgreSQL JSONB schema work at Monokera |

**Known CV defect:** the PDF header reads `rcarrascal@gmal.com` — the `i` in
`gmail` is missing. The site and `_config.yml` both use the correct
`rcarrascal@gmail.com`. Fix the CV.

---

## Design system

Two token files, in order:

- `_sass/abstracts/_primitives.scss` — raw values, no CSS output, no semantic
  meaning.
- `_sass/abstracts/_semantic.scss` — emits the dark mixin on `:root` (the
  default) and the light mixin on `:root[data-theme='light']`. Both live in one
  file, and the scheme-agnostic scale sits on `:root` only, so there is exactly
  one rule each for the theme tokens and no ordering hazard.

### The blue ramp — and why

Navy/blue, Tailwind's `slate` + `blue` scales. Chosen on evidence, not taste:

- A peer-reviewed study (200+ participants, sites identical except for colour
  scheme) ranked **blue highest on perceived trustworthiness across finance,
  legal and medical**. Black ranked lowest. In the **finance** context the
  effect was the largest of the three at 11.2% — the context that matters for a
  fintech/insurtech portfolio.
- Accent-hue frequency across 193 award-level sites: **blue 54**, orange 52, red
  40, green 15, **yellow 13**. The gold palette that shipped briefly was the
  second-weakest option; yellow reads as "caution" in the literature and carries
  food/construction connotations.
- Documented caveat: a "pure blue" page can flatten CTA salience. The mitigation
  is a **neutral page with blue as accent**, which is what this is.

| Role | Hex | On white |
|---|---|---|
| page / card | `#ffffff` | — |
| alt surface | `#f8fafc` | — |
| sunken | `#f1f5f9` | — |
| brand tint | `#eff6ff` | — |
| text | `#0f172a` | **17.85:1** |
| secondary | `#334155` | **10.35:1** |
| muted | `#475569` | **7.58:1** |
| link / button | `#1d4ed8` | **6.70:1** |
| accent underline | `#2563eb` | **5.17:1** |
| hero base | `#0f172a` | white on it: **17.85:1** |

Two stock Tailwind values are deliberately **not** used, and the audit catches
them if anyone swaps them back in:

- `--line-strong` is `slate-500` not `slate-400`. `#94a3b8` measures 2.56:1 and
  fails the 3:1 non-text threshold; `#64748b` clears it at 4.76:1.
- `--text-3` is `slate-600` not `slate-500`. `#64748b` measures 4.34:1 on
  `--bg-2` and fails AA for body text; `#475569` reaches 6.92:1.

`--brand-decorative` (`#60a5fa`) and `--line-hairline` (`#e2e8f0`) sit below 3:1
on purpose. They are marks and separators that never carry meaning alone, and
each has a redundant text or structural signal.

The neutrals are **slate, not pure grey**. A blue-grey carries the same family
as the accent and reads as a system; pure grey looks unfinished next to a
saturated blue.

### Hero background

Navy base plus a composited radial glow, not a bright gradient. Contrast over a
gradient is position-dependent and cannot be statically verified; this way the
worst-case composited field stays ≥15:1 for white at any viewport or angle.

### Focus ring

Two-tone (`outline` + `box-shadow` halo), scoped per surface. A single-colour
ring cannot work here: the default ring scores ~1.5:1 against the hero mid-stop
and `--brand` ~2:1 against a filled button. Both host focusable elements.
`@mixin on-dark` inverts the pair where needed.

### The OG card

`img/og-card.png` is generated with ImageMagick and regenerated whenever the
palette or headline changes. Its gradient bright stop is `#1e40af`, not
`#1d4ed8`, so the subhead clears 4.5:1 at the *bright* end of the field — at
`#1d4ed8` it dropped to 4.51:1, which is too thin to trust. This is the one
place a gradient's position-dependent contrast is measured rather than avoided.

### Layout

Internal sub-grids use **container queries**, not viewport media queries — the
RentaFIC card sits inside a full-bleed section, so its breakpoint is a
function of its own width.

Section anchors get `scroll-padding-top`, so a sticky-header anchor jump does
not park headings underneath the topbar.

---

## Accessibility

Enforced by `audit.py` and verified in both colour schemes:

- one `<h1>` per page, with `h2`/`h3` beneath it
- `<main>` landmark, skip link, `<nav aria-label>`
- two-tone `:focus-visible` rings; `:focus` styling is never removed
- touch targets ≥44px
- `prefers-reduced-motion` gates smooth scroll and transitions
- `forced-colors` (Windows High Contrast) handled — shadows and gradients are
  overridden, since the platform discards them
- print styles, because recruiters print and save this to PDF
- icon-only links always paired with a text label or `aria-label`
- theme toggle exposes `aria-pressed` and an action-naming `aria-label`, and
  is `hidden` unless the script that makes it work has run

The Chart.js skills radar was removed rather than repaired. A canvas with no
fallback content is an automatic 1.1.1 and 4.1.2 failure, radar charts
encode polygon *area* rather than value, and self-assessed percentages are not
verifiable claims. `stack.yml` replaces it with tier, years, and a specific
thing built.

---

## Theme

**Dark is the default.** Light is opt-in via the toggle.

```
:root                      → dark (default, no attribute needed)
:root[data-theme='light']  → light, unconditionally
:root[data-theme='dark']   → dark, explicitly (redundant, kept so the intent
                             survives a future edit to the default block)
```

There is deliberately **no `prefers-color-scheme` query anywhere.** A reader
whose OS is set to light still gets dark, because otherwise the "default" would
only apply to people whose OS already agreed with it — which would not be a
default at all. The toggle is the only way to reach light. `<meta
name="color-scheme">` is ordered `dark light` so the UA picks a dark canvas
before the stylesheet loads.

The choice persists in `localStorage`, survives navigation, and is never
overridden. Changing the OS theme changes nothing about the site.

### No flash of the wrong theme

A 12-line inline script in `<head>` runs **before** the stylesheet link and
sets `data-theme` from `localStorage`. Without it, a reader who chose light
sees a dark flash on every page load — the CSS would arrive second. Check 8 in
`check-theme.mjs` asserts the first rendered frame is already the stored theme.

### This is the site's only JavaScript

Two inline `<script>` blocks, no external file, no framework, no `defer`. It
ships as zero `.js` requests. The pre-paint script is necessary; the toggle
behaviour is not, so with JavaScript disabled the button stays `hidden` and the
page renders the dark default — nothing breaks, and no inert control is ever
presented.

The button uses `aria-pressed` plus an `aria-label` naming the *action* ("Switch
to light theme"), so the accessible name is correct both before and after a
click without needing a live region. The markup ships in the default state
(`aria-pressed="true"`, sun hidden) so it is never briefly wrong before script
runs.

---

## Assets

Self-hosted and subset to latin: **Inter** (variable, body) and **JetBrains
Mono** (400/500, metadata and code). Both are preloaded in `<head>` with
`font-display: swap`. The old setup `@import`-ed Google Fonts from *inside* the
compiled stylesheet — a serial render-blocking third-party request that could
not even be discovered until `main.css` had downloaded.

Icons are an inline SVG sprite in `_includes/icons.html`, referenced with
`<use>`. This replaced Font Awesome (~170 KB, ~6 icons actually used).

The RentaFIC screenshot ships as WebP with a 900px `srcset` variant and
explicit `width`/`height` matching its true 2.46:1 ratio.

---

## Attribution

The visual layer is original. `LICENSE.txt` is MIT, retained from the
**Leonids** theme by renyuanz that this site's markup descended from. That
credit is preserved in the footer.
