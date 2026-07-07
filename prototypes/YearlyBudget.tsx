import React, { useMemo, useState } from "react";

/* ────────────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────────────── */

type Category = "English" | "Preparatory" | "Business" | "Technology" | "Tourism & Hospitality";

interface Course {
  cat: Category;
  name: string;
  abbr: string;
  hrs: number;   // contact hours
  mo: number;    // duration in months
  app: number;   // application fee
  fee: number;   // course fee
  mat: number;   // material fee
  exam: number;  // exam/assignment fee
  admin: number; // admin fee
}

type IntakeKind = "budget" | "actual";

interface Intake {
  id: number;
  kind: IntakeKind;
  courseIdx: number;
  year: number;
  month: number;   // 0-11
  students: number;
}

/** Global simulation inputs — same ones used on the Course Simulator's Overview tab */
interface Assumptions {
  teacherRate: number;   // $/hr
  contactPct: number;    // % of contact hours actually delivered
  disc: number;          // scholarship discount %
  agent: number;         // agent commission % (on course fee)
  uni: number;           // university commission % (on course fee)
  overheadMonthly: number; // $/month fixed overhead
}

interface CourseEcon {
  totalCost: number;      // cost for one cohort run (teaching + overhead × duration)
  netPerStudent: number;  // net revenue recognised per enrolled student
  mo: number;
}

interface Period {
  label: string;
  revenue: number;
  cost: number;
  profit: number;
  newStudents: number;
}

type PeriodView = "monthly" | "quarterly" | "yearly" | "total";

/* ────────────────────────────────────────────────────────────────────────
   Data (trim of the full 35-course list — swap in the real one)
   ──────────────────────────────────────────────────────────────────────── */

const COURSES: Course[] = [
  { cat: "English", name: "Certificate in English Level 1 (FT)", abbr: "CEL1-FT", hrs: 96, mo: 3, app: 400, fee: 2480, mat: 100, exam: 100, admin: 150 },
  { cat: "English", name: "IELTS Preparatory Course", abbr: "IELTS", hrs: 396, mo: 6, app: 400, fee: 7040, mat: 400, exam: 100, admin: 150 },
  { cat: "Preparatory", name: "AEIS — Primary 4", abbr: "AEIS-P4", hrs: 792, mo: 6, app: 400, fee: 9500, mat: 300, exam: 300, admin: 150 },
  { cat: "Business", name: "Certificate in General Management", abbr: "CM", hrs: 160, mo: 6, app: 400, fee: 8120, mat: 200, exam: 200, admin: 150 },
  { cat: "Business", name: "Diploma in Business Management", abbr: "DBM", hrs: 320, mo: 8, app: 400, fee: 8400, mat: 300, exam: 300, admin: 150 },
  { cat: "Technology", name: "Diploma in Applied Artificial Intelligence", abbr: "DIPAI", hrs: 144, mo: 8, app: 400, fee: 9200, mat: 2500, exam: 600, admin: 600 },
  { cat: "Tourism & Hospitality", name: "Diploma in Tourism and Hospitality Management", abbr: "DTHM", hrs: 144, mo: 6, app: 400, fee: 6300, mat: 300, exam: 300, admin: 150 },
];

const CATEGORIES: Category[] = ["English", "Preparatory", "Business", "Technology", "Tourism & Hospitality"];
const CATEGORY_COLOR: Record<Category, string> = {
  English: "#3b82f6",
  Preparatory: "#7c3aed",
  Business: "#16a34a",
  Technology: "#d97706",
  "Tourism & Hospitality": "#dc2626",
};
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ────────────────────────────────────────────────────────────────────────
   Formatting helpers
   ──────────────────────────────────────────────────────────────────────── */

const sgd = (n: number): string => {
  const abs = "$" + Math.abs(Math.round(n)).toLocaleString();
  return n < 0 ? `(${abs})` : abs;
};
const pct = (n: number): string => (n * 100).toFixed(1) + "%";

/* ────────────────────────────────────────────────────────────────────────
   Economics — mirrors the Course Simulator's calc() formulas exactly,
   so a course's numbers here always match its Overview tab.
   ──────────────────────────────────────────────────────────────────────── */

