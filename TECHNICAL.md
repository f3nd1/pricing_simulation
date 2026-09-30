# UCC Planning Suite — Technical Reference

`ucc_budget_simulator.html` · v1.85.0 · ~8,700 lines · ~300 functions

A financial planning application for **United Ceres College**, a private
education institution in Singapore. One self-contained HTML file: no build
step, no bundler, no package manager, no server-side code. D3.js v7.9.0 is
inlined at the top of the file; nothing else is loaded from the network.

---

## 1. Why one file

The application is edited and deployed by people who do not run a toolchain.
A single file can be copied, emailed, opened from disk, served by any static
host, and version-controlled as one artefact. The cost is a large file and a
grep-unfriendly first 200 lines (the minified D3 blob) — both accepted
deliberately.

Deployment is `git pull` on a DigitalOcean droplet (`/var/www/pricing_simulation`)
plus a `gh-pages` mirror. `mkver.py` stamps `APP_VERSION`/`APP_BUILD` and
rebuilds `APP_CHANGELOG` from git history.

---

## 2. Architecture

```
ST                     one mutable state object
render()               dispatches on ST.module, returns HTML, then i18nApply()
bind*Events()          per-module event wiring, re-run after every render
saveToStorage()        whitelisted serialisation to localStorage
buildFullSnapshot()    whitelisted serialisation for Supabase cloud save
```

Rendering is full-page string templating on every state change. There is no
virtual DOM and no component framework. Every module follows the same shape:
a pure `renderX(st, ...)` returning HTML, and a `bindXEvents()` attaching
listeners to the freshly written DOM.

**Consequence to remember:** any new persisted state must be added to *three*
whitelists — `saveToStorage`, `loadFromStorage`, and the cloud-save snapshot.
Forgetting one produces state that survives a re-render but not a reload.

### Modules

| Key | Module | Purpose |
|---|---|---|
| `simulator` | Course Simulator | Single-course pricing, cost and break-even |
| `yearlybudget` | Yearly Budget | Budget vs actual intakes, per course per month |
| `forecast` | Forecast & P&L | Five-year revenue, expenses, income statement |
| `operating` | Operating Detail | Manpower FTE, break-even, competitor pricing |
| `financials` | Valuation & Statements | DCF, ratios, GST and tax |
| `strategy` | Strategy & Governance | Business cases, compliance scorecard |
| `cba` | Cost-Benefit | Course economics against college-wide costs |
| `simmaster` | Simulator Inputs | Every course's assumptions in one sheet |
| `log` | Change Log | User edit history plus app version history |

---

## 3. Canonical data

`COURSES` (~line 406) is the **single course registry**. `DEFAULTS` is only a
reset snapshot of it. Courses are addressed positionally by `ci` (array index)
in Yearly Budget intake records — an accepted constraint, not a bug; migrating
to stable IDs would break every stored intake and has been deliberately
deferred.

```js
COURSES[ci] = { cat, name, abbr, hrs, mo, app, fee, mat, exam, admin }
```

Course names and abbreviations are **canonical master data**. They are never
translated, never rewritten, and are protected inside the i18n layer by
`i18nProtected()`.

### Assumption resolution order

Cost-Benefit reads each course's economics through `cbaRate(st, c, key)`:

```
ST.cba.rates[courseName][key]   per-course Cost-Benefit override
ST.cba.def[key]                 all-courses Cost-Benefit override
ST.sim[courseName][simField]    the course's saved Course Simulator values
SIM_DEFAULTS[...]               fallback
```

The flat `ST.tf` / `ST.agent` / `ST.disc` / `ST.uni` fields are the *working
copy* of the currently selected course only. They are flushed into
`ST.sim[courseName]` by `simSaveCurrent()`, which `saveToStorage()` calls on
every edit — so a Course Simulator change reaches Cost-Benefit immediately.
The one thing that blocks it is a Cost-Benefit override higher in the chain;
the Course Simulator now warns when one is masking the course.

---

## 4. The accounting model (locked)

```
gross fee revenue − scholarship discount            = net revenue
agent commission + university commission + teaching = direct cost
net revenue − direct cost                           = contribution
direct cost + allocated overhead                    = full cost
net revenue / full cost                             = BCR
(net revenue − full cost) / full cost               = ROI
```

Institution BCR comes from **consolidated totals**, never from averaging
per-course ratios.

### Where each cost comes from

| Component | Source |
|---|---|
| Teaching, agent, university commission | Recalculated per course from Yearly Budget enrolment × Course Simulator assumptions |
| Central overhead | `fcExpenses(st).opexTot[yearIndex]` — Forecast → Expenses total OPEX |
| Forecast COGS | **Deliberately excluded** |

