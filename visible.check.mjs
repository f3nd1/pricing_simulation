/* Course visibility: a relevant course never disappears because of the selected
   basis or because it is excluded from the analysis, and the financial
   denominators stay the calculation population.
   node visible.check.mjs -> non-zero exit on failure. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage();
await p.setViewportSize({ width:1440, height:1100 });
const fails = [], errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (t,c,x='') => { console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`); if(!c) fails.push(t); };

/* §17 asymmetric fixture: A both, B actual only, C budget only, D nothing */
const NAMES = await p.evaluate(() => null);
await p.goto('file://' + process.cwd() + '/ucc_budget_simulator.html');
const F = await p.evaluate(() => {
  const prices = COURSES.map(c=>({...c}));
  const A=0,B=1,C=2,D=3;
  const intakes=[]; let id=1;
  intakes.push({id:id++,kind:'budget',ci:A,month:0,year:2026,students:20});
  intakes.push({id:id++,kind:'actual',ci:A,month:0,year:2026,students:15});
  intakes.push({id:id++,kind:'actual',ci:B,month:0,year:2026,students:15});
  intakes.push({id:id++,kind:'budget',ci:C,month:0,year:2026,students:10});
  localStorage.setItem('ucc_sim_v4', JSON.stringify({ prices, intakes, ybYear:2026, module:'cba',
    cba:{driver:'hours',off:{},rates:{},def:{},basis:'budget',otherRev:[]} }));
  localStorage.setItem('ucc_unlocked','ucc2026');
  return { A:prices[A].name, B:prices[B].name, C:prices[C].name, D:prices[D].name };
});
await p.reload(); await p.waitForTimeout(500);

const go = (mode,extra) => p.evaluate(([mode,extra]) => {
  ST.module='cba'; ST.cba.mode=mode; Object.assign(ST.cba, extra||{}); render(); }, [mode,extra||{}]);
/* what a manager actually sees: the rendered table rows */
const shown = () => p.evaluate(() => [...document.querySelectorAll('tr[data-cbarow] .cb-name')]
  .map(x=>x.title || x.innerText));
const rowOf = nm => p.evaluate(([nm]) => {
  const tr=[...document.querySelectorAll('tr[data-cbarow]')].find(x=>x.innerText.includes(nm));
  return tr ? tr.innerText.replace(/\n/g,' | ') : null; }, [nm]);

// ── §17 relevance is a property of the year, not of the basis ─────────────
const rel = await p.evaluate(() => {
  const d=cbaCompute(ST,'budget',2026);
  return { relevant:d.relevant.map(r=>r.name), counts:d.counts }; });
ok('§17 relevant = Budget OR Actual enrolment for the year — A, B and C but not D',
   rel.relevant.length===3 && rel.relevant.includes(F.A) && rel.relevant.includes(F.B) &&
   rel.relevant.includes(F.C) && !rel.relevant.includes(F.D),
   rel.relevant.join(' · '));

await go('manage',{basis:'budget'});
let list = await shown();
ok('§17 Budget mode shows all three relevant courses by default, D excluded',
   list.includes(F.A) && list.includes(F.B) && list.includes(F.C) && !list.includes(F.D),
   `${list.length} rows`);
ok('§17 the Actual-only course states "No Budget target" instead of vanishing',
   /No Budget target/i.test(await rowOf(F.B)), await rowOf(F.B));

await go('manage',{basis:'actual'});
list = await shown();
ok('§17 Actual mode still shows all three, including the Budget-only course',
   list.includes(F.A) && list.includes(F.B) && list.includes(F.C) && !list.includes(F.D));
ok('§17 the Budget-only course states "No Actual enrolment"',
   /No Actual enrolment/i.test(await rowOf(F.C)), await rowOf(F.C));

const allCfg = await p.evaluate(() => { ST.cba.scope='all'; render();
  return [...document.querySelectorAll('tr[data-cbarow]')].length; });
ok('§17 All configured lists every course, including the one with no activity',
   allCfg===(await p.evaluate(() => COURSES.length)), `${allCfg} rows`);
await p.evaluate(() => { ST.cba.scope='relevant'; render(); });

// ── §18 exclusion is a badge, never a visibility rule ─────────────────────
const before = await p.evaluate(() => { const d=cbaCompute(ST,'actual',2026);
  return { students:d.T.students, contribution:d.T.contribution, bcr:d.T.bcr, both:d.counts.both }; });
await p.evaluate(([B]) => { ST.cba.off[B]=true; render(); }, [F.B]);
list = await shown();
const rB = await rowOf(F.B);
ok('§18 an excluded course stays visible with its real enrolment',
   list.includes(F.B) && /\b15\b/.test(rB) && /Excluded/i.test(rB), rB);
ok('§18 its analysis fields read N/A rather than a fabricated zero',
   /N\/A/.test(rB) && !/\$0\b/.test(rB));
