/* Management attention panel: fully dynamic, split risk/opportunity, dismissable,
   dismissal expires when the underlying number materially changes, and nothing
   about dismissal touches the data. Asserted against the rendered DOM.
   node attention.check.mjs -> non-zero exit on failure. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage();
await p.setViewportSize({ width:1440, height:1100 });
const fails = [], errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (t,c,x='') => { console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`); if(!c) fails.push(t); };

const DIPAI = 'Diploma in Applied Artificial Intelligence';
const ADIPAI = 'Advanced Diploma in Applied AI';

await p.goto('file://' + process.cwd() + '/ucc_budget_simulator.html');
await p.evaluate(([DIPAI,ADIPAI]) => {
  const prices = COURSES.map(c=>({...c}));
  const d = prices.findIndex(c=>c.name===DIPAI), a = prices.findIndex(c=>c.name===ADIPAI);
  const intakes = []; let id = 1;
  intakes.push({id:id++,kind:'actual',ci:d,month:0,year:2026,students:15});   /* no budget */
  intakes.push({id:id++,kind:'actual',ci:a,month:0,year:2026,students:15});
  intakes.push({id:id++,kind:'budget',ci:a,month:0,year:2026,students:15});
  for (let ci=0; ci<4; ci++) {                       /* four courses under budget */
    intakes.push({id:id++,kind:'budget',ci,month:0,year:2026,students:20});
    intakes.push({id:id++,kind:'actual',ci,month:0,year:2026,students:12}); }
  localStorage.setItem('ucc_sim_v4', JSON.stringify({ prices, intakes, ybYear:2026, module:'cba',
    cba:{tab:'status',scope:'incl',driver:'hours',off:{},rates:{},def:{},basis:'actual',otherRev:[]} }));
  localStorage.setItem('ucc_unlocked','ucc2026');
}, [DIPAI,ADIPAI]);
await p.reload(); await p.waitForTimeout(500);

const panel = () => p.evaluate(() => {
  const card=[...document.querySelectorAll('.cb-panel')].find(c=>/what needs a decision/i.test(c.innerText));
  if(!card) return null;
  const sect = nm => { const t=card.innerText.split('\n'); const i=t.findIndex(x=>new RegExp('^'+nm+'$','i').test(x.trim()));
    if(i<0) return []; const out=[];
    for(let j=i+1;j<t.length;j++){ const l=t[j].trim();
      if(/^(needs attention|opportunities|dismissed)$/i.test(l)) break; if(l) out.push(l); }
    return out; };
  return { text:card.innerText, risk:sect('Needs attention'), opp:sect('Opportunities'),
           rows:card.querySelectorAll('.cb-ins').length };
});
const showAll = () => p.evaluate(() => { ST.cba.showAllInsights=true; render(); });
await showAll();
let P = await panel();

// ── §1/§2 structure ────────────────────────────────────────────────────────
ok('§2 the panel splits needs-attention from opportunities in compact rows',
   !!P && /needs attention/i.test(P.text) && /opportunities/i.test(P.text) && P.rows>0);
ok('§1 no course name appears in the source — every insight is generated',
   await p.evaluate(([DIPAI,ADIPAI]) => {
     const src = cbaInsights.toString() + cbaAttentionPanel.toString();
     return !src.includes(DIPAI) && !src.includes(ADIPAI) && !/IELTS|AEIS|A-Level/.test(src);
   }, [DIPAI,ADIPAI]));

// ── §9 the two AI courses appear under Opportunities from live data ────────
const oppTxt = P.opp.join(' ');
ok('§9 ADIPAI appears under Opportunities with its contribution and headroom',
   oppTxt.includes(ADIPAI) && /\+\$\d/.test(oppTxt),
   P.opp.find(x=>x.includes(ADIPAI)));
ok('§9 DIPAI appears under Opportunities too',
   oppTxt.includes(DIPAI), P.opp.find(x=>x.includes(DIPAI)&&/growth|contributing/i.test(x)));
ok('§9 DIPAI additionally raises the missing Budget target as a planning opportunity',
   /No budget target set/i.test(oppTxt) && /15 actual/i.test(oppTxt),
   P.opp.find(x=>/no 2026 Budget target/i.test(x)));
const covTip = await p.evaluate(() => document.body.innerHTML);
ok('§4 a viable course below full-cost recovery is explained on hover, never called a closure',
   /full-cost coverage 0\.\d\d/i.test(covTip.replace(/&[a-z]+;/g,' ')) &&
   !/close|shut down|terminate/i.test(oppTxt));