function economicsFor(course: Course, a: Assumptions): CourseEcon {
  const totalFee = course.fee + course.mat + course.exam + course.admin;
  const otherFees = course.mat + course.exam + course.admin;
  const teachCost = a.teacherRate * course.hrs * (a.contactPct / 100);
  const fixedCost = a.overheadMonthly * course.mo;
  const totalCost = teachCost + fixedCost;
  const netPerStudent =
    totalFee * (1 - a.disc / 100) - course.fee * (a.agent / 100) - course.fee * (a.uni / 100) + course.app + otherFees;
  return { totalCost, netPerStudent, mo: course.mo };
}

/* ────────────────────────────────────────────────────────────────────────
   Ledger: allocate each intake's revenue/cost straight-line across its
   course duration, so overlapping cohorts (and courses that span a
   calendar-year boundary) stack correctly in any given month.
   ──────────────────────────────────────────────────────────────────────── */

type Ledger = Record<string, { revenue: number; cost: number; newStudents: number }>;

function buildLedger(intakes: Intake[], assumptions: Assumptions, categoryFilter: Category | "All", kind: IntakeKind): Ledger {
  const ledger: Ledger = {};
  const bucket = (key: string) => (ledger[key] ??= { revenue: 0, cost: 0, newStudents: 0 });

  for (const intake of intakes) {
    if (intake.kind !== kind) continue;
    const course = COURSES[intake.courseIdx];
    if (!course) continue;
    if (categoryFilter !== "All" && course.cat !== categoryFilter) continue;

    const econ = economicsFor(course, assumptions);
    const monthlyRevenue = (econ.netPerStudent * intake.students) / econ.mo;
    const monthlyCost = econ.totalCost / econ.mo;

    bucket(`${intake.year}-${intake.month}`).newStudents += intake.students;

    for (let offset = 0; offset < econ.mo; offset++) {
      const absoluteMonth = intake.year * 12 + intake.month + offset;
      const year = Math.floor(absoluteMonth / 12);
      const month = ((absoluteMonth % 12) + 12) % 12;
      const b = bucket(`${year}-${month}`);
      b.revenue += monthlyRevenue;
      b.cost += monthlyCost;
    }
  }
  return ledger;
}

function periodsFor(ledger: Ledger, view: PeriodView, year: number): Period[] {
  const withProfit = (revenue: number, cost: number, newStudents: number, label: string): Period => ({
    label,
    revenue,
    cost,
    newStudents,
    profit: revenue - cost,
  });

  if (view === "monthly") {
    return MONTH_NAMES.map((name, m) => {
      const b = ledger[`${year}-${m}`] ?? { revenue: 0, cost: 0, newStudents: 0 };
      return withProfit(b.revenue, b.cost, b.newStudents, name);
    });
  }

  if (view === "quarterly") {
    const quarters = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]];
    return quarters.map((months, qi) => {
      const agg = months.reduce(
        (acc, m) => {
          const b = ledger[`${year}-${m}`];
          if (b) { acc.revenue += b.revenue; acc.cost += b.cost; acc.newStudents += b.newStudents; }
          return acc;
        },
        { revenue: 0, cost: 0, newStudents: 0 }
      );
      return withProfit(agg.revenue, agg.cost, agg.newStudents, `Q${qi + 1}`);
    });
  }

  if (view === "yearly") {
    const years = [...new Set(Object.keys(ledger).map((k) => parseInt(k.split("-")[0])))].sort();
    return years.map((y) => {
      const agg = { revenue: 0, cost: 0, newStudents: 0 };
      for (let m = 0; m < 12; m++) {
        const b = ledger[`${y}-${m}`];
        if (b) { agg.revenue += b.revenue; agg.cost += b.cost; agg.newStudents += b.newStudents; }
      }
      return withProfit(agg.revenue, agg.cost, agg.newStudents, String(y));
    });
  }

  // total
  const agg = Object.values(ledger).reduce(
    (acc, b) => ({ revenue: acc.revenue + b.revenue, cost: acc.cost + b.cost, newStudents: acc.newStudents + b.newStudents }),
    { revenue: 0, cost: 0, newStudents: 0 }
  );
  return [withProfit(agg.revenue, agg.cost, agg.newStudents, "All-time")];
}

