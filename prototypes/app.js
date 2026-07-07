const h = React.createElement;
const { useState, useMemo } = React;

/* ---------- Data (subset of the main COURSES table for the prototype) ---------- */
const COURSES = [
  {cat:"English",name:"Certificate in English Level 1 (FT)",abbr:"CEL1-FT",hrs:96,mo:3,app:400,fee:2480,mat:100,exam:100,admin:150},
  {cat:"English",name:"IELTS Preparatory Course",abbr:"IELTS",hrs:396,mo:6,app:400,fee:7040,mat:400,exam:100,admin:150},
  {cat:"Preparatory",name:"AEIS — Primary 4",abbr:"AEIS-P4",hrs:792,mo:6,app:400,fee:9500,mat:300,exam:300,admin:150},
  {cat:"Preparatory",name:"GCE O-Level Preparatory",abbr:"O-LVL",hrs:1440,mo:24,app:400,fee:36950,mat:3400,exam:1200,admin:800},
  {cat:"Business",name:"Certificate in General Management",abbr:"CM",hrs:160,mo:6,app:400,fee:8120,mat:200,exam:200,admin:150},
  {cat:"Business",name:"Diploma in Business Management",abbr:"DBM",hrs:320,mo:8,app:400,fee:8400,mat:300,exam:300,admin:150},
  {cat:"Business",name:"Postgraduate Diploma in Business Administration",abbr:"PGD",hrs:480,mo:8,app:400,fee:13600,mat:400,exam:400,admin:150},
  {cat:"Technology",name:"Diploma in Applied Artificial Intelligence",abbr:"DIPAI",hrs:144,mo:8,app:400,fee:9200,mat:2500,exam:600,admin:600},
  {cat:"Tourism & Hospitality",name:"Diploma in Tourism and Hospitality Management",abbr:"DTHM",hrs:144,mo:6,app:400,fee:6300,mat:300,exam:300,admin:150},
];
const CATS = ["English","Preparatory","Business","Technology","Tourism & Hospitality"];
const CAT_COLOR = {English:"#3b82f6",Preparatory:"#7c3aed",Business:"#16a34a",Technology:"#d97706","Tourism & Hospitality":"#dc2626"};
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const sgd = n => { const a = Math.abs(Math.round(n)); const s = "$" + a.toLocaleString(); return n < 0 ? "(" + s + ")" : s; };
const fp = n => (n * 100).toFixed(1) + "%";

/* ---------- Economics (mirrors the single-course simulator's formulas) ---------- */
function computeEcon(course, a) {
  const totalFee = course.fee + course.mat + course.exam + course.admin;
  const otherFees = course.mat + course.exam + course.admin;
  const teachCost = a.teacherRate * course.hrs * (a.contactPct / 100);
  const fixedCost = a.overheadMonthly * course.mo;
  const totalCost = teachCost + fixedCost;
  const netPerStudent = totalFee * (1 - a.disc / 100) - course.fee * (a.agent / 100) - course.fee * (a.uni / 100) + course.app + otherFees;
  return { totalCost, netPerStudent, mo: course.mo, totalFee };
}

