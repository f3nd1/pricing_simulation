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
    10. Budget and actual run on the same cost model.
    11. Institution arithmetic: BCR, ROI and operating margin match their formulas.
    12. Course arithmetic: contribution, full cost and BCR match their formulas.
    13. Operating BE uses direct costs only; Full-Cost BE includes allocated
        overhead, so Operating BE is never the larger of the two.
    14. Actions never say STOP on a course with positive contribution. */
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
    name: r.name, contribution: r.contribution, beOp: r.beOp, beFull: r.beFull,
    students: r.students, margin: r.margin, k: r.verdict.k, cls: r.cls,
    revenue: r.revenue, direct: r.direct, allocOH: r.allocOH, total: r.total,
    bcr: r.bcr, roi: r.roi }));
  const inst = { benefit: before.T.benefit, cost: before.T.cost, bcr: before.T.bcr,
    roi: before.T.roi, opMargin: before.T.opMargin, net: before.T.net };
  // 13: Operating BE must be reachable with direct costs alone
  const beChk = before.live.map(r => {
    const hrs = r.c ? (r.c.hrs || 0) : 0;
    return { name: r.name, beOp: r.beOp, beFull: r.beFull,
      opCovers: r.beOp == null ? null :
        r.beOp * r.price - (hrs * Math.ceil(r.beOp / r.cls) * r.rate + r.beOp * r.c.fee * r.comm) };
  });
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
  return { byDriver, victim, acad, vd, need, pr, oth, bs, inst, beChk,
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
  // action rules per spec section 5
  const reachable = v.beFull != null && v.beFull <= Math.max(v.students * 3, v.cls);
  const want = v.contribution < 0 ? (v.beOp == null ? 'stop' : 'reprice')
    : (v.beFull != null && v.students >= v.beFull) ? 'maintain'
    : reachable ? 'grow' : 'review';
  if (v.k !== want) fails.push(`${v.name}: action ${v.k}, rules say ${want}`);
  if (v.k === 'stop' && v.contribution >= 0)
    fails.push(`${v.name}: told to STOP despite positive contribution`);
  if (v.k === 'maintain' && v.contribution <= 0) fails.push(`${v.name}: called healthy while losing money`);
  // 12: course arithmetic
  if (!near(v.contribution, v.revenue - v.direct, 0.5)) fails.push(`${v.name}: contribution != revenue - direct`);
  if (!near(v.total, v.direct + v.allocOH, 0.5)) fails.push(`${v.name}: full cost != direct + allocated`);
  if (v.bcr != null && !near(v.bcr, v.revenue / v.total, 1e-6)) fails.push(`${v.name}: BCR != revenue / full cost`);
  if (v.roi != null && !near(v.roi, (v.revenue - v.total) / v.total, 1e-6)) fails.push(`${v.name}: ROI formula`);
}
// 11: institution arithmetic
const I = r.inst;
if (!near(I.bcr, I.benefit / I.cost, 1e-9)) fails.push('institution BCR != revenue / cost');
if (!near(I.roi, (I.benefit - I.cost) / I.cost, 1e-9)) fails.push('institution ROI formula');
if (!near(I.opMargin, (I.benefit - I.cost) / I.benefit, 1e-9)) fails.push('operating margin formula');
if (!near(I.net, I.benefit - I.cost, 0.5)) fails.push('net != revenue - cost');
// 13: the two break-evens
for (const b2 of r.beChk) {
  if (b2.beOp != null && b2.beFull != null && b2.beOp > b2.beFull)
    fails.push(`${b2.name}: Operating BE ${b2.beOp} exceeds Full-Cost BE ${b2.beFull}`);
  if (b2.opCovers != null && b2.opCovers < -0.5)
    fails.push(`${b2.name}: Operating BE does not actually cover direct costs`);
  if (b2.beFull != null && b2.beOp == null)
    fails.push(`${b2.name}: full-cost reachable but operating BE is not`);
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
console.log(`BE pairs: ${r.beChk.slice(0,4).map(b2=>`${b2.beOp==null?'never':b2.beOp}/${b2.beFull==null?'never':b2.beFull}`).join(' ')} (operating/full-cost)`);
console.log(`institution: BCR ${I.bcr.toFixed(4)}x  ROI ${(I.roi*100).toFixed(1)}%  op margin ${(I.opMargin*100).toFixed(1)}%`);
console.log(`actions: ${['maintain','grow','review','reprice','stop'].map(k=>k+'='+r.vd.filter(v=>v.k===k).length).join(' ')}`);
console.log(`institution breakeven enrolment: ${N.n == null ? 'unreachable at this pricing' : N.n + ' vs ' + N.students + ' planned'}`);
console.log(`pass 50%: cost/stu ${P.rowCostStu.toFixed(0)} -> cost/pass ${P.rowCostPass.toFixed(0)}; total cost unchanged ${near(P.costBefore,P.costAfter)}`);
console.log(`other income +250k: benefit ${O.ben0.toFixed(0)} -> ${O.ben1.toFixed(0)}, cost unchanged ${near(O.cost0,O.cost1)}, breakeven ${O.need0} -> ${O.need1}`);
console.log(fails.length ? 'FAIL:\n  ' + fails.join('\n  ') : 'PASS — all invariants hold');
await b.close();
process.exit(fails.length ? 1 : 0);
