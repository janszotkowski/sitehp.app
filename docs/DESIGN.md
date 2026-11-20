# sitehp.app — Design Language

Living document. Answers: **how does sitehp.app look, feel and speak, and which rules keep it that way?**

Last updated: 2026-10-09

The motion, materials and typography rules build on the Apple design skill kept in the repository at [`.claude/skills/apple-design/SKILL.md`](../.claude/skills/apple-design/SKILL.md). What the product does is in [`FEATURES.md`](./FEATURES.md); the technology that implements this language is in [`ARCHITECTURE.md`](./ARCHITECTURE.md#tech-stack).

---

## 1. Design intent

**sitehp.app should feel calm, premium and trustworthy.** A site owner pastes a URL and, a few seconds later, sees one clear number and a short list of what to do. The product's emotional job is to turn a worrying technical unknown into something understandable and actionable, without alarm and without noise.

| We want people to feel | We avoid |
|---|---|
| **Calm** — nothing shouts; bad news is delivered plainly | Red alarms, fear marketing, cluttered dashboards |
| **Confident** — the score is credible and explained | Gimmicks that make a serious tool look like a toy |
| **In control** — they can drill in or stay at the surface | Forcing technical detail on non-technical owners |
| **Delighted by craft** — motion and type feel considered | Decoration that does not carry meaning |

### 1.1 Personality in four words

**Calm. Precise. Premium. Direct.**

- *Calm* in visuals and motion; *precise* in numbers and wording; *premium* in materials and typography; *direct* in copy.

### 1.2 Audience

The design serves **site owners and e-shop owners** and **developers and agencies** equally. The default view is plain-language and uncluttered; technical depth (evidence values, headers, snippets, raw check ids) is one disclosure deeper and never removed. The same screen must work for someone who has never heard of HSTS and for someone who wants the exact header value.

### 1.3 Principles

The eight Apple principles are the vocabulary we reason with; here is how each lands in sitehp.

| Principle | In sitehp.app |
|---|---|
| **Purpose** | One job per screen. The landing page does one thing (scan a URL); the report does one thing (what to fix first). |
| **Agency** | Optional depth: expand any finding, choose BYOK AI or not, switch tone to Roast. Nothing is forced. |
| **Responsibility** | Privacy stated plainly (your key stays in your browser); no dark patterns; reports are not indexed by default. |
| **Familiarity** | Standard patterns for tabs, sheets, disclosures; the score ring echoes familiar activity rings. |
| **Flexibility** | Mobile first, desktop master–detail; light and dark; reduced motion, transparency and contrast respected. |
| **Simplicity** | The score and the top fixes first; everything else behind a disclosure. Concise, jargon-free labels. |
| **Craft** | Every spacing, radius, timing and tracking value comes from a token; nothing is arbitrary. |
| **Delight** | Comes from the score ring filling with real physics and from restraint elsewhere, not from decoration. |

---

## 2. Platform strategy

- **Mobile first.** The primary use is a report link opened on a phone from a social post or a message. Every component is designed for touch and thumb reach first and enhanced for desktop.
- **Desktop is an expansion, not a separate design.** The same components reflow; the report becomes a **master–detail** layout with the finding detail beside the list.
- **Themes.** **Dark is primary and the identity**; light is a full peer built from the same tokens with equal care. Theme follows the system and can be set manually.
- **Input.** Pointer Events everywhere so touch, mouse and pen share one interaction model; hit targets are at least 44 × 44 px with extra padding where visual size is smaller.

---

## 3. Color

### 3.1 Principles

- Almost monochrome UI; **color carries meaning**, and the meaning is the **state of the score**.
- Color is never the only signal: every state also has an icon and a text label.
- All text and meaningful UI colors meet WCAG AA (4.5 : 1 text, 3 : 1 UI) on every surface they appear on. The values below were checked against the three surface levels of each theme.

### 3.2 Neutral palette (CSS variables, one set per theme)

The variable names are the shadcn/ui names, so every component picks the palette up unchanged. The semantic role in the design language is in the last column. Values live in `apps/frontend/src/styles/app.css`; `tests/design/tokens.test.ts` fails if the CSS and this table ever disagree.

| Token | Dark | Light | Role |
|---|---|---|---|
| `--background` | `#000` | `#FBFBFD` | Page background |
| `--card` | `#141418` | `#FFFFFF` | Surface 1: cards, rows |
| `--secondary` | `#1C1C22` | `#F2F2F6` | Surface 2: raised or nested surfaces, inputs (`--muted` and `--accent` share it) |
| `--border` | `rgba(255,255,255,.08)` | `rgba(0,0,0,.08)` | Hairlines and card edges |
| `--foreground` | `#F5F5F7` | `#17171A` | Primary text |
| `--muted-foreground` | `#A6A6AE` | `#4E4E57` | Secondary text |
| `--subtle-foreground` | `#8B8B95` | `#5F5F69` | Tertiary text, captions, metadata |
| `--link` | `#3DD68C` | `#0C6E42` | Links and focus rings (`--ring`): the brand green |
| `--primary` | `#F5F5F7` | `#17171A` | Primary action (inverted) |
| `--primary-foreground` | `#0B0B0E` | `#FBFBFD` | Text on the primary action |

The primary button is **inverted** (light on dark, dark on light): no brand color is needed for the main call to action, which keeps the interface monochrome and lets score color stay meaningful. Error text and destructive actions use `--destructive` (`#FF6B63` dark, `#B3281F` light), the hue of the Critical band (a shade darker in light, so error text stays 4.5 : 1 on the page glow).

### 3.3 Score colors — state by HP

The page takes on the mood of the score. Five anchor colors, placed at the middle of their bands (20, 50, 70, 87, 98), are interpolated **continuously** (in OKLab, so there are no muddy mid-points); the score never snaps between bands. The pure function `scoreColor(hp, theme)` in `@sitehp.app/core` does it and is shared with the Open Graph image; the page-level variable `--score-color` holds the result (default `--score-good`).

| Token | HP | Meaning | Dark | Light | Icon |
|---|---|---|---|---|---|
| `--score-critical` | 0–39 | Needs urgent attention | `#FF6B63` | `#BF2F27` | alert triangle |
| `--score-poor` | 40–59 | Significant problems | `#FF9F43` | `#A65200` | alert circle |
| `--score-fair` | 60–79 | Room to improve | `#F2D14B` | `#7F6200` | minus circle |
| `--score-good` | 80–94 | Solid | `#3DD68C` | `#0F7A4B` | check circle |
| `--score-excellent` | 95–100 | Exemplary | `#2DD4CF` | `#087572` | sparkle / double check |

How the state color is used:

- The **ring, the score number and the category rings** take the state color.
- The page background gets only a **very low-opacity radial tint** of the state color behind the score; surfaces, text and borders stay neutral. The tint is limited to the report header region and is removed under `prefers-contrast: more`.
- During a live scan the color **evolves with the running score** (marked preliminary) and settles when the scan completes.
- A skipped or unavailable check uses **neutral** gray, never red (see section 9).

### 3.4 Roast mode tint

Roast mode keeps every component and adds a **warm tint**: `--roast` (`#FF8A4C` dark, `#B34700` light) drives a very faint wash behind the report header (`roast-tint`, used instead of `score-tint`), a flame icon beside the tone switch and a more assertive headline style. Surfaces, spacing and motion are unchanged (section 11). Planned: the `--roast` token and `roast-tint` are added to `app.css` together with Roast mode, not before.

---

## 4. Typography

**Typeface: Inter** (variable, weight axis only), self-hosted, with a system sans fallback stack and the Latin file preloaded. The Apple skill recommends the system font by default; we deliberately override that for one reason — a **consistent identity across every device and browser**, since a report is shared and previewed everywhere. Inter's optical-size axis was dropped for page weight: its Latin file is 73 kB against 48 kB, and on a slow mobile link that delayed the first paint; size-specific tracking is set per text role instead. Monospace for code, headers and evidence values: **system monospace** (`ui-monospace`) to avoid another font download.

### 4.1 Rules (from the skill)

- **Tracking is size-specific**: large display text is tightened, small text is slightly opened, body stays near zero.
- **Leading is inverse to size**: tight on large headings, comfortable on body copy.
- **Hierarchy comes from weight, size and leading together**, not size alone.
- **Dynamic Type**: sizes and spacing are in `rem`/`em`, so the layout follows the user's text-size setting.
- Numbers use **tabular figures** (`font-variant-numeric: tabular-nums`) wherever they update or align, so counters do not jitter.

### 4.2 Scale

Each role is a Tailwind text utility that sets size, leading, tracking and weight together (`text-score`, `text-display`, …), defined as `--text-*` theme variables in `app.css`. Inside the score ring the numeral is sized relative to the ring (container units: 36 % of its width, 27 % for 100) so it always fits, keeping the weight, leading and tracking of the score role; `text-score` is for a numeral outside a ring. Body is the default (`1rem` / 1.5 / 400). Overline text is also set with Tailwind's `uppercase`.

| Role | Class | Size | Weight | Leading | Tracking |
|---|---|---|---|---|---|
| Score numeral | `text-score` | `clamp(5rem, 22vw, 9rem)` | 600 | 0.95 | −0.04em |
| Display (landing hero) | `text-display` | `clamp(2.25rem, 7vw, 4rem)` | 600 | 1.05 | −0.03em |
| Title 1 | `text-title-1` | `2rem` | 600 | 1.15 | −0.02em |
| Title 2 | `text-title-2` | `1.5rem` | 600 | 1.2 | −0.015em |
| Headline (row title) | `text-headline` | `1.0625rem` | 600 | 1.35 | −0.005em |
| Body | (default) | `1rem` | 400 | 1.5 | 0 |
| Callout / secondary | `text-callout` | `0.9375rem` | 400 | 1.45 | 0 |
| Caption / metadata | `text-caption` | `0.8125rem` | 500 | 1.35 | +0.01em |
| Overline (category label) | `text-overline` | `0.75rem` | 600 | 1.2 | +0.06em |
| Code / evidence (mono) | `text-code` | `0.8125rem` | 400 | 1.5 | 0 |

Body text on a translucent surface uses the `vibrancy` utility (one step heavier weight and a small tracking bump). Maximum text line length is 65–70 characters (`max-w-prose`). Numbers that update or align use `tabular-nums`.

---

## 5. Shape, space and elevation

### 5.1 Shape — generously rounded

Large radii with **continuous (squircle-like) corners** where supported, for a soft, Apple-like feel.

| Token | Radius | Use |
|---|---|---|
| `--radius-xs` | 8 px | Chips, tags, code blocks |
| `--radius-sm` | 12 px | Inputs, small buttons |
| `--radius-md` | 18 px | Buttons, rows |
| `--radius-lg` | 24 px | Cards |
| `--radius-xl` | 32 px | Sheets, dialogs, the URL input |
| `--radius-4xl` | 999 px | Pills, toggles, rings' end caps (`rounded-4xl`) |

Nested radii obey *inner = outer − padding* so corners stay concentric.

**These radii are for controls and floating layers** (buttons, inputs, pills, chips, menus, dialogs). Content is not put in rounded boxes: see section 5.5. The `--radius-lg` "Cards" row is kept for the rare exception named there.

### 5.2 Spacing

A **4 px base grid** with a restrained scale: 4, 8, 12, 16, 24, 32, 48, 64, 96 (Tailwind spacing steps 1, 2, 3, 4, 6, 8, 12, 16, 24). Components use only those steps. Generous whitespace is part of the premium feel: sections breathe at 48–96 px on desktop and 32–48 px on mobile.

### 5.3 Elevation and borders

- Content is separated by hairlines (`--border`), not by boxes (section 5.5). Where a surface is needed (a control, a floating layer), it is flat, stepped by `--surface-*`, not a heavy shadow.
- Floating layers (navigation, sheets, dialogs, popovers) add a soft, larger shadow; bigger surfaces get a deeper shadow than small chips.
- Hairlines are 1 px (device-pixel aware); a brighter top edge on glass suggests light catching the material.

### 5.4 Iconography

**Lucide** icons at a stroke width tuned to the weight of adjacent text (1.75 at body size, 2 at small sizes), rounded line caps and joins to match the soft shapes. Icons that carry state are paired with text. Sizes: 16, 20, 24.

### 5.5 Surfaces: type and hairlines, not cards

**Content is drawn with type and 1 px hairlines (`--border`), never as a box with rounded corners and a fill.** This is the landing page's language, taken from Vite, Cloudflare and oxc.rs, and it applies to every page and screen: the report, the dashboard, the information pages, settings. The owner asked for it explicitly (2026-10-13): rounded cards are wrong for this product. The result is calmer, denser, and reads as one system.

The patterns, each already in the code (reuse them; do not draw a new box):

| Pattern | How it is drawn | Where it is used |
|---|---|---|
| **Strip of figures** | `grid divide-x border-y` (stacked with `divide-y` on a phone): large numbers (`text-score`), a label under each, the cells filling the width | Landing "53 checks, 4 areas, 0 accounts"; the report's category scores |
| **Ruled list** | `RuledList`: rows divided by hairlines, the title on the left and what it means beside it | Home, About, How we score |
| **Ruled columns** | `RuledColumns`: each column is type under its own `border-t pt-5`, with `glow-hover`; no fill | Landing steps and trust points; the report's "Fix these first" |
| **Table** | `border-y` around it, `border-t` between rows, no outer rounded border, no fill | The report's checks |
| **Panel contents** | Sections divided by `border-y` and `divide-y`; a label and its value as a `divide-y` list; a three-fact strip as `grid-cols-3 divide-x border-y` | The finding drawer and sheet |
| **Fold-away** | A `border-t` row with the title and a chevron; the panel opens under it, no box | "Technical details" |
| **Code and values** | `border-y bg-muted/50`, square | Badge snippets |
| **Section heading** | `text-title-2` with one hint line (`text-caption text-subtle-foreground`) beside it on a wide screen; the section starts under a `border-t` | Every section of a long page |

Rules:

- **A clickable cell is a button that fills the whole cell**, with hover `bg-secondary/30`, selected `bg-secondary/60` and an inset focus ring. The hairlines do not move when it is pressed.
- **What stays rounded:** controls (inputs, buttons, the segmented switch, the export menu), status pills and chips, rings and circles, menus and floating layers. A bottom sheet has square corners.
- **Stay inside the frame.** Pages sit in the 64 rem column (`max-w-5xl`) between the two edge hairlines every page draws behind its content (`body::after`), so ruled cells line up with the frame.
- **Colour is the data, not a fill.** A score is a large number in `--score-color` (`score-themed text-(--score-color)`), never a tinted box.
- **One exception:** a card may be drawn only to imitate the product itself (the landing page's sample finding). Nothing else.
- **A new component starts from this table.** If none of the patterns fits, say so and extend the table; do not reach for `rounded-lg border bg-card`.

---

## 6. Materials and depth — a combination

**Glass is for what floats above content; flat surfaces are for content itself.**

| Layer | Treatment | Examples |
|---|---|---|
| **Glass** (translucent, `backdrop-filter`) | Blur 20–40 px + saturation, semi-transparent background, bright top edge, soft shadow | Mobile tab bar, desktop rail, sticky headers, dialogs, bottom sheets, popovers, the tone switch |
| **Flat** (opaque) | Solid `--surface-1/2`, hairline border, no blur | Inputs, finding rows, the fields of a form; content itself is not boxed (section 5.5) |

Rules:

- **Weight encodes hierarchy.** Structural regions (rail) use a heavier, darker glass; interactive elements (tab bar, buttons on glass) use a lighter one. **Never stack a light translucent surface on another.**
- **Bigger surfaces read thicker**: stronger blur and a deeper shadow than small chips.
- **Dim to focus, separate to keep flow.** Modal sheets and dialogs use a dimming scrim and push the page back; non-blocking panels (the desktop detail pane) use translucency and offset without a scrim.
- **Scroll edge effects instead of hard dividers.** Under sticky glass, content fades through a small blur/gradient mask rather than a 1 px rule.
- **Materialize, don't just fade.** Glass surfaces animate blur radius and scale together on enter and exit.
- **Vibrancy.** Text on glass uses higher contrast and slightly heavier weight; color lives on a solid layer, not on the translucent foreground.
- **Fallbacks.** `prefers-reduced-transparency: reduce` turns glass into near-solid surfaces without blur; `prefers-contrast: more` adds defined borders and removes tints.

In code: the utilities `glass` (lighter, for interactive elements) and `glass-heavy` (darker, for structural regions), the variables `--glass-bg`, `--glass-border`, `--glass-edge` (the bright top edge), `--glass-shadow`, `--glass-blur` (24 px, 1.5× on heavy glass) and `--scrim` for modal dimming, the `scroll-edge-top` mask for fading content under sticky chrome, and `vibrancy` for text on glass.

---

## 7. Motion

**Physical and springy.** Everything a user can touch is spring-driven, interruptible and velocity-aware; fixed-duration CSS transitions are used only for non-interactive ambient changes (color and opacity).

### 7.1 Rules

1. **Respond on pointer-down**, not on release; feedback continues through the gesture.
2. **Track 1 : 1** with the pointer and respect the grab offset (`setPointerCapture`).
3. **Every animation is interruptible**: it starts from the current on-screen value, and re-targeting carries velocity (no "brick wall").
4. **Springs by default, critically damped.** Bounce only when the gesture carried momentum.
5. **Enter and exit along the same path**; popovers and sheets originate from their trigger (`transform-origin`).
6. **Rubber-band** at boundaries instead of hard stops.
7. **Animate `transform` and `opacity` only**, hinting `will-change` where motion is imminent.
8. **2D motion is decomposed** into independent X and Y springs.

### 7.2 Spring tokens

| Token | Damping | Response | Use |
|---|---|---|---|
| `spring-default` | 1.0 | 0.35 s | Most UI: expansions, reorders, appearing rows |
| `spring-quick` | 1.0 | 0.25 s | Press feedback, toggles, small state changes |
| `spring-ring` | 1.0 | 0.6 s | Score and category ring fills, number counting |
| `spring-entrance` | 1.0 | 1.2 s | Entrances: the ring filling from empty when a page opens, slow enough to be watched |
| `spring-sheet` | 0.8 | 0.3 s | Bottom sheet and drawer after a flick |
| `spring-move` | 1.0 | 0.4 s | Repositioning, reflow |

The tokens are exported from `apps/frontend/src/lib/motion.ts` (`springs`, `projectMomentum`, `rubberband`) in Motion's `bounce` + `duration` terms (damping 1.0 → `bounce: 0`, damping 0.8 → `bounce: 0.2`, response → `duration`); `tests/design/tokens.test.ts` checks them against the table above.

Flick landing points use momentum projection: `current + (v / 1000) · d / (1 − d)` with `d ≈ 0.998`, then hand the release velocity to the spring.

### 7.3 Signature moments

- **Ring entrance (landing demo).** When the page opens, the demo ring fills from empty to its score on the slower `entrance` spring (1.2 s) while the numeral counts up. It is an entrance only: the server and first render show the empty state, and the animation starts after mount; with reduced motion it simply shows the score.
- **Ring fill (live scan).** As checks complete, each category ring grows via `spring-ring` toward its running value while the center numeral counts up with tabular figures. Because springs re-target from the live value, rapid events never stutter or restart the motion. Color interpolates with the score.
- **Check arrival.** A finding row appears in its list with a short vertical spring and a fade; skeleton rows occupy the space of checks still running so the layout does not jump.
- **Completion.** The scan ends quietly: the preliminary marker disappears, the ring settles and the headline sentence resolves ("Fix these 3 things and gain +25 HP"). No confetti, no sound.
- **Row expansion.** The finding row expands by height and opacity with `spring-default`, anchored at its top edge; collapsing reverses along the same path and can be grabbed mid-flight.
- **Sheets and dialogs.** Bottom sheets follow the finger, can be flicked with projected momentum and rubber-band at the top; they materialize with blur and scale.

### 7.4 Reduced motion

`prefers-reduced-motion: reduce` replaces slides and springs with **short opacity cross-fades or static state changes**, removes overshoot and parallax, and keeps color and opacity changes that aid comprehension. The ring still fills, but as a fade-in value change, not a sweep. Theme changes ease rather than flash. There are no full-viewport moving backgrounds and no slow looping oscillations.

### 7.5 Feedback channels

**Visual only.** No sound and no haptics. Physical feel comes from spring response and instant pointer-down feedback.

---

## 8. Layout and navigation

### 8.1 Landing page

Two layers, as one scroll:

**Above the fold (the product):**

1. **Headline and the URL field** — a large, `--radius-xl` input with an inverted primary action. The field is the hero.
2. **Live demo** — directly beneath it, an animated, looping sample report that fills with the real ring and row choreography so the product is understood in two seconds without reading. It is non-interactive, pausable, static under reduced motion, and clearly labelled as a demo.

**Below the fold (marketing):** what is checked (five categories), how it works, a sample of the human explanations and guides, pricing, FAQ and the footer with privacy notes. Sections follow section 5.5 (type and hairlines, no cards), large type and generous space; the URL field returns in a sticky glass bar so the action is always one tap away.

### 8.2 Report

The report is the heart of the product and its URL is identical for live and finished states.

**One table, not a list with a pane.** A report has dozens of checks and will have more, so the report is built for scale: a short summary above, **one table of every check** below, and the detail of one check in a **drawer**. (The first design, a list with a detail pane beside it, ran out of room as soon as the list grew, and its two stacked rows of filters repeated each other.)

**No rounded cards on the report.** The report is drawn like the landing page: type, hairlines and ruled cells (`divide-x`, `border-y`), no box with rounded corners and a fill. Controls keep the landing page's pill shape.

**Desktop:**

1. **Hero:** the score ring, the domain, one verdict sentence, the scan progress or "Scan complete".
2. **Category scores:** the landing page's strip of figures between hairlines (no cards): the category's score as a large coloured number, its name and its share of the HP. Each cell is a button: selecting one narrows everything below to that category (a line says so, with a way back), selecting it again clears it.
3. **Fix these first:** up to three ruled columns (type under a hairline, like the landing page's steps; no cards) for the checks worth the most HP, each with the HP gain as a large figure, its name and status, and the first sentence of its explanation; a column opens the detail. Shown only while no search or Passed filter narrows the list.
4. **Toolbar (one row):** search, the status filter (Needs attention, Passed, All, with counts) and the export menu (copy or download JSON and Markdown, PDF). A finished report starts on Needs attention, with a link under the table to the passed checks ("44 checks passed. Show them"); a running one, or one with nothing to fix, starts on All.
5. **The table**, worst first and the biggest HP gain first within it: status, check name with its group beneath, HP gain, and the measured value as a short sentence with readable labels and units (a header the page sent is shown as sent, in code type). Every column sorts.
6. **The drawer** (right, 28 rem): read top to bottom: a strip of three facts between hairlines (HP gain, severity, time to fix), what the check is, what we found (a list, with a callout for why it was skipped), links to the documentation, and the developer's facts (id, area, weight, points lost) folded under "Technical details". "3 of 22" with previous, next and close. It is non-modal glass that slides in without a scrim, on `spring-move`, hanging from the bottom of the header (`--site-header-height`). While it is open the table view makes room for it (`drawer-clear`), so no column or control is ever under it (WCAG 2.4.11) and the table stays usable beside it. The arrow keys (or J and K) step through the findings without closing it; Escape closes it.


**Mobile (single column):** the hero with the ring and the verdict; the category scores (one per row); the three cards of what to fix first; the toolbar; the table with status, name and gain; a tap opens the detail as a **bottom sheet** (follows the finger, rubber-bands, projects the flick).

**Why a drawer and not a dialog:** a dialog covers the table and breaks the flow of working down a list; a non-modal drawer keeps the list in view and lets a person step from one finding to the next.

### 8.4 Dashboard (signed in)

- **Mobile:** a **bottom tab bar** in glass (Sites, Reports, Account), thumb-reachable, like iOS.
- **Desktop:** a **narrow left rail** (icon + label on hover or expand) in heavier glass.
- The same destinations on both; content is a list of sites as ruled rows (section 5.5, not cards), each showing the current HP ring, trend sparkline and last scan time. Selecting a site opens its history chart and monitoring settings.
- Wayfinding on every screen: where am I (page title and active nav state), where can I go (navigation), what is here (content), how do I get out (back or close, always visible).

### 8.5 Width and density

Mobile: full width with 16 px side gutters. Desktop: report and dashboard use a master–detail grid with a content max-width of roughly 1200 px; long-form text (explanations, marketing copy) is capped at 65–70 characters.

---

## 9. States and feedback

Four kinds of feedback — status, completion, warning, error — all in a **calm, factual** voice.

| Situation | Treatment |
|---|---|
| **Scanning** | Progress is the rings and arriving rows; a subtle "Preliminary" label on the running score; no spinner overlays |
| **Check skipped / not available** | **Neutral gray**, calm text ("We couldn't complete this test"), no red, with the reason; never blamed on the user. The score notes it was computed from the completed checks |
| **Site unreachable or blocks us** | A full-state message: what happened and what to try (check the URL, try again), with a retry action |
| **Invalid URL** | Inline validation under the field as the user types, never only on submit |
| **Rate limited** | Plain statement and when to try again |
| **Empty** (no sites, no history) | One sentence and one action |
| **Destructive actions** | Confirmation only for irreversible ones; everything else is undoable |

Errors always use stable codes mapped to localized messages; messages say what happened and what to do next.

---

## 10. Voice and microcopy

**Direct and sober.** Facts without hedging, short sentences, light dry wit at most. No exclamation marks, no fear, no filler.

| Instead of | Write |
|---|---|
| "Oops! Something went wrong." | "We couldn't reach that site. Check the address and try again." |
| "Your website is in danger!" | "HTTPS isn't enforced. Visitors can reach your site over an insecure connection." |
| "Fix this ASAP to boost your score." | "Add an HSTS header. Takes about 5 minutes. +6 HP." |
| "Awesome job!" | "Security is in good shape." |

Rules:

- **Name things by what they contain** ("Findings", "Sites"), not vague umbrellas.
- **One idea per sentence.** Explanations answer three questions in order: what it is, why it matters, what happens if it is missing.
- **Technical terms are explained once** and then used; the evidence view uses exact technical language.
- **English and Czech** (`messages/en.json`, `messages/cs.json`). English is written for non-native speakers: plain words, no idioms. Czech addresses the reader formally (vykání), in the same plain style.
- All copy lives in Paraglide messages; no hard-coded strings.

---

## 11. Roast mode

Roast mode is the **same report in a sharper voice**. Visually it is a *slightly changed tone*, not a different design:

- A switch in the report header (glass), with a flame icon.
- A **warm neutral tint** behind the header and a more assertive headline style; components, spacing and motion are identical.
- Copy is cheeky but aimed at the **site, never at a person**; no personal attacks on named companies, and the tone is a clear, reversible choice.

---

## 12. Sharing assets

### 12.1 Open Graph image

A **dark card with the ring**: the large score ring and numeral in the state color, the domain, the date and the sitehp mark, in the same typography and tint logic as the report. Generated on the server per report. A light variant is not needed for social previews.

### 12.2 Badge

A compact, flat ring-and-number mark in the state color on a neutral pill, legible at small sizes in light and dark READMEs; Free plan carries a basic mark, paid plans can remove branding.

---

## 13. Accessibility

Accessibility is part of the design, not a pass at the end.

**The standard we build to.** The European Accessibility Act (Directive (EU) 2019/882, applicable since 28 June 2025) refers to the harmonised standard EN 301 549, whose web requirements are WCAG 2.1 level AA. We build to **WCAG 2.2 level AA**, which includes every 2.1 AA requirement. Micro-enterprises that provide services are exempt from the Act, but the product is built to the same bar either way, and the site publishes an accessibility statement.

**How it is kept.** Four layers, so a regression is caught by a machine where a machine can catch it:

1. `oxlint` with the `jsx-a11y` rules (`--deny-warnings`), part of `pnpm verify` and CI.
2. `tests/design/contrast.test.ts` recomputes the WCAG contrast of every pairing the UI draws, from `app.css`, in both themes: text 4.5 : 1, the focus ring and the edge of a form control (`--input`, opaque) 3 : 1, the status pills on their wash, and the worst composited backgrounds: every text on the peak of the score glow (`--glow-strength`: 16 % dark, 15 % light; the light page glow uses the vivid green `--glow-color`) and on heavy glass over that glow and over each surface.
3. Structure that tests cannot judge is a rule of the components: a status is always also said in words (a visually hidden label next to an icon); a data table has a `caption`, column and row headers; a control's name comes from its visible text; the page change is announced and focus moves to `main` (`RouteAnnouncer`); a failed submit puts focus on the field that has the error.
4. A manual pass with axe-core (WCAG 2.2 AA and best practice) on every page in both themes, at 1280 px and 320 px, with the sheet and the table row open.

- **Contrast:** AA minimum for text and UI in both themes; the palette above is checked on all surface levels.
- **Not color alone:** every state pairs color with an icon and text.
- **Keyboard:** everything is reachable and operable; visible focus rings in `--link`, never removed; logical order; a detail pane that is announced when selection changes.
- **Screen readers:** semantic structure and landmarks; the live score region announces **completion and meaningful milestones**, not every tick (polite live region, throttled).
- **Targets:** at least 44 × 44 px.
- **Text size:** `rem`-based type and spacing follow the user's setting; layouts are tested at 200 % text size.
- **System preferences:** `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast`, and `prefers-color-scheme` are all respected (sections 6 and 7).
- **Language:** `lang` set from the active locale; layouts allow longer strings so future locales do not break them.

---

## 14. Implementation mapping

| Concern | How it is built |
|---|---|
| Tokens | CSS custom properties in `apps/frontend/src/styles/app.css`: light on `:root`, dark on `.dark`, mapped to Tailwind through `@theme inline`; the server renders `<html class="dark">` and `src/lib/theme.ts` switches to the system or stored choice before first paint |
| Components | shadcn/ui on Base UI (style `base-maia`, Lucide icons), restyled through the tokens; buttons use `--radius-md`, press feedback `scale(.97)` at 100 ms, and a hit area of at least 44 × 44 px |
| Springs and gestures | Tokens in `src/lib/motion.ts`; a spring library with velocity-aware re-targeting (Motion) and Pointer Events for gestures |
| Glass | Utilities `glass`, `glass-heavy`, `scroll-edge-top`, `vibrancy` with fallbacks driven by `prefers-reduced-transparency` and `prefers-contrast` |
| Typography | Inter variable, weight axis only (`@fontsource-variable/inter/index.css`), Latin file preloaded in `__root.tsx`; text roles as `text-*` utilities |
| Icons | Lucide |
| State color | `scoreColor(hp, theme)` in `@sitehp.app/core` (OKLab interpolation of the five anchors), shared with the OG image generator; the page sets `--score-color`. It colors graphics (rings, bars, glow), which need 3 : 1, so its light anchors are more vivid than the `--score-*` tokens above, which a status pill also writes text in (4.5 : 1) |
| Drift guard | `tests/design/tokens.test.ts` parses the tables in this document and fails if `app.css` or `motion.ts` disagree |
| OG image | Server route with `satori` and `resvg`, using the same tokens |
| Copy | Paraglide messages |

Design review checklist before shipping any screen: no rounded card or filled box around content (section 5.5); pointer-down feedback present; every animation interruptible; critically damped unless momentum; reduced-motion, reduced-transparency and high-contrast variants exist; both themes checked; no color-only meaning; copy in messages; spacing, radius and type from tokens only.

---

## 15. Deferred

- **Logo and brand mark.** The product uses the wordmark `sitehp.app` in Inter until a mark is designed. Nothing in this language depends on it; the ring is a design motif, not the logo.

---

## Related documents

- [`FEATURES.md`](./FEATURES.md) — what the product does
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — how it is built, and the technology behind this language
- [`.claude/skills/apple-design/SKILL.md`](../.claude/skills/apple-design/SKILL.md) — the Apple design skill this document builds on