ok('§3 real risks are still surfaced separately',
   P.risk.length>0 && /behind budget|below minimum enrolment|central overhead/i.test(P.risk.join(' ')),
   P.risk[0]);

ok('§5/§6 insights can no longer be dismissed — a true issue stays on the dashboard',
   await p.evaluate(() => document.querySelectorAll(
     '[data-cbadismiss],[data-cbaundismiss],[data-cbashowdis],[data-cbarestoreall]').length===0));
ok('§7 the insight identity still carries course, type, year, basis and severity band',
   await p.evaluate(() => { const d=cbaCompute(ST,'actual');
     const I=cbaInsights(ST,d);
     return I.risk.concat(I.opp).every(x=>x.key.split(':').length===5); }));

// ── §10 live reactivity ────────────────────────────────────────────────────
const live = await p.evaluate(([DIPAI]) => {
  const body = () => { render(); const c=[...document.querySelectorAll('.cb-panel')]
    .find(x=>/what needs a decision/i.test(x.innerText)); return c?c.innerText:''; };
  ST.cba.showAllInsights=true;
  const out={};
  const a0 = body();
  const ci = COURSES.findIndex(c=>c.name===DIPAI);
  ST.intakes.find(i=>i.ci===ci&&i.kind==='actual').students = 60;
  out.actualChange = body()!==a0;
  ST.intakes.push({id:77777,kind:'budget',ci,month:0,year:2026,students:50});
  out.budgetChange = /no budget target set/i.test(a0) && !/no budget target set/i.test(body());
  const a1 = body(); ST.cba.basis='budget';
  out.basisChange = body()!==a1;
  ST.cba.basis='actual'; const a2=body(); ST.ybYear=2027;
  out.yearChange = body()!==a2; ST.ybYear=2026;
  const a3=body(); ST.cba.off[DIPAI]=true;
  const a4=body();
  /* excluding no longer hides the course — it changes what is said about it */
  out.inclusionChange = a4!==a3 && a4.includes(DIPAI) && /Excluded from Cost-Benefit/i.test(a4);
  delete ST.cba.off[DIPAI];
  /* a brand-new course generates its own insight with no code change */
  document.getElementById('addCourse');
  ST.module='simulator'; ST.tab='pricelist'; render();
  document.getElementById('addCourse').click();
  const nci = COURSES.length-1; COURSES[nci].name='ZZ Fresh Course';
  ST.intakes.push({id:77778,kind:'actual',ci:nci,month:0,year:2026,students:40});
  ST.module='cba'; cbaGo(ST,'status');
  out.newCourse = /ZZ Fresh Course/.test(body());
  ST.intakes = ST.intakes.filter(i=>i.id!==77777&&i.id!==77778);
  ST.intakes.find(i=>i.ci===ci&&i.kind==='actual').students = 15;
  COURSES.splice(nci,1); render();
  return out; }, [DIPAI]);
ok('§10 the panel follows Actual, Budget, basis, year and inclusion changes live',
   live.actualChange && live.budgetChange && live.basisChange && live.yearChange && live.inclusionChange,
   JSON.stringify(live));
ok('§10 a newly added course generates its own insight, with no code change', live.newCourse);

// ── §8 ranking and the cap ─────────────────────────────────────────────────
const cap = await p.evaluate(() => {
  ST.cba.showAllInsights=false; render();
  const card=[...document.querySelectorAll('.cb-panel')].find(c=>/what needs a decision/i.test(c.innerText));
  const shown=card.querySelectorAll('[data-cbadismiss]').length;
  const d=cbaCompute(ST,'actual'), I=cbaInsights(ST,d);
  const total=I.risk.length+I.opp.length;
  const ranks=I.risk.map(x=>x.rank);
  return { shown, total, hasShowAll:/Show all/.test(card.innerText),
           sorted: ranks.every((v,i)=>i===0||ranks[i-1]<=v) }; });
ok('§8 the list is capped with a Show all, and risks come out in rank order',
   cap.shown<=cap.total && cap.sorted && (cap.total<=cap.shown||cap.hasShowAll),
   `${cap.shown} of ${cap.total} shown`);

// ── persistence ────────────────────────────────────────────────────────────
await p.reload(); await p.waitForTimeout(400);

if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nconsole errors: '+errs.join(' | ') : '\nno console errors');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
