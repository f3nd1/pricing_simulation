# UCC Planning Suite — Frontend Guide

`ucc_budget_simulator.html` · v1.85.0

How the interface is put together, who it is for, and the rules that keep it
consistent. For calculations and data flow, see `TECHNICAL.md`.

---

## 1. Who this is for

Two readers, and every screen has to serve both:

- **The Principal / management lead** — needs the answer, the confidence level,
  and what to do next. Should never have to derive a number mentally.
- **The UCC management team** — needs to trace a figure back to its source and
  defend it in a meeting.

Neither is assumed to be a finance professional. A **Simple / Advanced** toggle
carries the second reader without taxing the first: Simple shows management
labels, Advanced adds the technical vocabulary and the diagnostic columns.

Everything ships in **English and Simplified Chinese**, switchable from
`EN | CN` in the header. The choice persists and applies to the whole suite
including print output.

---

## 2. Shell

```
module-nav ─ brand · current module · EN|CN · ☁ Cloud saves
nav-drawer ─ nine modules with one-line descriptions
wrap       ─ hdr (gradient header, KPI bar) · body (left panel / right panel)
```

The nav drawer is the only global navigation. Modules never nest; each owns its
own tab strip. On narrow screens the tab strips wrap rather than scroll
horizontally.

---

## 3. Cost-Benefit information architecture

The largest module, organised around what a manager is trying to do rather than
around finance concepts:

| Mode | Question it answers |
|---|---|
| **Manage** | Where do I start? What needs attention? |
| **Analyse** | Portfolio: where are the issues? · Course: why this result? · Compare: which is stronger? |
| **UCC Break-even** | What does the whole college need to cover all its costs? |
| **Simulate** | What if I change one course, or several? |
| **Present** | Management report · Trends over time |

Plus **⚙ Data & assumptions** for course inclusion, allocation driver and
per-course rates.

Every mode and subview carries an ⓘ explaining what it is for, and one discreet
**ⓘ How to use Cost-Benefit** beside the mode bar summarises all five. The
Analyse popover carries the compact mental model — *Portfolio = Find,
Course = Understand, Compare = Decide* — inside the popover rather than as
cards taking up page space.

---

## 4. Design system

**Surfaces.** White workspace (`--surface-0`), off-white page ground, cards on
`.cb-panel`. Grey panels were removed deliberately: they made the interface
read as disabled.

**Grid.** `.cb-grid` is 12 columns of `minmax(0, 1fr)` — never bare `1fr`,
whose `min-width: auto` is the classic cause of horizontal page scroll.

**Type.** One family, declared on `.wrap`. Anything appended to `document.body`
(the floating tooltip) must declare `font-family: var(--font)` explicitly or it
inherits the browser serif default.

**Tone.** `CBA_TONE` maps `good / warn / bad / info / mute` to a colour and a
tint. Status is never carried by colour alone — every state also has a word or
an icon.

**Density.** Text was cut 40–50% from the original design. Chips replace
sentences, one strong number per card, supporting detail as `.cb-sub`.

---

## 5. Tooltips — one component

There is exactly **one** tooltip in the application: a single floating
`.cb-tip` element, driven by `data-tip` attributes.

```js
cbaInfo(title, body)   →  <i class="cb-i" data-tip role="button" tabindex="0" aria-label>i</i>
```

- Hover, keyboard focus and tap all open it; **Escape** and a click outside
  close it.
- A tap keeps it open until dismissed — long explanations used to vanish after
  four seconds, mid-sentence.
- It is measured from a neutral position with a viewport-capped `max-width`,
  then clamped inside the viewport. (Measuring it in place caused a Chinese
  tooltip at 375px to collapse to 63px wide and 1,183px tall.)
- Content is translated through `i18nHtml`, so tooltips are bilingual like
  everything else.

**Do not add a second tooltip mechanism.** A test asserts only one `.cb-tip`
element exists.

### Two kinds of tooltip

- **Concept** — on a column header: what this metric means.
- **Workings** — on the cell: how *this* number was produced, from live values.

```
’26 Operating requirement / yr
Break-even for one course delivery: 7.09 students over 8 months
Required pace: 7.09 ÷ 8 = 0.886 students/month
’26 requirement: 7.09 ÷ 8 × 12 = 10.63
Rounded up to a whole student = 11 students
```

Rule: the operands shown must actually produce the result shown. A fractional
figure is displayed to one decimal rather than rounded to a whole that no
longer divides correctly.

