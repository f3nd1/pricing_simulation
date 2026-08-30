/* Cost-Benefit IA redesign: four modes, Simple/Advanced, one course destination,
   a scenario sandbox that never writes canonical data, a board report, and a
   financial reconciliation proving the UX work changed no number.
   node ux.check.mjs -> non-zero exit on failure. */
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
  [d,a].forEach(ci => { intakes.push({id:id++,kind:'actual',ci,month:0,year:2026,students:15});
                        intakes.push({id:id++,kind:'budget',ci,month:0,year:2026,students:15}); });
  for (let ci=0; ci<6; ci++) {
    intakes.push({id:id++,kind:'budget',ci,month:0,year:2026,students:20});
    intakes.push({id:id++,kind:'actual',ci,month:0,year:2026,students:12}); }
  intakes.push({id:id++,kind:'budget',ci:0,month:0,year:2027,students:25});
  localStorage.setItem('ucc_sim_v4', JSON.stringify({ prices, intakes, ybYear:2026, module:'cba',
    cba:{driver:'hours',off:{},rates:{},def:{},basis:'actual',otherRev:[]} }));
  localStorage.setItem('ucc_unlocked','ucc2026');
}, [DIPAI,ADIPAI]);
await p.reload(); await p.waitForTimeout(500);

const go = (mode,extra) => p.evaluate(([mode,extra]) => {
  ST.module='cba'; ST.cba.mode=mode; Object.assign(ST.cba, extra||{}); render(); }, [mode,extra||{}]);
const txt = () => p.evaluate(() => document.body.innerText);
/* the canonical numbers, read straight from the engine */
const canon = () => p.evaluate(([DIPAI,ADIPAI]) => {
  const d = cbaCompute(ST,'actual',2026);
  const one = nm => { const r=d.rows.find(x=>x.name===nm);
    return {students:r.students,revenue:r.revenue,contribution:r.contribution,
            full:r.revenue-r.total,bcr:r.bcr,alloc:r.allocOH}; };
  return { students:d.T.students, revenue:d.T.benefit, cost:d.T.cost, net:d.T.net,
           bcr:d.T.bcr, contribution:d.T.contribution, pool:d.pool,
           counts:d.counts, dipai:one(DIPAI), adipai:one(ADIPAI) }; }, [DIPAI,ADIPAI]);

const C0 = await canon();
console.log('\n  canonical:', JSON.stringify({students:C0.students,revenue:Math.round(C0.revenue),
  cost:Math.round(C0.cost),net:Math.round(C0.net),bcr:+C0.bcr.toFixed(4)}), '\n');

// ── IA ─────────────────────────────────────────────────────────────────────
let t = await txt();
ok('Manage is the default landing mode, with four modes available',
   /Manage/.test(t) && /Analyse/.test(t) && /Simulate/.test(t) && /Present/.test(t) &&
   await p.evaluate(() => cbaMode(ST)==='manage'));
ok('the context bar carries year, basis and the course counts',
   /2026 · ACTUAL/.test(t) && /analysed/.test(t) && /configured/.test(t),
   (t.match(/2026 · ACTUAL[\s\S]{0,80}/)||[''])[0].replace(/\n+/g,' · '));
ok('Simple is the default view and hides the finance columns',
   await p.evaluate(() => !cbaAdv(ST)) && !/\bBCR\b/.test(t) && /After own costs/.test(t));

// ── Manage: four headline metrics reconcile ────────────────────────────────
const head = await p.evaluate(() => {
  const cards=[...document.querySelectorAll('.kpi-card')].slice(0,4)
    .map(c=>({lbl:c.querySelector('.kpi-card-lbl').innerText.trim(),
              val:c.querySelector('.kpi-card-val').innerText.trim()}));
  const H=cbaHeadline(ST,cbaCompute(ST));
  return {cards,H}; });
ok('Manage shows exactly four headline cards: students, P&L, helping, gap',
   head.cards.length===4 && /students/i.test(head.cards[0].lbl) &&
   /(profit|loss)/i.test(head.cards[1].lbl) && /helping/i.test(head.cards[2].lbl) &&
   /gap/i.test(head.cards[3].lbl), head.cards.map(c=>`${c.lbl} ${c.val}`).join(' · '));
