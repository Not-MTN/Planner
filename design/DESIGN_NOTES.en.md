# Planner — Personal Panel · Responsive Navigation Concept
### English companion notes for `design/index.html`

**Deliverable:** `design/index.html` — one self-contained, RTL, Persian-labelled design board (no build step, no dependencies beyond a Google Fonts link with a local fallback stack).
**Scope:** navigation architecture and responsive behaviour of the **authenticated Personal Panel** only. Landing page and auth screens are deliberately out of scope.
**App code:** untouched — `git status` shows only untracked additions (`PERSONAL_PANEL_AUDIT.md`, `design/`); nothing under `src/` was modified.

---

## 1. What the board shows

Three responsive states side by side on one canvas, auto-scaled to fit the viewport:

| # | Device | Mock | What it demonstrates |
|---|--------|------|----------------------|
| ۱ | Windows — Desktop | 1440 × 900 window, 250px sidebar | Full labelled sidebar, all 19 destinations visible **without scrolling**, compact rows, subtle group labels |
| ۲ | iPad — Tablet | 1024 × 768 frame; 66px icon rail + 206px contextual flyout + scrim | Collapsible system: rail by default, tapping a *category* opens a labelled panel beside it; content stays visible |
| ۳ | iPhone — Mobile | 390 × 844 frame; 5-item bottom bar + draggable sheet at 79% height | Bottom nav for the 4 most-used destinations + «بیشتر» opens a large labelled navigation sheet with the complete panel |

Under the two smaller devices there are state strips: tablet = **rail only / group open**; phone = **closed 18% / half-open 48% / fully open 79%**.

---

## 2. Navigation architecture (identical on all three sizes)

```
Personal Panel (پنل شخصی)
├── Plan (برنامه) ......... Today · Calendar · Tasks · Matrix
├── Focus (تمرکز) ......... Focus timer
├── Growth (رشد) .......... Habits · Goals
├── Track (پیگیری) ........ Notes · Plans · Insights · AI Coach
├── Panels (پنلها) ........ Student · Guardian · All panels      ← separate workspace
└── System (سیستم) ........ Notifications · Settings · Help · Account · Weekly Review
```

**Placement decision — Weekly Review (مرور هفتگی).** The brief listed no slot for it, so it sits in the **System** cluster as a weekly, cross-cutting tool, with an explicit note on the board saying why. It was placed, not silently dropped — and not squeezed into the double-crossed Track group.

---

## 3. How each size renders the same IA

**Desktop (always-visible sidebar).**
Grouped rows: Plan (4) · Focus (1) · Growth (2) · Track (4) = 11 rows, plus a **Panels workspace card** (3 rows) on its own beige surface and a **System footer** (Weekly Review, Notifications, Settings, Help) plus the account row. 19 destinations, 25px mock row height, no scrollbar, no horizontal squeeze; group labels are small, muted caption rows rather than big buttons. One row (Goals) deliberately renders the **focus-visible** ring so the accessibility state is visible on the board.

**Tablet (collapsible, never permanent).**
A 66px rail carries the **five categories** (with a tiny label under each icon) plus search, utilities and the avatar. Tapping a category opens a **206px labelled flyout** next to the rail — the board shows **Track** open with Notes / Plans / Insights / AI Coach. A scrim dims the content underneath (`Esc` or outside-tap closes it). Only the active leaf carries the "current" marker; the large screen area is never permanently consumed.

**Mobile (bottom bar + large sheet).**
Bottom bar = the four most-used destinations (Today · Tasks · Calendar · Focus) **+ More (بیشتر)**. "More" opens a **draggable sheet at 79%** of the screen, containing the *complete* personal panel:

- **Plan (برنامه)** — 2×2: Today · Calendar · Tasks · Matrix
- **Focus & Growth (تمرکز و رشد)** — 3 tiles: Focus · Habits · Goals
- **Track (پیگیری)** — 2×2: Notes · Plans · Insights · AI Coach
- **Panels (پنلها)** — Student · Guardian + full-width **All panels** (beige workspace styling)
- **Pinned footer (سیستم و ابزارها)** — 2×2: Notifications · Settings · Weekly Review · Help

The sheet is a **navigation layer, not a page**: the current screen stays visible behind it with a subtle dim + blur, and the persistent bottom bar remains where it is. Account/identity lives in the **screen header avatar** — the conventional mobile spot — which keeps the sheet to 79% while every tile stays a true touch target.