const during = await p.evaluate(() => { const d=cbaCompute(ST,'actual',2026);
  return { students:d.T.students, contribution:d.T.contribution, both:d.counts.both,
           relevant:d.counts.relevant }; });
ok('§15 the financial denominator drops the excluded course, the visible population does not',
   during.both===before.both-1 && during.relevant===3 && during.students<before.students,
   `analysed ${before.both}→${during.both} · relevant ${during.relevant}`);
const insight = await p.evaluate(([B]) => {
  const d=cbaCompute(ST,'actual',2026), I=cbaInsights(ST,d);
  const x=[...I.risk,...I.opp].find(y=>y.course===B);
  return x?`${x.msg} — ${x.val}`:null; }, [F.B]);
ok('§9 the excluded course is still discovered by Management attention, as a fact',
   !!insight && /excluded from cost-benefit/i.test(insight), insight);
await p.evaluate(([B]) => { delete ST.cba.off[B]; render(); }, [F.B]);
const after = await p.evaluate(() => { const d=cbaCompute(ST,'actual',2026);
  return { students:d.T.students, contribution:d.T.contribution, bcr:d.T.bcr, both:d.counts.both }; });
ok('§18 re-including restores the financial fields immediately, with no reload',
   JSON.stringify(after)===JSON.stringify(before));

// ── §1 no dismissal anywhere ──────────────────────────────────────────────
await go('manage',{});
const dism = await p.evaluate(() => ({
  ctrls: document.querySelectorAll('[data-cbadismiss],[data-cbaundismiss],[data-cbashowdis],[data-cbarestoreall]').length,
  txt: document.body.innerText,
  showAll: !!document.querySelector('[data-cbashowall]') }));
ok('§1 no dismiss, no Dismissed (n), no restore anywhere in Manage',
   dism.ctrls===0 && !/dismiss/i.test(dism.txt), `${dism.ctrls} controls`);
const insN = await p.evaluate(() => { const d=cbaCompute(ST); const I=cbaInsights(ST,d);
  return I.risk.length+I.opp.length; });
ok('§1 Show all / Show fewer survives as presentation-only expansion',
   insN<=6 ? !dism.showAll : dism.showAll, `${insN} insights`);

// ── §7 the switcher is two views plus two separate filters ────────────────
const sw = await p.evaluate(() => {
  const t=document.body.innerText;
  return { relevant:/Relevant courses \(\d+\)/.test(t), all:/All configured \(\d+\)/.test(t),
           analysis:/Analysis/.test(t), activity:/Activity/.test(t),
           gone:/All courses with enrolment|Analysed courses \(/.test(t) }; });
ok('§7 the view switcher is Relevant / All configured, with Analysis and Activity filters',
   sw.relevant && sw.all && sw.analysis && sw.activity && !sw.gone, JSON.stringify(sw));

// ── §12 a narrowing filter announces itself ───────────────────────────────
const narrowed = await p.evaluate(() => { ST.cba.fActivity='budget'; render();
  const t=document.body.innerText;
  const n=document.querySelectorAll('tr[data-cbarow]').length;
  ST.cba.fActivity='any'; render();
  return { n, msg:(t.match(/Showing \d+ of \d+ relevant courses/)||[''])[0],
           chip:/Budget activity ×/.test(t) }; });
ok('§12 a narrowing filter says so and offers a clearable chip',
   narrowed.n===2 && !!narrowed.msg && narrowed.chip, `${narrowed.msg} · ${narrowed.n} rows`);

// ── §13 the counts read in plain words ────────────────────────────────────
const counts = await p.evaluate(() => document.body.innerText);
ok('§13 the population is stated as relevant / budget planned / actual / included / configured',
   /Relevant courses/i.test(counts) && /Budget planned/i.test(counts) &&
   /Actual enrolment/i.test(counts) && /Included in analysis/i.test(counts) &&
   !/analysed of \d+ with a plan/i.test(counts));

// ── §11 the matrix explains anything it cannot plot ───────────────────────
await go('manage',{basis:'budget'});
const plot = await p.evaluate(([B]) => {
  const t=document.body.innerText;
  return { line:(t.match(/Relevant courses \d+ · plotted \d+/)||[''])[0],
           notPlotted:/not plotted/i.test(t), namesB:t.includes(B) }; }, [F.B]);
ok('§11 the matrix states relevant vs plotted and names what it left out',
   !!plot.line && plot.notPlotted && plot.namesB, `${plot.line} · ${plot.notPlotted}`);

// ── §16 no internal vocabulary reaches the screen ─────────────────────────
const words = await p.evaluate(() => document.body.innerText);
ok('§16 no internal vocabulary (live rows, analysed subset, activity population)',
   !/live rows|analysed subset|activity population/i.test(words));

if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nconsole errors: '+errs.join(' | ') : '\nno console errors');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