```js
const direct = live.reduce((a,r) => a + r.direct, 0);
const cost   = direct + pool;          // pool is never scaled away
```

Forecast COGS is excluded because its agent-commission and academic-salary
lines are the *same money* Cost-Benefit already computes per course. Adding it
would double count. This is verified continuously: raising any Forecast COGS
line by $1,000 moves the Forecast P&L by $1,000 and Cost-Benefit by exactly $0.

`cbaAcadSplit` handles the mirror problem on the OPEX side: a configurable
percentage of the "Permanent Staff" line is deducted from the overhead pool,
because that line blends academic pay already costed as teaching.

**Forecast Total Expenses ≠ Cost-Benefit full cost, by design.** Forecast is
the accounting expense model on budget assumptions; Cost-Benefit recalculates
direct costs from the selected basis and adds central OPEX. Both screens now
say so.

### Allocation invariance

Changing the overhead driver (`hours` / `months` / `revenue`) moves per-course
ratios but never institution totals. This is an invariant with a test.

---

## 5. The rolling-intake model

UCC enrols continuously rather than in discrete cohorts, so a course's
break-even is expressed as a required enrolment *pace*:

```js
cbaRolling(st, c):
  monthlyCost = teachCost / mo + fixedMonthly
  pace        = monthlyCost / netPerStudent      // students per month
  beExact     = totalCost / netPerStudent        // === pace × mo
```

Evaluated over exactly one course duration this returns the Course Simulator's
own unrounded break-even — the reconciliation is exact by construction, not by
coincidence.

The period requirement is then `pace × cbaPeriodMonths(st, yr, basis)`, where
the period is **the months the data actually spans on that basis** — not a
hardcoded 12. A budget concentrated in January gives a one-month period; an
actual basis through August gives eight. Every label names the period it used.

```
Course Simulator                Cost-Benefit
7.09 students / 8 months   →    0.886 / month   →   × 12 = 10.63   →   11
```

### Display rounding

`reqPeriod` stays unrounded in every calculation. Exactly one integer is shown:

```js
cbaReqShown(r) = Math.ceil(r.reqPeriod)
cbaGapShown(r) = r.students - cbaReqShown(r)
```

Both the cell and its gap derive from that same integer, so the on-screen
arithmetic always reconciles. (An earlier version showed `ceil()` for the
target and `round()` for the gap, producing "24 students, 17 required, +8" —
18 of 36 courses were affected.)

---

## 6. Three orthogonal course states

Collapsing these into one flag was the cause of a long-running data-flow bug,
so they are kept strictly separate:

| State | Meaning | Source |
|---|---|---|
| **configured** | exists in `COURSES` | the registry |
| **has activity** | Yearly Budget students > 0 for this year+basis | a **fact** |
| **included** | management chose to analyse it | `ST.cba.off` — a **choice** |

`relevant` = Budget > 0 **or** Actual > 0 for the year, independent of basis
and of inclusion. An excluded course keeps its real enrolment on screen with
an "Excluded" badge and N/A analysis fields; it never reads as zero, and it
never silently leaves the visible population. The money population is `live`
(included **and** has activity) and is the only denominator.

---

## 7. Scenario engine

One engine, one set of formulas. Every what-if runs through `cbaCompute` with
an overlay rather than a parallel calculation:

```js
cbaCompute(st, basisOverride, yearOverride, { rows: { [ci]: { students, fee, comm, ... } } })
```

Built on that:

| Function | Answers |
|---|---|
| `cbaMarginal` | contribution of one more student = `Scenario(N+1) − Scenario(N)` |
| `cbaSolveCourseBE` | lowest N where one course covers direct + allocated overhead |
| `cbaSolveUcc` | lowest **total** enrolment where the institution covers full cost |
| `cbaMixWeights` | how a total is distributed across courses |
| `cbaAllocate` | largest-remainder split into whole students summing exactly to the total |

`cbaSolveUcc` brackets exponentially, binary-searches, then walks back over the
saw-tooth that class-size steps create. It explicitly does **not** use average
revenue per student, average BCR, average contribution, or a sum of per-course
break-evens — because `classes = ceil(students / classSize)` makes teaching a
step function and the overhead driver re-allocates as enrolment moves.

There is no universal UCC break-even number: it depends on the course mix, and
the four mixes solve to four different totals. Solvers are memoised per render
(`cbaSolveCacheClear()` runs at the top of `render()`), which took the Advanced
Portfolio from 2,241ms to 79ms.

All scenario state is a sandbox. Nothing writes back to Yearly Budget, Price
List, Forecast or Course Simulator without an explicit Apply action.

---

## 8. Internationalisation