---

## 4. Coverage proof

The board's coverage matrix lists all **19 destinations × desktop / tablet / mobile**, plus a column stating *where the destination opens on mobile* (bottom bar / sheet group / header). A 20th row documents search & quick-add as an **affordance**, not a page. Nothing was removed, hidden or downgraded to shorten navigation.

---

## 5. Visual language (from the product's own dark tokens)

| Token | Value | Use |
|-------|-------|-----|
| bg / bg-deep | `#171410` / `#100e0b` | canvas |
| surface | `#1f1b15` | cards, sidebar |
| beige (workspace) | `#2a2420` | Student / Guardian / All panels — never mixed with productivity rows |
| sage (primary accent) | `#7dab8c` | active state, primary action |
| violet | `#a496d2` | AI Coach only |
| wine | `#c1838f` | due dates, alerts — sparingly |
| amber | `#d3a06e` | secondary/warm accents |
| ink / ink-soft | `#ece5d6` / `#c6bcaa` | type |
| radii | 22 · 16 · 12 · 9 | rounded cards, soft hairline borders, very soft shadows, minimal blur |

Dense but not cluttered; botanical and elegant rather than corporate; hand-authored Persian labels throughout (no lorem text).

---

## 6. Behaviour rules (band 2, panel 1)

1. The **current marker is always visible**: highlighted row (desktop), rail indicator + active flyout item (tablet), active tab + highlighted tile (mobile).
2. **A navigation layer never relocates the user**: picking a leaf closes the layer (mobile) or keeps the panel open (tablet); content stays on the same destination.
3. **`Esc` / outside-tap closes the layer**, it does not leave the screen; the browser Back button returns to the previous destination.
4. **Today can never be hidden** — it is pinned in navigation settings even if every other page is switched off.
5. **Identity is always one tap away**: bottom of the desktop sidebar, avatar above the tablet rail, avatar in the mobile header.
6. **Panels are opt-in** (off by default) and, once enabled, always appear on the beige "workspace" surface — never inside productivity groups.
7. **Resize / rotate only changes the pattern** (sidebar ↔ rail ↔ sheet); route and scroll position are preserved.
8. **Search / quick-add is one tap away at every size**: `⌘K`, the rail search icon, or the mobile bar + sheet.

---

## 7. Accessibility & touch (band 2, panel 2)

- **Touch targets:** sheet tiles ≈43px real (35px in the mock at ≈0.82 scale), bottom tabs ≥44px, rail rows 40px with 6px spacing.
- **Measured contrast on `#1f1b15`:** body text `13.7:1`, secondary `9.1:1`, sage accent `6.6:1`, muted `6.4:1`.
- **Colour discipline:** `--faint` measures `3.7:1` and is therefore used for **decorative only**; every meaningful label (group headers, rail captions, key/value labels, stat labels) was promoted to `--muted` or lighter. This rule is printed on the board.
- **Focus:** 2px sage ring with 2px offset, focus order follows the visual RTL order (demo row: Goals).
- **Keyboard:** `⌘K` palette · `N` / `T` creation shortcuts · `?` shortcuts · `⌘Z` / `⌘⇧Z` undo/redo · `Esc` close layer.
- **Motion:** honors `prefers-reduced-motion`; sheet animation 220ms.
- **States are never colour-only:** the notification badge carries a number, the current destination carries both an indicator and a highlight.
- **RTL:** Persian digits in prose, only directional icons (arrows/back) are mirrored.

---

## 8. Verification status

| Check | Result |
|-------|--------|
| HTML tag balance (parser pass) | clean — no unclosed/mismatched tags |
| CSS brace balance | 301 / 301 |
| Inline JS (`node --check`) | passes |
| Served locally | `HTTP 200`, latest revision |
| Pixel/screenshot review | **not possible in this sandbox** — the Chromium download for Playwright is blocked and no system browser exists. Review is by reading the HTML/CSS/SVG, plus the checks above. |

---

## 9. Open for your call

- Sheet height (79%) vs. tile size — can trade one for the other.
- Tablet flyout width (206px) if you want more label room.
- Whether **Weekly Review** should move into the Track group instead of System.
- Whether the mobile bottom bar should keep the brief's four destinations or swap one for Habits.

_How to open: double-click `design/index.html`, or use the local preview server running on port 8080._
