/* Acceptance test for the reported state: DIPAI and ADIPAI both have 2026 Actual
   enrolment and are both excluded by legacy state. Asserted against the rendered
   DOM at 1440px. node aicourse.check.mjs -> non-zero exit on failure. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage();
await p.setViewportSize({ width:1440, height:1000 });
const fails = [], errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (t,c,x='') => { console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`); if(!c) fails.push(t); };

const DIPAI = 'Diploma in Applied Artificial Intelligence';
const ADIPAI = 'Advanced Diploma in Applied AI';

await p.goto('file://' + process.cwd() + '/ucc_budget_simulator.html');
/* the reported state: ADIPAI 15 budget + 15 actual, DIPAI 15 actual only,
   six other courses with actuals included, and legacy exclusions on the two */
await p.evaluate(([DIPAI,ADIPAI]) => {
  const prices = COURSES.map(c=>({...c}));
  const d = prices.findIndex(c=>c.name===DIPAI), a = prices.findIndex(c=>c.name===ADIPAI);
  const intakes = []; let id = 1;
  intakes.push({id:id++,kind:'actual',ci:d,month:0,year:2026,students:15});
  intakes.push({id:id++,kind:'actual',ci:a,month:0,year:2026,students:15});
  intakes.push({id:id++,kind:'budget',ci:a,month:0,year:2026,students:15});
  for (let ci=0; ci<6; ci++) {
    intakes.push({id:id++,kind:'budget',ci,month:0,year:2026,students:14});
    intakes.push({id:id++,kind:'actual',ci,month:0,year:2026,students:12}); }
  const off = {}; prices.forEach((c,i) => {
    if(!intakes.some(k=>k.ci===i&&(k.kind||'budget')==='budget'&&k.year===2026)) off[c.name]=true; });
  off[DIPAI]=true; off[ADIPAI]=true;      /* both excluded, as reported */
  localStorage.setItem('ucc_sim_v4', JSON.stringify({ prices, intakes, ybYear:2026, module:'cba',
    smaster:{q:'',cat:'All',onlyActive:false,groups:{sim:true,oh:true,act:true,sub:true,price:true}},
    cba:{tab:'status',scope:'active',driver:'hours',off,rates:{},def:{},basis:'actual',otherRev:[]} }));
  localStorage.setItem('ucc_unlocked','ucc2026');
}, [DIPAI,ADIPAI]);
await p.reload(); await p.waitForTimeout(500);

// ── §1 verify both courses before changing anything ────────────────────────
const V = await p.evaluate(([DIPAI,ADIPAI]) => {
  const one = nm => { const ci = COURSES.findIndex(c=>c.name===nm);
    const r = cbaCompute(ST,'actual',2026).rows.find(x=>x.ci===ci);
    return { ci, budget:r.budStudents, actual:r.actStudents,
             hasActual:r.hasActual, hasBudget:r.hasBudget, included:r.included }; };
  return { d:one(DIPAI), a:one(ADIPAI), counts:cbaCompute(ST,'actual',2026).counts };
}, [DIPAI,ADIPAI]);
console.log('\n  DIPAI ', JSON.stringify(V.d), '\n  ADIPAI', JSON.stringify(V.a),
            '\n  counts', JSON.stringify(V.counts), '\n');
ok('§1 ADIPAI: Budget 15, Actual 15, has actual activity, currently excluded',
   V.a.budget===15 && V.a.actual===15 && V.a.hasActual && !V.a.included);
ok('§1 DIPAI: Budget 0, Actual 15, has actual activity, currently excluded',
   V.d.budget===0 && V.d.actual===15 && V.d.hasActual && !V.d.hasBudget && !V.d.included);
ok('§1 counts: 8 with actual enrolment, 6 analysed, 2 excluded with enrolment',
   V.counts.activity===8 && V.counts.both===6 && V.counts.excludedWithActivity===2,
   `activity ${V.counts.activity} · analysed ${V.counts.both} · excluded ${V.counts.excludedWithActivity}`);