/* ---------- Sample seed intakes across two years ---------- */
function seedIntakes() {
  return [
    { id: 1, courseIdx: 0, year: 2025, month: 0, students: 18 },
    { id: 2, courseIdx: 0, year: 2025, month: 3, students: 22 },
    { id: 3, courseIdx: 0, year: 2025, month: 6, students: 15 },
    { id: 4, courseIdx: 0, year: 2025, month: 9, students: 20 },
    { id: 5, courseIdx: 1, year: 2025, month: 1, students: 25 },
    { id: 6, courseIdx: 1, year: 2025, month: 7, students: 30 },
    { id: 7, courseIdx: 2, year: 2025, month: 0, students: 12 },
    { id: 8, courseIdx: 2, year: 2025, month: 6, students: 14 },
    { id: 9, courseIdx: 3, year: 2024, month: 0, students: 10 },
    { id: 10, courseIdx: 4, year: 2025, month: 2, students: 9 },
    { id: 11, courseIdx: 4, year: 2025, month: 8, students: 11 },
    { id: 12, courseIdx: 5, year: 2025, month: 1, students: 8 },
    { id: 13, courseIdx: 5, year: 2025, month: 9, students: 13 },
    { id: 14, courseIdx: 6, year: 2025, month: 4, students: 7 },
    { id: 15, courseIdx: 7, year: 2025, month: 2, students: 12 },
    { id: 16, courseIdx: 7, year: 2025, month: 10, students: 9 },
    { id: 17, courseIdx: 8, year: 2025, month: 5, students: 16 },
    { id: 18, courseIdx: 0, year: 2026, month: 0, students: 24 },
    { id: 19, courseIdx: 1, year: 2026, month: 1, students: 28 },
    { id: 20, courseIdx: 4, year: 2026, month: 2, students: 10 },
  ];
}

/* ---------- Aggregation: allocate each intake's revenue/cost straight-line over its duration ---------- */
function buildMonthlyLedger(intakes, assumptions, catFilter) {
  const ledger = {}; // key "Y-M" -> {revenue, cost, newStudents}
  const ensure = key => { if (!ledger[key]) ledger[key] = { revenue: 0, cost: 0, newStudents: 0 }; return ledger[key]; };
  intakes.forEach(ik => {
    const course = COURSES[ik.courseIdx];
    if (catFilter !== "All" && course.cat !== catFilter) return;
    const econ = computeEcon(course, assumptions);
    const monthlyRev = (econ.netPerStudent * ik.students) / econ.mo;
    const monthlyCost = econ.totalCost / econ.mo;
    ensure(`${ik.year}-${ik.month}`).newStudents += ik.students;
    for (let k = 0; k < econ.mo; k++) {
      const totalMonthIdx = ik.year * 12 + ik.month + k;
      const y = Math.floor(totalMonthIdx / 12), m = ((totalMonthIdx % 12) + 12) % 12;
      const bucket = ensure(`${y}-${m}`);
      bucket.revenue += monthlyRev;
      bucket.cost += monthlyCost;
    }
  });
  return ledger;
}

function periodsForView(ledger, view, year) {
  const keys = Object.keys(ledger);
  if (!keys.length) return [];
  if (view === "monthly") {
    return MONTH_NAMES.map((name, m) => {
      const b = ledger[`${year}-${m}`] || { revenue: 0, cost: 0, newStudents: 0 };
      return { label: name, ...b, profit: b.revenue - b.cost };
    });
  }
  if (view === "quarterly") {
    const qs = [[0,1,2],[3,4,5],[6,7,8],[9,10,11]];
    return qs.map((months, qi) => {
      const agg = months.reduce((acc, m) => {
        const b = ledger[`${year}-${m}`] || { revenue: 0, cost: 0, newStudents: 0 };
        acc.revenue += b.revenue; acc.cost += b.cost; acc.newStudents += b.newStudents;
        return acc;
      }, { revenue: 0, cost: 0, newStudents: 0 });
      return { label: "Q" + (qi + 1), ...agg, profit: agg.revenue - agg.cost };
    });
  }
  if (view === "yearly") {
    const years = [...new Set(keys.map(k => parseInt(k.split("-")[0])))].sort();
    return years.map(y => {
      const agg = { revenue: 0, cost: 0, newStudents: 0 };
      for (let m = 0; m < 12; m++) {
        const b = ledger[`${y}-${m}`];
        if (b) { agg.revenue += b.revenue; agg.cost += b.cost; agg.newStudents += b.newStudents; }
      }
      return { label: String(y), ...agg, profit: agg.revenue - agg.cost };
    });
  }
  // total
  const agg = keys.reduce((acc, k) => {
    const b = ledger[k];
    acc.revenue += b.revenue; acc.cost += b.cost; acc.newStudents += b.newStudents;
    return acc;
  }, { revenue: 0, cost: 0, newStudents: 0 });
  return [{ label: "All-time", ...agg, profit: agg.revenue - agg.cost }];
}

