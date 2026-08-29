/* Runnable check for the Cost-Benefit money logic.
   node cba.check.mjs   → exits non-zero if any invariant breaks.

   The invariants that make this board-safe:
     1. The institution ratio does NOT move when the allocation driver changes.
     2. Allocated overhead across courses sums to exactly the OPEX pool.
     3. Total cost = direct cost + the WHOLE pool.
     4. Deactivating a course does not shrink the overhead pool — the rent stays.
     5. The academic-salary split nets off the pool exactly, and raising it
        lowers total cost (teaching stops being counted twice).
     6. Per-course verdicts follow the stated rules, not the ratio.
     7. Institution breakeven enrolment actually breaks even when applied.
     8. Pass rate drives cost-per-successful-student and nothing else.
     9. Other income lifts benefit but never touches cost or per-course figures.
    10. Budget and actual run on the same cost model. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
await p.goto('file://' + process.cwd() + '/ucc_budget_simulator.html');
await p.waitForTimeout(300);
// unlock the gate, then seed some enrolment so there is something to analyse
await p.evaluate(() => { localStorage.setItem('ucc_unlocked', APP_PASSCODE); });
await p.reload();
await p.waitForTimeout(400);

const r = await p.evaluate(() => {
  ST.intakes = [0,1,2,3,4].map((ci,i) => ({id:i+1, kind:'budget', ci, month:0, year:cbaYear(ST), students:15+i*5}));
  ST.module = 'cba';
  const byDriver = {};
  for (const d of ['hours','months','revenue']) {
    ST.cba.driver = d;
    const x = cbaCompute(ST);
    byDriver[d] = {
      bcr: x.T.bcr, cost: x.T.cost, pool: x.pool,
      allocSum: x.live.reduce((a,r) => a + r.allocOH, 0),
      direct: x.T.direct, benefit: x.T.benefit,
    };
  }
  ST.cba.driver = 'hours';
  const before = cbaCompute(ST);
  const victim = before.live[0].name;
  ST.cba.off[victim] = true;
  const after = cbaCompute(ST);
  delete ST.cba.off[victim];
  ST.cba.acadPct = 0;  const a0 = cbaCompute(ST);
  ST.cba.acadPct = 50; const a50 = cbaCompute(ST);
  ST.cba.acadPct = 0;
  const acad = { gross: a50.acad.line ? a50.acad.line.gross : 0,
    deduct: a50.acad.deduct, poolGross: a50.poolGross,
    pool0: a0.pool, pool50: a50.pool, cost0: a0.T.cost, cost50: a50.T.cost,
    bcr0: a0.T.bcr, bcr50: a50.T.bcr };
  const vd = before.live.map(r => ({
    name: r.name, contribution: r.contribution, minFull: r.minFull,
    students: r.students, margin: r.margin, k: r.verdict.k }));
  const need = { n: before.T.needStudents, students: before.T.students,
    pool: before.pool, contribution: before.T.contribution };
  // 8: pass rate only affects cost-per-pass
  ST.cba.rates[before.live[0].name] = { ...(ST.cba.rates[before.live[0].name]||{}), pass: 50 };
  const pAfter = cbaCompute(ST);
  const pr = { costBefore: before.T.cost, costAfter: pAfter.T.cost,
    rowCostStu: pAfter.live[0].costPerStu, rowCostPass: pAfter.live[0].costPerPass };
  delete ST.cba.rates[before.live[0].name].pass;
  // 9: other income lifts benefit, not cost
  const o0 = cbaCompute(ST);
  ST.cba.otherRev = [{ label: 'Room rental', amt: 250000 }];
  const o1 = cbaCompute(ST);
  ST.cba.otherRev = [];
  const oth = { ben0: o0.T.benefit, ben1: o1.T.benefit, cost0: o0.T.cost, cost1: o1.T.cost,
    rowTotal0: o0.live[0].total, rowTotal1: o1.live[0].total, need0: o0.T.needStudents, need1: o1.T.needStudents };
  // 10: same cost model on either basis
  const bs = { bPool: cbaCompute(ST,'budget').pool, aPool: cbaCompute(ST,'actual').pool };
  return { byDriver, victim, acad, vd, need, pr, oth, bs,
    poolBefore: before.pool, poolAfter: after.pool,
    costBefore: before.T.cost, costAfter: after.T.cost,
    directBefore: before.T.direct, directAfter: after.T.direct };
});

const fails = [];
const near = (a, b2, tol = 0.01) => Math.abs(a - b2) < tol;
const ds = Object.values(r.byDriver);

if (!ds.every(d => near(d.bcr, ds[0].bcr)))
  fails.push(`ratio moved with driver: ${ds.map(d => d.bcr.toFixed(4)).join(' / ')}`);
for (const [k, d] of Object.entries(r.byDriver)) {
  if (!near(d.allocSum, d.pool)) fails.push(`${k}: allocated ${d.allocSum.toFixed(2)} != pool ${d.pool.toFixed(2)}`);
  if (!near(d.cost, d.direct + d.pool)) fails.push(`${k}: cost != direct + pool`);
  if (!near(d.bcr, d.benefit / d.cost)) fails.push(`${k}: bcr != benefit/cost`);
}
if (!near(r.poolBefore, r.poolAfter))
  fails.push(`pool shrank when "${r.victim}" was deactivated: ${r.poolBefore} -> ${r.poolAfter}`);
if (!(r.directAfter < r.directBefore))
  fails.push('deactivating did not remove direct cost');
const A = r.acad;
if (!near(A.deduct, A.gross * 0.5)) fails.push(`50% split != half the salary line (${A.deduct} vs ${A.gross / 2})`);
if (!near(A.pool50, A.poolGross - A.deduct)) fails.push('pool != OPEX - academic deduction');
if (!near(A.pool0, A.poolGross)) fails.push('0% split still changed the pool');
if (!(A.cost50 < A.cost0)) fails.push('raising the academic split did not lower total cost');
if (!(A.bcr50 > A.bcr0)) fails.push('raising the academic split did not improve the ratio');
for (const v of r.vd) {
  const want = v.contribution < 0 ? 'stop' : v.minFull == null ? 'reprice'
    : v.students >= v.minFull ? 'expand' : 'grow';
  if (v.k !== want) fails.push(`${v.name}: verdict ${v.k}, rules say ${want}`);
  if (v.k === 'expand' && v.contribution <= 0) fails.push(`${v.name}: told to expand while losing money`);
  if (v.k === 'stop' && v.contribution >= 0) fails.push(`${v.name}: told to stop while contributing`);
}
const N = r.need;
if (N.n != null) {
  const k = N.n / N.students;                       // scale the mix to that enrolment
  if (!near(k * N.contribution, N.pool, Math.max(1, N.pool * 0.02)))
    fails.push(`breakeven enrolment ${N.n} does not clear the pool`);
} else if (N.contribution > 0) fails.push('contribution positive but no breakeven enrolment given');
const P = r.pr;
if (!near(P.costBefore, P.costAfter)) fails.push('pass rate changed total cost');
if (!near(P.rowCostPass, P.rowCostStu * 2, 1)) fails.push(`50% pass should double cost/pass (${P.rowCostPass} vs ${P.rowCostStu})`);
const O = r.oth;
if (!near(O.ben1 - O.ben0, 250000)) fails.push('other income did not lift benefit by its amount');
if (!near(O.cost0, O.cost1)) fails.push('other income changed total cost');
if (!near(O.rowTotal0, O.rowTotal1)) fails.push('other income leaked into a per-course total');
if (O.need1 != null && O.need0 != null && !(O.need1 < O.need0)) fails.push('other income did not lower breakeven enrolment');
if (!near(r.bs.bPool, r.bs.aPool)) fails.push('budget and actual used different overhead pools');
if (errs.length) fails.push(...errs);

console.log(`ratio (all drivers): ${ds.map(d => d.bcr.toFixed(4)).join(' / ')}`);
console.log(`pool ${r.poolBefore.toFixed(0)} | cost ${r.costBefore.toFixed(0)} -> ${r.costAfter.toFixed(0)} after dropping "${r.victim}"`);
console.log(`acad split 0%->50%: pool ${A.pool0.toFixed(0)} -> ${A.pool50.toFixed(0)}, ratio ${A.bcr0.toFixed(4)} -> ${A.bcr50.toFixed(4)}`);
console.log(`verdicts: ${['expand','grow','reprice','stop'].map(k=>k+'='+r.vd.filter(v=>v.k===k).length).join(' ')}`);
console.log(`institution breakeven enrolment: ${N.n == null ? 'unreachable at this pricing' : N.n + ' vs ' + N.students + ' planned'}`);
console.log(`pass 50%: cost/stu ${P.rowCostStu.toFixed(0)} -> cost/pass ${P.rowCostPass.toFixed(0)}; total cost unchanged ${near(P.costBefore,P.costAfter)}`);
console.log(`other income +250k: benefit ${O.ben0.toFixed(0)} -> ${O.ben1.toFixed(0)}, cost unchanged ${near(O.cost0,O.cost1)}, breakeven ${O.need0} -> ${O.need1}`);
console.log(fails.length ? 'FAIL:\n  ' + fails.join('\n  ') : 'PASS — all invariants hold');
await b.close();
process.exit(fails.length ? 1 : 0);