const go = (mod,tab,scope) => p.evaluate(([mod,tab,scope]) => {
  ST.module=mod; if(tab)cbaGo(ST,tab); if(scope)ST.cba.scope=scope; saveToStorage(); render(); }, [mod,tab,scope]);
const txt = () => p.evaluate(() => document.body.innerText);

// ── §2/§3 header and KPI wording ───────────────────────────────────────────
await go('cba','status','incl');
let t = await txt();
ok('§2 the header no longer calls only the analysed courses "running"',
   !/\d+ running/i.test(t) && /8 with enrolment/i.test(t) && /6 analysed/i.test(t),
   (t.match(/\d+ with enrolment · \d+ analysed · ratio [\d.—]+/)||['(not found)'])[0]);
ok('§3 no run-basis wording anywhere on the page',
   !/run basis/i.test(t) && !/\brecorded runs?\b/i.test(t) &&
   /meet the enrolment pace their own economics require/i.test(t),
   (t.match(/\d+ of \d+ meet the enrolment pace[^.]*\./i)||['(not found)'])[0]);

// ── §4/§5 view labels and the plain-English line ───────────────────────────
ok('§4 the three views are named for what they contain, with live counts',
   /Analysed courses \(6\)/i.test(t) && /All courses with enrolment \(8\)/i.test(t) &&
   /All configured \(\d+\)/i.test(t),
   (t.match(/Analysed courses[\s\S]{0,70}/i)||[''])[0].replace(/\n+/g,' · '));
ok('§5 the page explains the split in plain English',
   /8 courses have Actual enrolment in 2026\. 6 are included in Cost-Benefit and 2 are excluded/i.test(t.replace(/\s+/g,' ')) &&
   /Excluded courses keep their Yearly Budget enrolment/i.test(t.replace(/\s+/g,' ')));

// ── §4 both courses visible with 15 and an Include action ──────────────────
await go('cba','status','activity');
const rows = await p.evaluate(([DIPAI,ADIPAI]) => {
  const get = nm => { const tr=[...document.querySelectorAll('tbody tr')].find(x=>x.innerText.includes(nm));
    return tr ? { text:tr.innerText.replace(/\n/g,' | '),
                  btn: !!tr.querySelector('[data-cbainc]') } : null; };
  return { d:get(DIPAI), a:get(ADIPAI) }; }, [DIPAI,ADIPAI]);
ok('§4 DIPAI is listed with 15, badged Excluded, with an Include action',
   !!rows.d && /\b15\b/.test(rows.d.text) && /Excluded/i.test(rows.d.text) && rows.d.btn, rows.d && rows.d.text);
ok('§4 ADIPAI is listed with 15, badged Excluded, with an Include action',
   !!rows.a && /\b15\b/.test(rows.a.text) && /Excluded/i.test(rows.a.text) && rows.a.btn, rows.a && rows.a.text);
// §7 DIPAI has actuals but no budget target
ok('§7 DIPAI shows "no 2026 Budget target", not 0% or a false failure',
   /no 2026 Budget target/i.test(rows.d.text), rows.d.text);

// ── §6 Review exclusions lists Budget, Actual and inclusion per course ─────
await go('cba','courses');
const rev = await p.evaluate(([DIPAI]) => {
  const tr=[...document.querySelectorAll('tbody tr')].find(x=>x.innerText.includes(DIPAI));
  return { row: tr?tr.innerText.replace(/\n/g,' | '):null,
           heads: [...document.querySelectorAll('th')].map(x=>x.innerText.replace(/\n/g,' ').trim()),
           body: document.body.innerText }; }, [DIPAI]);
ok('§6 Review exclusions shows the year\'s Budget and Actual and the inclusion state',
   /2026 Budget/i.test(rev.heads.join('|')) && /2026 Actual/i.test(rev.heads.join('|')) &&
   /In analysis/i.test(rev.heads.join('|')) && /Excluded/i.test(rev.row||''),
   rev.row);
ok('§6 it states that inclusion changes the analysis only',
   /changes Cost-Benefit analysis inclusion only/i.test(rev.body) &&
   /never alters the Yearly Budget, the Price List/i.test(rev.body));