/* ---------- Simple SVG grouped bar chart (no external chart lib) ---------- */
function BarChart({ data }) {
  const width = 900, height = 300, margin = { top: 16, right: 16, bottom: 34, left: 64 };
  const innerW = width - margin.left - margin.right, innerH = height - margin.top - margin.bottom;
  const maxAbs = Math.max(1, ...data.flatMap(d => [d.revenue, d.cost, Math.abs(d.profit)]));
  const groupW = innerW / Math.max(data.length, 1);
  const barW = Math.min(20, groupW / 4.2);
  const yScale = v => innerH - (v / maxAbs) * innerH;
  const bars = [];
  data.forEach((d, i) => {
    const gx = i * groupW + groupW / 2;
    const series = [
      { v: d.revenue, color: "#2563eb", dx: -barW * 1.1 },
      { v: d.cost, color: "#94a3b8", dx: 0 },
      { v: d.profit, color: d.profit >= 0 ? "#16a34a" : "#dc2626", dx: barW * 1.1 },
    ];
    series.forEach(s => {
      const y0 = yScale(0), y1 = yScale(Math.max(s.v, 0));
      const yNeg1 = yScale(Math.min(s.v, 0));
      const barY = s.v >= 0 ? y1 : y0;
      const barH = Math.abs(y0 - (s.v >= 0 ? y1 : yNeg1));
      bars.push(h("rect", { key: i + s.color + s.dx, x: gx + s.dx - barW / 2, y: barY, width: barW, height: Math.max(barH, 1), fill: s.color, rx: 2 }));
    });
  });
  const zeroY = yScale(0);
  return h("div", { className: "chart-wrap" },
    h("svg", { width, height },
      h("g", { transform: `translate(${margin.left},${margin.top})` },
        h("line", { x1: 0, x2: innerW, y1: zeroY, y2: zeroY, stroke: "var(--border-strong)" }),
        ...bars,
        ...data.map((d, i) => h("text", {
          key: "lbl" + i, x: i * groupW + groupW / 2, y: innerH + 18,
          fontSize: 10, fill: "var(--text-muted)", textAnchor: "middle"
        }, d.label)),
        ...[0, 0.25, 0.5, 0.75, 1].map(t => h("text", {
          key: "y" + t, x: -8, y: yScale(maxAbs * t), fontSize: 9, fill: "var(--text-muted)", textAnchor: "end", dy: 3
        }, "$" + Math.round(maxAbs * t / 1000) + "k"))
      )
    )
  );
}

