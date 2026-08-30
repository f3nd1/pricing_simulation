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
const sticky = await p.evaluate(() => {
  const el=document.querySelector('.cb-sticky');
  return el?{txt:el.innerText.replace(/\n+/g,' · '),pos:getComputedStyle(el).position}:null; });
ok('a sticky context bar carries year, basis, view, modes and the counts',
   !!sticky && sticky.pos==='sticky' && /2026/.test(sticky.txt) && /Actual/.test(sticky.txt) &&
   /Simple/.test(sticky.txt) && /relevant courses/i.test(sticky.txt) && /configured/.test(sticky.txt) &&
   /Manage/.test(sticky.txt), sticky && sticky.txt.slice(0,120));
ok('Simple is the default view and hides the finance columns',
   await p.evaluate(() => !cbaAdv(ST)) && !/\bBCR\b/.test(t) && /After own costs/.test(t));

// ── Manage: four headline metrics reconcile ────────────────────────────────
const head = await p.evaluate(() => {
  const cards=[...document.querySelectorAll('.cb-strip > div')].slice(0,4)
    .map(c=>({lbl:c.querySelector('.k').innerText.trim(),
              val:c.querySelector('.v').innerText.trim()}));
  const H=cbaHeadline(ST,cbaCompute(ST));
  return {cards,H}; });
ok('Manage shows exactly four headline cards: students, P&L, helping, gap',
   head.cards.length===4 && /students/i.test(head.cards[0].lbl) &&
   /(profit|loss)/i.test(head.cards[1].lbl) && /helping/i.test(head.cards[2].lbl) &&
   /gap/i.test(head.cards[3].lbl), head.cards.map(c=>`${c.lbl} ${c.val}`).join(' · '));
ok('the headline numbers reconcile to the canonical totals',
   head.cards[0].val===await p.evaluate(n=>cbaN(n), C0.students) &&
   head.cards[1].val===await p.evaluate(n=>cbaK(Math.abs(n)), C0.net),
   `${head.cards[0].val} students · ${head.cards[1].val}`);
const whyTxt = await p.evaluate(() => { ST.cba.showWhy=true; render();
  const s=document.body.innerText; ST.cba.showWhy=false; render(); return s; });
ok('the long explanation is behind Why?, not on the page by default',
   !/analysed course[s]? contribute/i.test(t) &&
   new RegExp(`${C0.counts.both} analysed course`).test(whyTxt.replace(/\s+/g,' ')),
   (whyTxt.match(/Income of [^]*?%[^.]*\./)||[''])[0].slice(0,110));
const mtx = await p.evaluate(() => {
  const pts=[...document.querySelectorAll('#cbaMatrix g.pt')];
  return { n:pts.length, focusable:[...document.querySelectorAll('#cbaMatrix g.pt circle.hit')].every(c=>c.getAttribute('tabindex')==='0'),
           labelled:[...document.querySelectorAll('#cbaMatrix text.lb')].filter(t=>+t.getAttribute('opacity')===1).length,
           axes:document.getElementById('cbaMatrix').innerHTML };
});
ok('the action matrix draws one focusable point per analysed course',
   mtx.n===C0.counts.both && mtx.focusable, `${mtx.n} points`);
ok('the matrix states the relevant total and how many are plotted',
   /Relevant courses \d+ · plotted \d+/i.test(await txt()));
ok('some points are labelled by default, so no dot is anonymous', mtx.labelled>=1, `${mtx.labelled} labelled`);
ok('the axes are in plain English with the break-even lines shown',
   /Losing on the course/.test(mtx.axes) && /Helping UCC/.test(mtx.axes) &&
   /AFTER OWN COSTS/.test(mtx.axes) && /Above/.test(mtx.axes) && /Below/.test(mtx.axes) &&
   /GROW/.test(mtx.axes) && /REVIEW/.test(mtx.axes));
const overlap = await p.evaluate(() => {
  const pts=[...document.querySelectorAll('#cbaMatrix g.pt')]
    .map(g=>g.getAttribute('transform'));
  return { n:pts.length, unique:new Set(pts).size,
           titles:[...document.querySelectorAll('#cbaMatrix g.pt > title')].length }; });
ok('overlapping courses are nudged apart so each stays selectable, each with a name',
   overlap.unique===overlap.n && overlap.titles===overlap.n,
   `${overlap.unique} distinct positions for ${overlap.n} points`);