English and Simplified Chinese, via a **post-render DOM pass** rather than
~3,000 `t()` call sites:

```js
render()  →  render_()  →  i18nApply(document.getElementById("app"))
```

`i18nApply` walks text nodes plus `title` / `placeholder` / `aria-label` /
`data-tip` / `<option>`, and translates each through `i18nStr`:

```
exact phrase match  →  regex pattern  →  affix-tolerant match  →  English fallback
```

- **1,092 phrases**, **225 regex patterns** for generated sentences.
- `tf(en, zh, vars)` for structured templates, so Chinese word order is authored
  rather than stitched from translated fragments.
- `data-i18n-skip` marks subtrees that must never be translated: course names,
  user-entered content, git commit text, credential placeholders.
- English is the automatic fallback, so a missing translation degrades to
  readable English rather than breaking.

Currency, numbers and dates are never converted. Course names never translated.

---

## 9. Persistence

- **localStorage** `ucc_sim_v4`, plus `ucc_lang` and `ucc_auth`. The session
  in `ucc_auth` is deliberately **not** in `ST` and **not** in any of the three
  persistence whitelists — on `ST` it would flow into `buildFullSnapshot` and
  upload the signed-in user's access token into `ucc_saves`.
- **Supabase** REST cloud save (`buildFullSnapshot` / `applyFullSnapshot`).
  The publishable key is public by design; access is enforced by RLS policies
  on `ucc_saves`, all four gated on the shared `is_allowed_user()`, which
  requires a `unitedceres.edu.sg` address **and** a row in `allowed_users`.
- **Access gate**: Google sign-in against the Supabase auth REST endpoints,
  no SDK. It gates application entry on a live session **whose email is on
  `unitedceres.edu.sg`**, and the same session authorises every cloud call.
  The domain check exists so the gate matches its own on-screen text; it is
  not what keeps data safe. It is **not** enforcement — the file is served to anyone who
  requests the URL, and a forged session in localStorage satisfies every
  client-side check. Enforcement of the saved data is the RLS policies;
  enforcement of the page would have to happen at the edge.
  Because OAuth cannot redirect to origin `null`, the app **cannot be opened
  from `file://`** any more; the gate says so instead of showing a dead
  button. The suites work around this by writing a forged `ucc_auth`, which is
  sound precisely because the client gate is not a security boundary.
  If sign-in ever breaks, everyone is locked out of the whole application.
  There is deliberately **no bypass in the file** — a backdoor would be a
  shared secret in public source, which is what the passcode gate was
  removed for. The three recoveries (fix the redirect URL, revert the
  deploy, write a session from the browser console) are written out in a
  comment above the gate block.
- Migrations live in `sql/`. They run **around** a deploy, not with it:
  `01` (additive, before the code) then `02` (the atomic cutover, after the
  new path is verified in a browser).

---

## 10. Testing

25 Playwright suites, run directly against `file://` (`auth` serves over
local HTTP, because `file://` cannot complete an OAuth redirect) — no test framework, no
fixtures directory, no CI config. Each is a standalone `.mjs` that prints
PASS/FAIL lines and exits non-zero on failure.

```bash
for f in *.check.mjs; do node "$f"; done
```

| Suite | Guards |
|---|---|
| `cba` | accounting invariants, allocation invariance |
| `source` | Forecast ↔ Cost-Benefit cost reconciliation, no double counting |
| `opreq` | break-even → pace → period chain, rounding, tooltip arithmetic |
| `plan` | course and institution break-even solvers, mix allocation |
| `flow`, `connect`, `legacy` | Yearly Budget → dependent modules, against **replayed legacy localStorage** |
| `visible`, `scope` | course visibility vs analysis inclusion |
| `i18n`, `cn` | translation coverage; `cn` walks every rendered tab and reports untranslated Latin text |
| `help` | contextual help in both languages, keyboard, popover clipping |
| `ux`, `walk` | rendered-DOM journeys, chart interaction, print |

Two rules earned the hard way:

1. **Clean fixtures hide real bugs.** `legacy.check.mjs` replays real persisted
   state; it found two defects that every clean-fixture test passed.
2. **Card titles are uppercased by CSS**, so case-sensitive `innerText.includes()`
   gives false negatives. Always use case-insensitive regex.

---

## 11. Conventions

- Financial formulas are **locked**. Change them only with explicit approval.
- `COURSES` positional `ci` indices, the Cloud Save schema and the Yearly Budget
  storage format are **not** to be migrated without a deliberate decision.
- New user-facing strings ship with their Simplified Chinese translation in the
  **same** change, never "English first, Chinese later".
- Prefer extending an existing helper to adding a parallel one; the recurring
  failure mode in this codebase is two functions computing the same number
  slightly differently.