---

## 6. Charts

D3 v7, inlined. No second visualisation library.

- **Action matrix** — contribution against enrolment health, four quadrants,
  interactive.
- **Contribution bars**, **waterfall**, **bullet chart** for enrolment against
  requirement and break-even, **trend lines** across years.

Hard-won details:

- Chromium will not focus an SVG `<g>` even with `tabindex`. Put `tabindex`,
  `role` and `aria-label` on the `circle` or `rect` that is actually hit.
- `focus` does not bubble — use `focusin` / `focusout`.
- `.raise()` steals keyboard focus. Only raise on pointer hover.
- A waterfall needs a proper `[min, max]` domain; `v / max * 100` overflows on
  negative running totals.
- Never make `<thead>` sticky when the *page* scrolls rather than the table —
  it detaches the header.

Any chart that cannot plot something says so, names what it left out, and
states "relevant N · plotted M".

---

## 7. Language rules

| Instead of | Say |
|---|---|
| Minimum enrolment / minimum needed | **Operating requirement** |
| +7 above minimum / −9 below minimum | **7 above requirement** · **9 below requirement** · **Meets requirement** |
| Benefit-cost ratio (Simple) | **Full-cost coverage** |
| Contribution (Simple) | **After own costs** |
| Allocated overhead (Simple) | **Share of college costs** |

`CBA_TERM` is the single source: each entry holds the management label, the
finance term and the tooltip, so Simple and Advanced cannot drift apart.

Other standing rules:

- Never imply a class-opening rule. UCC uses rolling monthly intake, so an
  annual requirement is not a minimum class size.
- Always name the period: `’26 Operating requirement / yr`,
  `YTD operating req.`, `Operating req. (8 mo)`. `cbaYr2()` is the one year
  formatter — no screen hardcodes a year.
- Never say a course is "unsustainable" on a ratio alone. A course with
  positive contribution helps absorb central overhead even below 1.00×
  coverage; its overhead does not leave when it closes.
- No internal vocabulary on screen: not "live rows", "analysed subset",
  "activity population".

---

## 8. Visibility

A course **never disappears** because of the selected view, basis or filter.

- The switcher offers **Relevant courses (n)** and **All configured (n)**, with
  Analysis and Activity as separate filters.
- A course with Budget but no Actual reads *"No Actual enrolment"*, not a blank.
- An excluded course keeps its real enrolment, gains an "Excluded" badge, and
  shows N/A for analysis fields — never a fabricated zero.
- Any narrowing filter announces itself — *"Showing 8 of 36"* — with a
  clearable chip.
- There are no dismissable insights. Management attention is derived from the
  numbers every render; nothing can be hidden and forgotten.

---

## 9. Accessibility

- Every info icon: `role="button"`, `aria-label`, `tabindex="0"`, opens on
  focus, closes on Escape.
- Interactive chart marks are focusable and labelled.
- Status never by colour alone.
- Tooltips stay open long enough to read and never fall outside the viewport.
- `<title>` on truncated course names so the full name is always reachable.

---

## 10. Responsive

Verified at **1440 / 1280 / 768 / 375** in both languages, across every module
and tab.

- Wide tables scroll inside `overflow-x: auto`; **the page body never scrolls
  horizontally**.
- `minmax(0, 1fr)` grid columns, `flex-wrap` on every toolbar, no
  `flex-shrink: 0` on anything that must compress.
- Print CSS hides navigation, tabs, buttons, inputs and tooltips; the
  management report prints clean in whichever language is selected.

A smoke test walks 2 languages × 4 widths × 12 screens asserting zero overflow
and sub-400ms renders.

---

## 11. Adding to the interface

1. Render a pure `renderX(st, ...)` returning an HTML string; wire listeners in
   `bindXEvents()` afterwards.
2. Author **both** languages in the same change — `tf(en, zh, vars)` for
   anything with values in it, a dictionary phrase otherwise. Never English
   first.
3. Reuse `cbaInfo` for help. Reuse `CBA_TERM` for terminology. Reuse
   `cbaReqShown` / `cbaGapShown` for displayed figures.
4. Mark course names, user content and credentials `data-i18n-skip`.
5. Run `node cn.check.mjs` — it must report **0 distinct strings** — then the
   full suite.
6. If it renders a number, the arithmetic on screen must reconcile without
   hidden decimals.