const hov = await p.evaluate(([ADIPAI]) => {
  const g=[...document.querySelectorAll('#cbaMatrix g.pt')]
    .find(x=>x.getAttribute('aria-label').startsWith(ADIPAI));
  g.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:400,clientY:400}));
  const tip=document.querySelector('.cb-tip.on');
  const dimmed=[...document.querySelectorAll('#cbaMatrix g.pt')].filter(x=>x.style.opacity&&+x.style.opacity<1).length;
  return { text:tip?tip.innerText.replace(/\n/g,' | '):null, dimmed }; }, [ADIPAI]);
ok('hovering a point shows the full tooltip and dims the others',
   !!hov.text && /advanced diploma in applied ai/i.test(hov.text) &&
   /Students/.test(hov.text) && /Minimum needed/.test(hov.text) &&
   /After own costs/.test(hov.text) && /Full-cost result/.test(hov.text) &&
   /Coverage/.test(hov.text) && hov.dimmed>0, `dimmed ${hov.dimmed} · `+hov.text);
ok('Management attention still splits needs-attention from opportunities',
   /needs attention/i.test(t) && /opportunities/i.test(t));

const noDismiss = await p.evaluate(() => ({
  x: document.querySelectorAll('[data-cbadismiss],[data-cbaundismiss],[data-cbashowdis],[data-cbarestoreall]').length,
  txt: document.body.innerText }));
ok('Management attention has no dismiss, no Dismissed (n) and no restore',
   noDismiss.x===0 && !/dismiss/i.test(noDismiss.txt), `${noDismiss.x} dismissal controls`);
ok('Show all / Show fewer remains as presentation-only expansion',
   await p.evaluate(() => { const b2=document.querySelector('[data-cbashowall]');
     if(!b2) return true; const before=document.querySelectorAll('.cb-ins').length;
     b2.click(); const after=document.querySelectorAll('.cb-ins').length;
     document.querySelector('[data-cbashowall]').click();
     return after>=before; }));

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
  const rowNames=[...document.querySelectorAll('tr[data-cbarow] .cb-name')].map(a=>a.title||a.innerText);
  const dots=[...document.querySelectorAll('#cbaContribChart g.b')].map(g=>d.live.find(r=>g.getAttribute('aria-label').startsWith(r.name+',')).ci);
  return { rowNames, dots, live:d.live.map(r=>r.ci), hasADIPAI:rowNames.includes(ADIPAI) }; }, [ADIPAI]);
ok('the portfolio chart and the single table use the same course population',
   port.dots.every(ci=>port.live.includes(ci)) && port.dots.length===port.live.length &&
   port.hasADIPAI, `${port.dots.length} bars · ${port.live.length} analysed`);
const oneTable = await p.evaluate(() => document.querySelectorAll('#cbacontent table').length);
ok('Portfolio shows exactly one course table, not two', oneTable===1, `${oneTable} tables`);
const linked = await p.evaluate(([ADIPAI]) => {
  const d=cbaCompute(ST);
  const ci=d.live.find(r=>r.name===ADIPAI).ci;
  const bar=[...document.querySelectorAll('#cbaContribChart g.b')]
    .find(g=>g.getAttribute('aria-label').startsWith(ADIPAI));
  bar.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
  const rowLit=!!document.querySelector(`tr[data-cbarow="${ci}"].cb-row-on`);
  bar.dispatchEvent(new MouseEvent('mouseleave',{bubbles:true}));
  const tr=document.querySelector(`tr[data-cbarow="${ci}"]`);
  tr.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
  const dimmed=[...document.querySelectorAll('#cbaContribChart g.b rect.bar')]
    .filter(r=>+r.getAttribute('fill-opacity')<0.5).length;
  tr.dispatchEvent(new MouseEvent('mouseleave',{bubbles:true}));
  return { rowLit, dimmed }; }, [ADIPAI]);
ok('hovering a bar highlights its row, and hovering a row highlights its bar',
   linked.rowLit && linked.dimmed>0, JSON.stringify(linked));
const shared = await p.evaluate(() => document.body.innerText);
ok('shared costs are one segmented bar plus one line, not a paragraph',
   /Shared UCC costs/i.test(shared) && /covers \d+% of shared costs/i.test(shared),
   (shared.match(/Course contribution currently covers[^.]*\./)||[''])[0]);