/* ---------- App ---------- */
function App() {
  const [intakes, setIntakes] = useState(seedIntakes());
  const [assumptions, setAssumptions] = useState({ teacherRate: 70, contactPct: 100, disc: 0, agent: 40, uni: 0, overheadMonthly: 3350 });
  const [view, setView] = useState("monthly");
  const [year, setYear] = useState(2025);
  const [catFilter, setCatFilter] = useState("All");
  const [form, setForm] = useState({ courseIdx: 0, year: 2025, month: 0, students: 15 });

  const ledger = useMemo(() => buildMonthlyLedger(intakes, assumptions, catFilter), [intakes, assumptions, catFilter]);
  const availableYears = useMemo(() => {
    const ys = [...new Set(intakes.map(i => i.year))];
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) if (!ys.includes(y)) ys.push(y);
    return ys.sort();
  }, [intakes]);
  const periods = useMemo(() => periodsForView(ledger, view, year), [ledger, view, year]);
  const totals = periods.reduce((a, p) => ({ revenue: a.revenue + p.revenue, cost: a.cost + p.cost, profit: a.profit + p.profit, newStudents: a.newStudents + p.newStudents }), { revenue: 0, cost: 0, profit: 0, newStudents: 0 });
  const margin = totals.revenue > 0 ? totals.profit / totals.revenue : 0;

  function addIntake() {
    const nextId = Math.max(0, ...intakes.map(i => i.id)) + 1;
    setIntakes([...intakes, { id: nextId, ...form }]);
  }
  function removeIntake(id) { setIntakes(intakes.filter(i => i.id !== id)); }

  return h("div", null,
    h("div", { className: "hdr" },
      h("div", { className: "hdr-label" }, "United Ceres College — Prototype"),
      h("div", { className: "hdr-title" }, "Portfolio Performance Dashboard"),
      h("div", { className: "hdr-sub" }, "Monthly / Quarterly / Yearly / Total view across all course intakes")
    ),
    h("div", { className: "body" },

      h("div", { className: "note" },
        h("strong", null, "Prototype scope: "),
        "revenue and cost per course run are recognised straight-line across each intake's duration (e.g. a 6-month course's revenue/cost is spread evenly over those 6 months), so overlapping cohorts stack correctly in any given month/quarter/year. This is an accrual view — a cash view (recognise everything at enrolment) can be added as a toggle in the full build. Global assumptions (teacher rate, discount, commissions, overhead) currently apply to all courses uniformly; production would reuse each course's saved price-list values."
      ),

      h("div", { className: "card" },
        h("div", { className: "card-title" }, "Global assumptions (applies to all courses in this prototype)"),
        h("div", { className: "formrow" },
          numField("Teacher $/hr", assumptions.teacherRate, v => setAssumptions({ ...assumptions, teacherRate: v })),
          numField("Contact hrs %", assumptions.contactPct, v => setAssumptions({ ...assumptions, contactPct: v })),
          numField("Discount %", assumptions.disc, v => setAssumptions({ ...assumptions, disc: v })),
          numField("Agent comm %", assumptions.agent, v => setAssumptions({ ...assumptions, agent: v })),
          numField("Uni comm %", assumptions.uni, v => setAssumptions({ ...assumptions, uni: v })),
          numField("Overhead $/mo", assumptions.overheadMonthly, v => setAssumptions({ ...assumptions, overheadMonthly: v }))
        )
      ),

      h("div", { className: "g4" },
        kpi("Total revenue", sgd(totals.revenue), "var(--text-accent)", `${view} view`),
        kpi("Total cost", sgd(totals.cost), "var(--text-danger)", ""),
        kpi("Total profit", sgd(totals.profit), totals.profit >= 0 ? "var(--text-success)" : "var(--text-danger)", fp(margin) + " margin"),
        kpi("New enrolments", totals.newStudents + " students", "var(--text-primary)", "in scope")
      ),

      h("div", { className: "card" },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 } },
          h("div", { className: "tabs", style: { marginBottom: 0, border: "none" } },
            ["monthly", "quarterly", "yearly", "total"].map(v =>
              h("button", { key: v, className: "tab" + (view === v ? " on" : ""), onClick: () => setView(v) }, v[0].toUpperCase() + v.slice(1))
            )
          ),
          h("div", { className: "controls", style: { marginBottom: 0 } },
            (view === "monthly" || view === "quarterly") ? h("select", { value: year, onChange: e => setYear(parseInt(e.target.value)) },
              availableYears.map(y => h("option", { key: y, value: y }, y))
            ) : null,
            h("select", { value: catFilter, onChange: e => setCatFilter(e.target.value) },
              h("option", { value: "All" }, "All categories"),
              CATS.map(c => h("option", { key: c, value: c }, c))
            )
          )
        ),
        h("div", { className: "legend" },
          h("div", null, h("span", { className: "sw", style: { background: "#2563eb" } }), "Revenue"),
          h("div", null, h("span", { className: "sw", style: { background: "#94a3b8" } }), "Cost"),
          h("div", null, h("span", { className: "sw", style: { background: "#16a34a" } }), "Profit"),
          h("div", null, h("span", { className: "sw", style: { background: "#dc2626" } }), "Loss")
        ),
        h(BarChart, { data: periods }),
        h("table", { style: { marginTop: 10 } },
          h("thead", null, h("tr", null,
            h("th", null, "Period"), h("th", { style: { textAlign: "right" } }, "Revenue"),
            h("th", { style: { textAlign: "right" } }, "Cost"), h("th", { style: { textAlign: "right" } }, "Profit"),
            h("th", { style: { textAlign: "right" } }, "Margin"), h("th", { style: { textAlign: "right" } }, "New students")
          )),
          h("tbody", null, periods.map((p, i) => h("tr", { key: i },
            h("td", null, p.label),
            h("td", { style: { textAlign: "right" } }, sgd(p.revenue)),
            h("td", { style: { textAlign: "right", color: "var(--text-muted)" } }, sgd(p.cost)),
            h("td", { style: { textAlign: "right", fontWeight: 700, color: p.profit >= 0 ? "var(--text-success)" : "var(--text-danger)" } }, sgd(p.profit)),
            h("td", { style: { textAlign: "right" } }, p.revenue > 0 ? fp(p.profit / p.revenue) : "—"),
            h("td", { style: { textAlign: "right" } }, p.newStudents)
          )))
        )
      ),

      h("div", { className: "card" },
        h("div", { className: "card-title" }, "Course intakes (add / remove cohorts)"),
        h("div", { className: "formrow", style: { marginBottom: 12 } },
          h("select", { value: form.courseIdx, onChange: e => setForm({ ...form, courseIdx: parseInt(e.target.value) }) },
            CATS.map(cat => h("optgroup", { key: cat, label: cat },
              COURSES.map((c, i) => c.cat === cat ? h("option", { key: i, value: i }, c.name) : null)
            ))
          ),
          h("select", { value: form.month, onChange: e => setForm({ ...form, month: parseInt(e.target.value) }) },
            MONTH_NAMES.map((m, i) => h("option", { key: i, value: i }, m))
          ),
          h("input", { type: "number", value: form.year, style: { width: 70 }, onChange: e => setForm({ ...form, year: parseInt(e.target.value) || 2025 }) }),
          h("input", { type: "number", value: form.students, style: { width: 70 }, min: 1, onChange: e => setForm({ ...form, students: parseInt(e.target.value) || 1 }) }),
          h("button", { className: "primary", onClick: addIntake }, "+ Add intake"),
          h("button", { onClick: () => setIntakes(seedIntakes()) }, "Reset sample data")
        ),
        h("table", null,
          h("thead", null, h("tr", null,
            h("th", null, "Course"), h("th", null, "Category"), h("th", null, "Start"),
            h("th", { style: { textAlign: "right" } }, "Students"), h("th", { style: { textAlign: "right" } }, "Duration"), h("th", null, "")
          )),
          h("tbody", null, intakes.slice().sort((a, b) => a.year - b.year || a.month - b.month).map(ik => {
            const c = COURSES[ik.courseIdx];
            return h("tr", { key: ik.id },
              h("td", null, c.abbr),
              h("td", null, h("span", { className: "badge", style: { background: CAT_COLOR[c.cat] + "22", color: CAT_COLOR[c.cat] } }, c.cat)),
              h("td", null, `${MONTH_NAMES[ik.month]} ${ik.year}`),
              h("td", { style: { textAlign: "right" } }, ik.students),
              h("td", { style: { textAlign: "right" } }, c.mo + " mo"),
              h("td", null, h("button", { className: "del-btn", onClick: () => removeIntake(ik.id) }, "×"))
            );
          }))
        )
      )
    )
  );
}

function numField(label, value, onChange) {
  return h("div", null,
    h("div", { className: "ctrl-lbl" }, label),
    h("input", { type: "number", value, style: { width: 76 }, onChange: e => onChange(parseFloat(e.target.value) || 0) })
  );
}
function kpi(label, val, color, sub) {
  return h("div", { className: "card kpi" },
    h("div", { className: "kpi-lbl" }, label),
    h("div", { className: "kpi-val", style: { color } }, val),
    sub ? h("div", { className: "kpi-sub" }, sub) : null
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(h(App));