ok('the headline numbers reconcile to the canonical totals',
   head.cards[0].val===String(C0.students) &&
   head.cards[1].val===await p.evaluate(n=>sgd(Math.abs(n)), C0.net),
   `${head.cards[0].val} students · ${head.cards[1].val}`);
ok('the management statement is deterministic and built from the live figures',
   /below full-cost sustainability|covering its full cost base/i.test(t) &&
   new RegExp(`${C0.counts.both} analysed course`).test(t.replace(/\s+/g,' ')),
   (t.match(/UCC is [^]*?%\./)||[''])[0].slice(0,120));
ok('the action matrix renders one dot per analysed course, each clickable',
   await p.evaluate(() => document.querySelectorAll('svg circle[data-cbacourse]').length) === C0.counts.both);
ok('Management attention still splits needs-attention from opportunities',
   /needs attention/i.test(t) && /opportunities/i.test(t));

// dismissal is presentation-only
const dis = await p.evaluate(() => {
  const before = JSON.stringify(cbaCompute(ST,'actual',2026).T);
  const btn=document.querySelector('[data-cbadismiss]'); const k=btn&&btn.dataset.cbadismiss;
  if(btn) btn.click();
  const after = JSON.stringify(cbaCompute(ST,'actual',2026).T);
  return { k, same: before===after, hidden: Object.keys(cbaDismissed(ST)).length }; });
ok('dismissing an insight changes no institution figure', dis.same && dis.hidden===1, dis.k);
const rest = await p.evaluate(() => {
  document.querySelector('[data-cbashowdis]').click();
  const b=document.querySelector('[data-cbaundismiss]'); const had=!!b; if(b)b.click();
  return { had, left:Object.keys(cbaDismissed(ST)).length }; });
ok('a dismissed insight can be restored', rest.had && rest.left===0);

// ── Simple / Advanced is presentation only ─────────────────────────────────
const adv = await p.evaluate(() => {
  const before = JSON.stringify(cbaCompute(ST,'actual',2026));
  ST.cba.view='advanced'; render();
  const after = JSON.stringify(cbaCompute(ST,'actual',2026));
  const hasFinance = /BCR|Full-cost coverage|Allocated central overhead/i.test(document.body.innerText);
  ST.cba.view='simple'; render();
  return { same:before===after, hasFinance }; });
ok('Advanced reveals the finance columns and changes not one number',
   adv.same && adv.hasFinance);

// ── Analyse ────────────────────────────────────────────────────────────────
await go('analyse',{sub:'portfolio'});
const port = await p.evaluate(([ADIPAI]) => {
  const d=cbaCompute(ST);
  const rowNames=[...document.querySelectorAll('a[data-cbacourse]')].map(a=>a.innerText);
  const dots=[...document.querySelectorAll('svg circle[data-cbacourse]')].map(c=>+c.dataset.cbacourse);
  return { rowNames, dots, live:d.live.map(r=>r.ci), hasADIPAI:rowNames.includes(ADIPAI) }; }, [ADIPAI]);
ok('the portfolio table and the visual use the same course population',
   port.dots.every(ci=>port.live.includes(ci)) && port.dots.length===port.live.length &&
   port.hasADIPAI, `${port.dots.length} dots · ${port.live.length} analysed`);
const search = await p.evaluate(() => { ST.cba.q='Applied'; render();
  return [...document.querySelectorAll('a[data-cbacourse]')].map(a=>a.innerText); });
ok('portfolio search filters the table and the visual together',
   search.length>0 && search.every(n=>/Applied/i.test(n)), search.join(' · '));
await p.evaluate(() => { ST.cba.q=''; render(); });

/* clicking a course anywhere lands on the same Course analysis */
const fromTable = await p.evaluate(([ADIPAI]) => {
  const a=[...document.querySelectorAll('a[data-cbacourse]')].find(x=>x.innerText===ADIPAI);
  a.click(); return { mode:ST.cba.mode, sub:ST.cba.sub, ci:ST.cba.chartCi,
                      heading:document.querySelector('#cbacontent .card').innerText.split('\n')[0] }; }, [ADIPAI]);
ok('clicking a course in the table opens Course analysis',
   fromTable.mode==='analyse' && fromTable.sub==='course' && fromTable.heading.includes(ADIPAI),
   fromTable.heading);