const search = await p.evaluate(() => { ST.cba.q='Applied'; render();
  return [...document.querySelectorAll('tr[data-cbarow] .cb-name')].map(a=>a.title||a.innerText); });
ok('portfolio search filters the table and the visual together',
   search.length>0 && search.every(n=>/Applied/i.test(n)), search.join(' · '));
await p.evaluate(() => { ST.cba.q=''; render(); });

/* clicking a course anywhere lands on the same Course analysis */
const fromTable = await p.evaluate(([ADIPAI]) => {
  const a=[...document.querySelectorAll('tr[data-cbarow]')].find(x=>x.innerText.includes(ADIPAI));
  a.dispatchEvent(new MouseEvent('click',{bubbles:true})); return { mode:ST.cba.mode, sub:ST.cba.sub, ci:ST.cba.chartCi,
                      heading:document.querySelector('#cbacontent .cb-sec div').innerText.split('\n')[0] }; }, [ADIPAI]);
ok('clicking a course in the table opens Course analysis',
   fromTable.mode==='analyse' && fromTable.sub==='course' && fromTable.heading.includes(ADIPAI),
   fromTable.heading);
await go('manage');
const fromDot = await p.evaluate(([ADIPAI]) => {
  const c=[...document.querySelectorAll('#cbaMatrix g.pt')]
    .find(x=>x.getAttribute('aria-label').startsWith(ADIPAI));
  c.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  return { mode:ST.cba.mode, sub:ST.cba.sub,
           heading:document.querySelector('#cbacontent .cb-sec div').innerText.split('\n')[0] }; }, [ADIPAI]);
ok('clicking the same course in the matrix opens the identical view',
   fromDot.mode==='analyse' && fromDot.sub==='course' && fromDot.heading===fromTable.heading,
   fromDot.heading);
const cpage = await txt();
ok('Course analysis shows enrolment, budget and cost coverage blocks plus a waterfall',
   /Enrolment/i.test(cpage) && /Budget/i.test(cpage) && /Cost coverage/i.test(cpage) &&
   /Money flow/i.test(cpage) && /Why\?/i.test(cpage));
ok('the drivers stay collapsed by default',
   await p.evaluate(() => { const d=[...document.querySelectorAll('details')]
     .find(x=>/drivers behind/i.test(x.innerText)); return !!d && !d.open; }));
const cvals = await p.evaluate(([ADIPAI]) => {
  const r=cbaCompute(ST,'actual',2026).rows.find(x=>x.name===ADIPAI);
  const body=document.body.innerText;
  return { inDom: body.includes(cbaK(r.contribution)) && body.includes(sgd(r.contribution)),
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
ok('a compact chip states the live/scenario state and no demand claim is made',
   /Scenario active/i.test(sc.text) && /current vs scenario/i.test(sc.text) &&
   /makes no claim about how demand would respond/i.test(sc.text) &&
   !/elasticity|best case/i.test(sc.text));
const impact = await p.evaluate(() => {
  const el=[...document.querySelectorAll('.cb-panel')].find(x=>/Scenario impact/i.test(x.innerText));
  return el?el.innerText.replace(/\n/g,' | '):null; });
ok('a large impact banner states the change to the UCC full-cost result',
   !!impact && /[+-]?\$/.test(impact), impact);
const preset = await p.evaluate(() => {
  const before=cbaCompute(ST,'actual',2026,cbaScenOverlay(ST)).T.students;
  document.querySelector('[data-cbapreset="stu5"]').click();
  return { before, after:cbaCompute(ST,'actual',2026,cbaScenOverlay(ST)).T.students }; });
ok('presets apply a plain arithmetic step, nothing labelled best case',
   preset.after===preset.before+5, `${preset.before} → ${preset.after}`);
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
   rep.text.includes(await p.evaluate(n=>cbaN(n), C0.students)) &&
   rep.text.includes(await p.evaluate(n=>cbaK(n), C0.revenue)) &&
   rep.text.includes(await p.evaluate(n=>cbaK(n), C0.cost)),
   rep.text.split('\n').slice(2,10).join(' · '));
ok('the board report carries no operational controls', !rep.hasControls);
await go('present',{presentSub:'trends'});
const tr = await txt();
ok('Trends shows a compact baseline card, not an empty canvas',
   /Trend data will appear here/i.test(tr) && /begin year-over-year comparison/i.test(tr) &&
   !(await p.evaluate(() => !!document.querySelector('#cbacontent svg'))));
ok('the methodology sits behind Notes, not on the board slide',
   await p.evaluate(() => { ST.cba.presentSub='report'; render();
     const d=[...document.querySelectorAll('details')].find(x=>/methodology/i.test(x.innerText));
     return !!d && !d.open && !/recognised fee income after scholarship/i.test(
       document.getElementById('cbaReport').innerText.split('Notes')[0]); }));
await go('present',{presentSub:'trends'});
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

// ── polish pass: white workspace, fonts, precision, no page scroll ────────
await go('manage',{view:'simple'});
await p.evaluate(() => { const g=document.querySelector('#cbaMatrix g.pt');
  if(g) g.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:300,clientY:300})); });