// ── §8 include both, live ──────────────────────────────────────────────────
await go('cba','status','activity');
const before = await p.evaluate(() => { const d=cbaCompute(ST,'actual');
  return {rev:d.T.benefit,cost:d.T.cost,con:d.T.contribution,bcr:d.T.bcr,c:d.counts}; });
await p.evaluate(([DIPAI,ADIPAI]) => {
  [DIPAI,ADIPAI].forEach(nm => {
    const btn=document.querySelector(`[data-cbainc="${nm}"]`); if(btn) btn.click(); });
}, [DIPAI,ADIPAI]);
await p.evaluate(([ADIPAI]) => {   /* the second click re-renders, so find it again */
  const btn=document.querySelector(`[data-cbainc="${ADIPAI}"]`); if(btn) btn.click(); }, [ADIPAI]);
const after = await p.evaluate(() => { const d=cbaCompute(ST,'actual');
  return {rev:d.T.benefit,cost:d.T.cost,con:d.T.contribution,bcr:d.T.bcr,c:d.counts}; });
ok('§8 after including both: 8 with enrolment, 8 analysed, 0 excluded with enrolment',
   after.c.activity===8 && after.c.both===8 && after.c.excludedWithActivity===0,
   `${before.c.both} analysed -> ${after.c.both}, excluded ${before.c.excludedWithActivity} -> ${after.c.excludedWithActivity}`);
ok('§8 revenue, direct cost, contribution and BCR all move',
   after.rev>before.rev && after.cost>before.cost && after.con!==before.con && after.bcr!==before.bcr,
   `revenue ${Math.round(before.rev)}→${Math.round(after.rev)} · BCR ${before.bcr.toFixed(3)}→${after.bcr.toFixed(3)}`);

const everywhere = await p.evaluate(([DIPAI,ADIPAI]) => {
  const out={};
  const has = nm => document.body.innerText.includes(nm);
  [['status','activity'],['portfolio',null],['diag',null],['bycourse',null],['charts',null],['years',null]]
    .forEach(([tab])=>{ ST.cba.tab=tab; render(); out[tab]=has(DIPAI)&&has(ADIPAI); });
  cbaGo(ST,'status'); render();
  const d=cbaCompute(ST,'actual');
  out.inLive = ['d','a'].every((_,i)=>true) &&
    !!d.live.find(r=>r.name===DIPAI) && !!d.live.find(r=>r.name===ADIPAI);
  return out; }, [DIPAI,ADIPAI]);
ok('§8 both courses now appear on Course status, Portfolio, By course and Diagnostics',
   everywhere.status && everywhere.portfolio && everywhere.bycourse && everywhere.diag && everywhere.inLive,
   JSON.stringify(everywhere));

// ── §9 Simulator Inputs, in the DOM ────────────────────────────────────────
await go('simmaster');
const sm = await p.evaluate(([DIPAI,ADIPAI]) => {
  const cells = nm => { const tr=[...document.querySelectorAll('tbody tr')].find(x=>x.innerText.includes(nm));
    return tr?[...tr.querySelectorAll('td')].map(x=>x.innerText.trim()):null; };
  return { d:cells(DIPAI), a:cells(ADIPAI),
           labelled:/Enrolment 2026[\s\S]{0,60}Yearly Budget/i.test(document.body.innerText) }; }, [DIPAI,ADIPAI]);
ok('§9 Simulator Inputs shows ADIPAI Budget 15 / Actual 15',
   !!sm.a && sm.a[3]==='15' && sm.a[4]==='15', (sm.a||[]).slice(2,7).join(' | '));
ok('§9 Simulator Inputs shows DIPAI Budget — / Actual 15',
   !!sm.d && sm.d[3]==='—' && sm.d[4]==='15', (sm.d||[]).slice(2,7).join(' | '));
ok('§9 the enrolment block is labelled as coming from the Yearly Budget', sm.labelled);

if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nconsole errors: '+errs.join(' | ') : '\nno console errors');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