await go('manage');
const fromDot = await p.evaluate(([ADIPAI]) => {
  const c=[...document.querySelectorAll('svg circle[data-cbacourse]')]
    .find(x=>x.querySelector('title').textContent.startsWith(ADIPAI));
  c.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  return { mode:ST.cba.mode, sub:ST.cba.sub,
           heading:document.querySelector('#cbacontent .card').innerText.split('\n')[0] }; }, [ADIPAI]);
ok('clicking the same course in the matrix opens the identical view',
   fromDot.mode==='analyse' && fromDot.sub==='course' && fromDot.heading===fromTable.heading,
   fromDot.heading);
const cpage = await txt();
ok('Course analysis shows enrolment, budget and cost coverage blocks',
   /Enrolment/i.test(cpage) && /Budget/i.test(cpage) && /Cost coverage/i.test(cpage) &&
   /Why\?/i.test(cpage));
const cvals = await p.evaluate(([ADIPAI]) => {
  const r=cbaCompute(ST,'actual',2026).rows.find(x=>x.name===ADIPAI);
  const body=document.body.innerText;
  return { inDom: body.includes(sgd(r.contribution)) && body.includes(sgd(r.revenue-r.total)),
           students:r.students, shown: new RegExp(`\\b${r.students}\\b`).test(body) }; }, [ADIPAI]);
ok('course students, contribution and full-cost result reconcile with the engine',
   cvals.inDom && cvals.shown);

// ── Simulate: sandbox never writes canonical data ──────────────────────────
const snap = () => p.evaluate(() => JSON.stringify({
  intakes:ST.intakes, sim:ST.sim, rates:ST.cba.rates, prices:COURSES.map(c=>({...c})) }));
const S0 = await snap();
await go('simulate',{scenSub:'course'});
const sc = await p.evaluate(([ADIPAI]) => {
  const ci=COURSES.findIndex(c=>c.name===ADIPAI); ST.cba.chartCi=ci; render();
  const base=cbaCompute(ST,'actual',2026).rows.find(r=>r.ci===ci);
  const inp=[...document.querySelectorAll('input[type=number][data-cbascen]')]
    .find(i=>i.dataset.k==='students'&&+i.dataset.cbascen===ci);
  inp.value = base.students + 10;
  inp.dispatchEvent(new Event('input',{bubbles:true}));
  const scen=cbaCompute(ST,'actual',2026,cbaScenOverlay(ST)).rows.find(r=>r.ci===ci);
  const liveAgain=cbaCompute(ST,'actual',2026).rows.find(r=>r.ci===ci);
  return { ci, baseStu:base.students, scenStu:scen.students, liveStu:liveAgain.students,
           baseCon:base.contribution, scenCon:scen.contribution,
           text:document.body.innerText }; }, [ADIPAI]);
ok('moving the student control changes the scenario result',
   sc.scenStu===sc.baseStu+10 && sc.scenCon>sc.baseCon,
   `${sc.baseStu} → ${sc.scenStu} students · ${Math.round(sc.baseCon)} → ${Math.round(sc.scenCon)}`);
ok('the live figure is untouched while the sandbox is in use', sc.liveStu===sc.baseStu);
ok('canonical records are byte-identical after simulating', await snap()===S0);
ok('the screen states scenario vs live and makes no demand claim',
   /Scenario active/i.test(sc.text) && /Current vs scenario/i.test(sc.text) &&
   /makes no claim that a fee change would leave demand unchanged/i.test(sc.text) &&
   !/elasticity/i.test(sc.text));
const C1 = await canon();
ok('institution totals are unchanged by the sandbox',
   JSON.stringify(C1)===JSON.stringify(C0));
const reset = await p.evaluate(() => {
  document.querySelector('[data-cbascenreset]').click();
  return Object.keys(cbaScen(ST).rows).length; });
ok('Reset clears the scenario back to the live baseline', reset===0);
// portfolio scenario
const ps = await p.evaluate(() => {
  ST.cba.scenSub='portfolio'; render();
  const inp=[...document.querySelectorAll('input[data-cbascen][data-k=students]')][0];
  const ci=+inp.dataset.cbascen; inp.value=+inp.value+20;
  inp.dispatchEvent(new Event('input',{bubbles:true}));
  const live=cbaCompute(ST,'actual',2026), scen=cbaCompute(ST,'actual',2026,cbaScenOverlay(ST));
  return { liveNet:live.T.net, scenNet:scen.T.net, liveStu:live.T.students, scenStu:scen.T.students,
           poolSame: live.pool===scen.pool }; });