const look = await p.evaluate(() => {
  const app=document.querySelector('.cb-app');
  const panel=document.querySelector('.cb-panel');
  const cs=getComputedStyle(app), ps=getComputedStyle(panel);
  const tip=document.querySelector('.cb-tip');
  const ts=getComputedStyle(tip), body=getComputedStyle(document.querySelector('.wrap'));
  return { app:cs.backgroundColor, panel:ps.backgroundColor,
           tipFont:ts.fontFamily, appFont:body.fontFamily,
           tipSize:ts.fontSize, headSize:getComputedStyle(document.querySelector('.cb-h')).fontSize };
});
ok('the Cost-Benefit workspace and its panels are white',
   look.app==='rgb(255, 255, 255)' && look.panel==='rgb(255, 255, 255)',
   `app ${look.app} · panel ${look.panel}`);
const fam=x=>String(x).split(',')[0].replace(/["']/g,'').trim().toLowerCase();
ok('the chart tooltip uses the application font, not the browser serif default',
   fam(look.tipFont)===fam(look.appFont) && !/(^|,)\s*serif/i.test(look.tipFont) &&
   parseFloat(look.tipSize)>=12,
   `${look.tipFont.split(',')[0]} ${look.tipSize}`);
ok('the type scale is consistent (section headings 15px+)',
   parseFloat(look.headSize)>=15, look.headSize);

/* no raw float may reach the screen, in any mode */
const floats = [];
for (const [m,extra] of [['manage',{}],['analyse',{sub:'portfolio'}],['analyse',{sub:'course'}],
                         ['analyse',{sub:'compare'}],['simulate',{scenSub:'course'}],
                         ['simulate',{scenSub:'portfolio'}],['present',{presentSub:'report'}],
                         ['present',{presentSub:'trends'}],['settings',{}]]) {
  for (const view of ['simple','advanced']) {
    await go(m, {...extra, view});
    const t2 = await txt();
    const bad = t2.match(/-?\d+\.\d{3,}/g);
    if (bad) floats.push(`${m}/${view}: ${bad.slice(0,3).join(', ')}`);
  }
}
await go('manage',{view:'simple'});
ok('no raw floating-point value appears anywhere in Cost-Benefit',
   floats.length===0, floats.join(' | ') || 'clean across 9 views × 2 modes');

/* the page itself must never scroll sideways on desktop */
const scrolls = [];
for (const w of [1440,1280]) {
  await p.setViewportSize({width:w,height:1000});
  for (const [m,extra] of [['manage',{}],['analyse',{sub:'portfolio'}],['analyse',{sub:'course'}],
                           ['simulate',{scenSub:'course'}],['present',{presentSub:'report'}]]) {
    await go(m,extra);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 0) scrolls.push(`${w} ${m}${extra.sub?'/'+extra.sub:''} +${over}`);
  }
}
await p.setViewportSize({width:1440,height:1100});
ok('no horizontal page scroll at 1440 or 1280 in any mode',
   scrolls.length===0, scrolls.join(' | ') || '1440 and 1280 clean');

/* every bar carries a readable label and a full name */
await go('analyse',{sub:'portfolio'});
const labels = await p.evaluate(() => {
  const bars=[...document.querySelectorAll('#cbaContribChart g.b')];
  return bars.map(g=>({txt:g.querySelector('text').textContent,
                       full:g.querySelector(':scope > title')?g.querySelector(':scope > title').textContent:null})); });
ok('every contribution bar has a readable label and its full name on hover',
   labels.length>0 && labels.every(l=>l.txt && l.txt.length>=4 && l.full && l.full.length>0),
   labels.slice(0,3).map(l=>l.txt).join(' · '));

if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nconsole errors: '+errs.join(' | ') : '\nno console errors');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