function sumPeriods(periods: Period[]) {
  return periods.reduce(
    (acc, p) => ({
      revenue: acc.revenue + p.revenue,
      cost: acc.cost + p.cost,
      profit: acc.profit + p.profit,
      newStudents: acc.newStudents + p.newStudents,
    }),
    { revenue: 0, cost: 0, profit: 0, newStudents: 0 }
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Presentational components
   ──────────────────────────────────────────────────────────────────────── */

function KpiCard({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-card-label">{label}</div>
      <div className="kpi-card-value" style={{ color }}>{value}</div>
      {sub && <div className="kpi-card-sub">{sub}</div>}
    </div>
  );
}

/** Grouped Budget-vs-Actual bar chart, one pair of bars per period. No chart library — plain SVG. */
function BudgetActualChart({ budget, actual }: { budget: Period[]; actual: Period[] }) {
  const width = 900;
  const height = 300;
  const margin = { top: 16, right: 16, bottom: 34, left: 70 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const maxAbs = Math.max(1, ...budget.map((p) => Math.abs(p.profit)), ...actual.map((p) => Math.abs(p.profit)));
  const groupW = innerW / Math.max(budget.length, 1);
  const barW = Math.min(26, groupW / 3);
  const yScale = (v: number) => innerH / 2 - (v / maxAbs) * (innerH / 2);
  const zeroY = yScale(0);

  return (
    <div className="chart-scroll">
      <svg width={width} height={height}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          <line x1={0} x2={innerW} y1={zeroY} y2={zeroY} stroke="var(--border-strong)" />
          {budget.map((bp, i) => {
            const ap = actual[i] ?? { profit: 0 } as Period;
            const cx = i * groupW + groupW / 2;
            const actualColor = ap.profit >= bp.profit ? "#16a34a" : "#dc2626";
            return (
              <g key={bp.label}>
                <rect
                  x={cx - barW - 3} y={bp.profit >= 0 ? yScale(bp.profit) : zeroY}
                  width={barW} height={Math.max(Math.abs(zeroY - yScale(bp.profit)), 1)}
                  fill="#2563eb" rx={2}
                >
                  <title>{`${bp.label} — Budget profit: ${sgd(bp.profit)}`}</title>
                </rect>
                <rect
                  x={cx + 3} y={ap.profit >= 0 ? yScale(ap.profit) : zeroY}
                  width={barW} height={Math.max(Math.abs(zeroY - yScale(ap.profit)), 1)}
                  fill={actualColor} rx={2}
                >
                  <title>{`${bp.label} — Actual profit: ${sgd(ap.profit)}`}</title>
                </rect>
                <text x={cx} y={innerH + 18} fontSize={10} fill="var(--text-muted)" textAnchor="middle">{bp.label}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function PeriodTable({ budget, actual }: { budget: Period[]; actual: Period[] }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Period</th>
          <th className="num">Budget profit</th>
          <th className="num">Actual profit</th>
          <th className="num">Variance</th>
        </tr>
      </thead>
      <tbody>
        {budget.map((bp, i) => {
          const ap = actual[i] ?? { profit: 0 } as Period;
          const variance = ap.profit - bp.profit;
          return (
            <tr key={bp.label}>
              <td className="strong">{bp.label}</td>
              <td className="num">{sgd(bp.profit)}</td>
              <td className="num">{sgd(ap.profit)}</td>
              <td className={"num strong " + (variance >= 0 ? "positive" : "negative")}>
                {variance >= 0 ? "+" : ""}{sgd(variance)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface CourseRollup {
  courseIdx: number;
  budgetStudents: number;
  actualStudents: number;
  budgetProfit: number;
  actualProfit: number;
}

function AnnualCourseTable({ rows }: { rows: CourseRollup[] }) {
  if (!rows.length) {
    return <div className="empty-state">No intakes for this year yet.</div>;
  }
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Course</th>
          <th className="num">Budget stu.</th>
          <th className="num">Actual stu.</th>
          <th className="num">Budget profit</th>
          <th className="num">Actual profit</th>
          <th className="num">Variance</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const course = COURSES[r.courseIdx];
          const variance = r.actualProfit - r.budgetProfit;
          return (
            <tr key={r.courseIdx}>
              <td>{course.abbr}</td>
              <td className="num">{r.budgetStudents}</td>
              <td className="num">{r.actualStudents}</td>
              <td className="num">{sgd(r.budgetProfit)}</td>
              <td className="num">{sgd(r.actualProfit)}</td>
              <td className={"num strong " + (variance >= 0 ? "positive" : "negative")}>
                {variance >= 0 ? "+" : ""}{sgd(variance)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function IntakeForm({
  form, onChange, onSubmit, kind,
}: {
  form: { courseIdx: number; month: number; year: number; students: number };
  onChange: (form: { courseIdx: number; month: number; year: number; students: number }) => void;
  onSubmit: () => void;
  kind: IntakeKind;
}) {
  return (
    <div className="intake-form">
      <select
        value={form.courseIdx}
        onChange={(e) => onChange({ ...form, courseIdx: parseInt(e.target.value) })}
      >
        {CATEGORIES.map((cat) => (
          <optgroup key={cat} label={cat}>
            {COURSES.map((c, i) => (c.cat === cat ? <option key={i} value={i}>{c.name}</option> : null))}
          </optgroup>
        ))}
      </select>
      <select value={form.month} onChange={(e) => onChange({ ...form, month: parseInt(e.target.value) })}>
        {MONTH_NAMES.map((m, i) => <option key={i} value={i}>{m}</option>)}
      </select>
      <input
        type="number" value={form.year} style={{ width: 70 }}
        onChange={(e) => onChange({ ...form, year: parseInt(e.target.value) || form.year })}
      />
      <input
        type="number" value={form.students} min={1} style={{ width: 70 }}
        onChange={(e) => onChange({ ...form, students: parseInt(e.target.value) || 1 })}
      />
      <button className={kind === "budget" ? "btn-primary" : "btn-success"} onClick={onSubmit}>
        + Add {kind}
      </button>
    </div>
  );
}

function IntakeList({ intakes, year, onRemove }: { intakes: Intake[]; year: number; onRemove: (id: number) => void }) {
  const filtered = intakes.filter((ik) => ik.year === year).sort((a, b) => a.month - b.month);
  if (!filtered.length) {
    return <div className="empty-state">None yet for {year}.</div>;
  }
  return (
    <table className="data-table">
      <thead>
        <tr><th>Course</th><th>Category</th><th>Start</th><th className="num">Students</th><th /></tr>
      </thead>
      <tbody>
        {filtered.map((ik) => {
          const c = COURSES[ik.courseIdx];
          return (
            <tr key={ik.id}>
              <td>{c.abbr}</td>
              <td><span className="badge" style={{ background: CATEGORY_COLOR[c.cat] + "22", color: CATEGORY_COLOR[c.cat] }}>{c.cat}</span></td>
              <td>{MONTH_NAMES[ik.month]} {ik.year}</td>
              <td className="num">{ik.students}</td>
              <td><button className="btn-delete" onClick={() => onRemove(ik.id)}>×</button></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Top-level module
   ──────────────────────────────────────────────────────────────────────── */

const DEFAULT_ASSUMPTIONS: Assumptions = {
  teacherRate: 70,
  contactPct: 100,
  disc: 0,
  agent: 40,
  uni: 0,
  overheadMonthly: 3350,
};

const currentYear = new Date().getFullYear();

export default function YearlyBudgetModule() {
  const [intakes, setIntakes] = useState<Intake[]>([]);
  const [assumptions] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const [view, setView] = useState<PeriodView>("monthly");
  const [year, setYear] = useState(currentYear);
  const [categoryFilter, setCategoryFilter] = useState<Category | "All">("All");
  const [form, setForm] = useState({ courseIdx: 0, month: 0, year: currentYear, students: 15 });

  const budgetLedger = useMemo(() => buildLedger(intakes, assumptions, categoryFilter, "budget"), [intakes, assumptions, categoryFilter]);
  const actualLedger = useMemo(() => buildLedger(intakes, assumptions, categoryFilter, "actual"), [intakes, assumptions, categoryFilter]);
  const budgetPeriods = useMemo(() => periodsFor(budgetLedger, view, year), [budgetLedger, view, year]);
  const actualPeriods = useMemo(() => periodsFor(actualLedger, view, year), [actualLedger, view, year]);

  const budgetTotal = sumPeriods(budgetPeriods);
  const actualTotal = sumPeriods(actualPeriods);
  const variance = actualTotal.profit - budgetTotal.profit;

  const courseRollup: CourseRollup[] = useMemo(() => {
    const byCourse = new Map<number, CourseRollup>();
    for (const ik of intakes) {
      if (ik.year !== year) continue;
      const course = COURSES[ik.courseIdx];
      if (!course) continue;
      if (categoryFilter !== "All" && course.cat !== categoryFilter) continue;
      const econ = economicsFor(course, assumptions);
      const profit = econ.netPerStudent * ik.students - econ.totalCost;
      const row = byCourse.get(ik.courseIdx) ?? { courseIdx: ik.courseIdx, budgetStudents: 0, actualStudents: 0, budgetProfit: 0, actualProfit: 0 };
      if (ik.kind === "budget") { row.budgetStudents += ik.students; row.budgetProfit += profit; }
      else { row.actualStudents += ik.students; row.actualProfit += profit; }
      byCourse.set(ik.courseIdx, row);
    }
    return [...byCourse.values()].sort((a, b) => b.budgetProfit - a.budgetProfit);
  }, [intakes, year, categoryFilter, assumptions]);

  function addIntake(kind: IntakeKind) {
    const nextId = Math.max(0, ...intakes.map((i) => i.id)) + 1;
    setIntakes([...intakes, { id: nextId, kind, ...form }]);
  }
  function removeIntake(id: number) {
    setIntakes(intakes.filter((i) => i.id !== id));
  }

  const availableYears = useMemo(() => {
    const years = new Set(intakes.map((i) => i.year));
    years.add(year);
    return [...years].sort();
  }, [intakes, year]);

  return (
    <div className="yearly-budget">
      <p className="callout">
        <strong>Budget</strong> = the plan you set for the year (target intakes/students per course).{" "}
        <strong>Actual</strong> = what really happened, logged as it comes in. Each intake's revenue/cost is
        recognised straight-line across its course's duration, using the same global inputs (teacher rate,
        discount, commissions, overhead) as the Course Simulator.
      </p>

      <div className="kpi-grid">
        <KpiCard label="Budgeted profit" value={sgd(budgetTotal.profit)} color="var(--text-accent)" sub={`${view} view · ${budgetTotal.newStudents} budgeted students`} />
        <KpiCard label="Actual profit" value={sgd(actualTotal.profit)} color={actualTotal.profit >= 0 ? "var(--text-success)" : "var(--text-danger)"} sub={`${actualTotal.newStudents} actual students`} />
        <KpiCard label="Variance" value={(variance >= 0 ? "+" : "") + sgd(variance)} color={variance >= 0 ? "var(--text-success)" : "var(--text-danger)"} sub={variance >= 0 ? "ahead of budget" : "behind budget"} />
        <KpiCard label="Budgeted revenue" value={sgd(budgetTotal.revenue)} sub={`vs actual ${sgd(actualTotal.revenue)}`} />
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="segmented">
            {(["monthly", "quarterly", "yearly", "total"] as PeriodView[]).map((v) => (
              <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <div className="filters">
            <select value={year} onChange={(e) => setYear(parseInt(e.target.value))}>
              {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as Category | "All")}>
              <option value="All">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="legend">
          <span><i style={{ background: "#2563eb" }} /> Budget</span>
          <span><i style={{ background: "#16a34a" }} /> Actual (ahead)</span>
          <span><i style={{ background: "#dc2626" }} /> Actual (behind)</span>
        </div>
        <BudgetActualChart budget={budgetPeriods} actual={actualPeriods} />
        <PeriodTable budget={budgetPeriods} actual={actualPeriods} />
      </div>

      <div className="card">
        <h3>Annual plan per course — {year}</h3>
        <AnnualCourseTable rows={courseRollup} />
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Budgeted intakes (the plan)</h3>
          <IntakeForm form={form} onChange={setForm} onSubmit={() => addIntake("budget")} kind="budget" />
          <IntakeList intakes={intakes.filter((i) => i.kind === "budget")} year={year} onRemove={removeIntake} />
        </div>
        <div className="card">
          <h3>Actual intakes (recorded)</h3>
          <IntakeForm form={form} onChange={setForm} onSubmit={() => addIntake("actual")} kind="actual" />
          <IntakeList intakes={intakes.filter((i) => i.kind === "actual")} year={year} onRemove={removeIntake} />
        </div>
      </div>
    </div>
  );
}