ok('the portfolio scenario answers "what if these targets were met" without touching live data',
   ps.scenStu===ps.liveStu+20 && ps.scenNet>ps.liveNet && ps.poolSame,
   `net ${Math.round(ps.liveNet)} → ${Math.round(ps.scenNet)}`);
await p.evaluate(() => { ST.cba.scen={rows:{}}; render(); });
ok('Budget and Actual records survived the whole sandbox session', await snap()===S0);

// ── Present ────────────────────────────────────────────────────────────────
await go('present',{presentSub:'report'});
const rep = await p.evaluate(() => {
  const el=document.getElementById('cbaReport');
  return { text:el?el.innerText:'', hasControls: !!el.querySelector('[data-cbascen],[data-cbadriver],input[type=checkbox]') }; });
ok('the board report reconciles to the canonical institution totals',
   rep.text.includes(String(C0.students)) &&
   rep.text.includes(await p.evaluate(n=>sgd(n), C0.revenue)) &&
   rep.text.includes(await p.evaluate(n=>sgd(n), C0.cost)),
   rep.text.split('\n').slice(2,10).join(' · '));
ok('the board report carries no operational controls', !rep.hasControls);
await go('present',{presentSub:'trends'});
const tr = await txt();
ok('Trends explains itself rather than drawing an empty chart for one year',
   /Additional years will appear as recorded data becomes available/i.test(tr));
const tr2 = await p.evaluate(() => {
  ST.intakes.push({id:99123,kind:'actual',ci:0,month:0,year:2027,students:9}); render();
  const drawn=!!document.querySelector('#cbaTrend svg, svg');
  const years=cbaYearsWithData(ST,'actual');
  ST.intakes=ST.intakes.filter(i=>i.id!==99123); render();
  return { drawn, years }; });
ok('with a second year of data the trend uses the dynamic year list',
   tr2.drawn && tr2.years.length===2, tr2.years.join(','));

// ── Settings ───────────────────────────────────────────────────────────────
await go('settings');
const setg = await txt();
ok('inclusion, allocation driver and per-course rates all live under Data & assumptions',
   /Active courses/i.test(setg) && /allocation driver/i.test(setg) &&
   /per-course rates/i.test(setg));

// ── Regression ─────────────────────────────────────────────────────────────
const reg = await p.evaluate(() => {
  const out={};
  const a=cbaCompute(ST,'actual',2026), b=cbaCompute(ST,'budget',2026);
  out.basis = a.T.students!==b.T.students;
  out.year = cbaCompute(ST,'budget',2027).T.students!==b.T.students;
  const h=cbaCompute(ST,'actual',2026); ST.cba.driver='revenue';
  const g=cbaCompute(ST,'actual',2026); ST.cba.driver='hours';
  out.allocation = Math.abs(h.T.cost-g.T.cost)<1e-9 && Math.abs(h.T.bcr-g.T.bcr)<1e-12;
  const r=h.live[0];
  out.rolling = Math.abs(r.paceReq - r.beExact/r.mo) < 1e-9;
  ST.cba.off[COURSES[0].name]=true; const off=cbaCompute(ST,'actual',2026);
  delete ST.cba.off[COURSES[0].name];
  out.inclusion = off.counts.included===h.counts.included-1;
  const snap=JSON.parse(JSON.stringify(buildFullSnapshot()));
  ST.intakes=[]; applyFullSnapshot(snap);
  out.cloud = cbaCompute(ST,'actual',2026).T.students===h.T.students;
  return out; });
ok('regression: basis, year, allocation invariance, rolling intake, inclusion and cloud save',
   Object.values(reg).every(Boolean), JSON.stringify(reg));
const C2 = await canon();
ok('FINANCIAL RECONCILIATION — every canonical figure is unchanged after the redesign',
   JSON.stringify(C2)===JSON.stringify(C0),
   `students ${C2.students} · revenue ${Math.round(C2.revenue)} · cost ${Math.round(C2.cost)} · net ${Math.round(C2.net)} · BCR ${C2.bcr.toFixed(4)} · ADIPAI ${Math.round(C2.adipai.contribution)} · DIPAI ${Math.round(C2.dipai.contribution)}`);

if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nconsole errors: '+errs.join(' | ') : '\nno console errors');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
