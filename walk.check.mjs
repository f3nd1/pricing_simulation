/* The real user journey, driven through the rendered UI: Manage → Analyse
   (Portfolio / Course / Compare) → Simulate → Present, plus print media,
   accessibility and a financial reconciliation either side of the walk.
   node walk.check.mjs -> non-zero exit on failure. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage();
await p.setViewportSize({ width:1440, height:1100 });
const fails = [], errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (t,c,x='') => { console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`); if(!c) fails.push(t); };

await p.goto('file://' + process.cwd() + '/ucc_budget_simulator.html');
const F = await p.evaluate(() => {
  const prices = COURSES.map(c=>({...c}));
  const intakes=[]; let id=1;
  for (let ci=0; ci<6; ci++) {
    intakes.push({id:id++,kind:'budget',ci,month:0,year:2026,students:18});
    intakes.push({id:id++,kind:'actual',ci,month:0,year:2026,students:12}); }
  intakes.push({id:id++,kind:'actual',ci:6,month:0,year:2026,students:15});   /* no budget */
  intakes.push({id:id++,kind:'budget',ci:7,month:0,year:2026,students:9});    /* no actual */
  localStorage.setItem('ucc_sim_v4', JSON.stringify({ prices, intakes, ybYear:2026, module:'cba',
    cba:{driver:'hours',off:{},rates:{},def:{},basis:'actual',otherRev:[]} }));
  localStorage.setItem('ucc_unlocked','ucc2026');
  return { A:prices[0].name, B:prices[6].name, C:prices[7].name };
});
await p.reload(); await p.waitForTimeout(500);

const txt = () => p.evaluate(() => document.body.innerText);
const state = () => p.evaluate(() => ({mode:ST.cba.mode,sub:ST.cba.sub,ci:ST.cba.chartCi}));
const click = sel => p.evaluate(([sel]) => {
  const el=document.querySelector(sel); if(!el) return false;
  el.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; }, [sel]);
/* the canonical figures, captured before and after the whole walk */
const canon = () => p.evaluate(() => {
  const d=cbaCompute(ST,'actual',2026);
  return { T:{s:d.T.students,rev:d.T.benefit,cost:d.T.cost,con:d.T.contribution,net:d.T.net,bcr:d.T.bcr},
           rows:d.relevant.map(r=>[r.name,r.students,r.reqPeriod,r.contribution,
                                   r.revenue-r.total,r.bcr,r.verdict.label]) }; });
const C0 = await canon();

// ── MANAGE ────────────────────────────────────────────────────────────────
let t = await txt();
ok('Manage lands on relevant courses, not all configured',
   await p.evaluate(() => cbaScope(ST)==='relevant') && /Relevant courses \(8\)/.test(t),
   (t.match(/Relevant courses \(\d+\)[\s\S]{0,40}/)||[''])[0].replace(/\n+/g,' · '));
ok('the same metric is called the same thing on Manage as on Portfolio',
   /Courses helping UCC/i.test(t) && !/Positive contributors/i.test(t));
for (const basis of ['budget','actual']) {
  for (const view of ['simple','advanced']) {
    const n = await p.evaluate(([basis,view]) => { ST.cba.basis=basis; ST.cba.view=view; render();
      return document.querySelectorAll('tr[data-cbarow]').length; }, [basis,view]);
    if (n !== 8) fails.push(`Manage ${basis}/${view} showed ${n} rows`);
  }
}
ok('every relevant course survives all four Budget/Actual × Simple/Advanced combinations',
   !fails.some(f=>/^Manage /.test(f)), '8 rows in each');
await p.evaluate(() => { ST.cba.basis='actual'; ST.cba.view='simple'; render(); });
const allCfg = await p.evaluate(() => { ST.cba.scope='all'; render();
  const n=document.querySelectorAll('tr[data-cbarow]').length; ST.cba.scope='relevant'; render(); return n; });
ok('All configured is available as an explicit choice', allCfg===36, `${allCfg} rows`);
ok('CBA inclusion is labelled as an analysis setting, not as activity',
   /CBA analysis: ✅ Included/.test(await txt()));

// ── ANALYSE → PORTFOLIO ───────────────────────────────────────────────────
await p.evaluate(() => { ST.cba.mode='analyse'; ST.cba.sub='portfolio'; render(); });
const barHover = await p.evaluate(() => {
  const g=document.querySelector('#cbaContribChart g.b');
  g.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true,clientX:300,clientY:300}));
  const tip=document.querySelector('.cb-tip.on');
  const lit=document.querySelectorAll('tr.cb-row-on').length;
  g.dispatchEvent(new MouseEvent('mouseleave',{bubbles:true}));
  return { tip:!!tip, lit }; });
ok('hovering a contribution bar shows its card and lights its table row',
   barHover.tip && barHover.lit===1);
await p.evaluate(() => { const g=document.querySelector('#cbaContribChart g.b');
  g.dispatchEvent(new MouseEvent('click',{bubbles:true})); });
ok('clicking a bar opens Analyse → Course', JSON.stringify(await state()).includes('"sub":"course"'));

// ── MATRIX ────────────────────────────────────────────────────────────────
await p.evaluate(() => { ST.cba.mode='manage'; render(); });
const m = await p.evaluate(() => {
  const pts=[...document.querySelectorAll('#cbaMatrix g.pt')];
  const before={mode:ST.cba.mode,sub:ST.cba.sub};
  pts[1].dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:500,clientY:400}));
  const tip=document.querySelector('.cb-tip.on');
  const tipTxt=tip?tip.innerText.replace(/\n/g,' | '):null;
  const faded=pts.filter(x=>x.style.opacity&&+x.style.opacity<1).length;
  const rowLit=document.querySelectorAll('tr.cb-row-on').length;
  const label=pts[1].querySelector('text.lb');
  const labelShown=label?+label.getAttribute('opacity')===1:false;
  pts[1].dispatchEvent(new MouseEvent('click',{bubbles:true}));
  return { before, tipTxt, faded, rowLit, labelShown,
           after:{mode:ST.cba.mode,sub:ST.cba.sub,ci:ST.cba.chartCi},
           positions:new Set(pts.map(x=>x.getAttribute('transform'))).size, n:pts.length }; });
ok('every matrix point identifies itself on hover with the full decision set',
   !!m.tipTxt && /Students/.test(m.tipTxt) && /Operating requirement/.test(m.tipTxt) &&
   /After own costs/.test(m.tipTxt) && /Full-cost result/.test(m.tipTxt) && /Coverage/.test(m.tipTxt),
   m.tipTxt);
ok('hovering fades the others, reveals that point\'s label and lights its row',
   m.faded>0 && m.labelShown && m.rowLit===1, `${m.faded} faded · row lit ${m.rowLit}`);
ok('clicking a matrix point actually navigates to Analyse → Course',
   m.after.mode==='analyse' && m.after.sub==='course' && m.before.mode==='manage',
   `${m.before.mode} → ${m.after.mode}/${m.after.sub}`);
ok('overlapping courses keep distinct, individually selectable positions',
   m.positions===m.n, `${m.positions} positions for ${m.n} points`);
const opened = await p.evaluate(() => document.querySelector('#cbacontent .cb-sec div').innerText.split('\n')[0]);
ok('the opened course page uses the full course name', opened.length>10, opened);

// ── ANALYSE → COURSE ──────────────────────────────────────────────────────
const course = await p.evaluate(() => {
  const sel=document.getElementById('cbaCourseSel');
  sel.value=String(COURSES.length-30); sel.dispatchEvent(new Event('change',{bubbles:true}));
  const det=[...document.querySelectorAll('details')].find(x=>/drivers behind/i.test(x.innerText));
  return { switched:ST.cba.chartCi===COURSES.length-30, whyCollapsed:!!det&&!det.open }; });
ok('a different course can be selected and Why? stays collapsed by default',
   course.switched && course.whyCollapsed);
await click('[data-cbasimulate]');
ok('Simulate from the course page lands in the sandbox on that course',
   JSON.stringify(await state()).includes('"mode":"simulate"'));

// ── ANALYSE → COMPARE ─────────────────────────────────────────────────────
await p.evaluate(() => { ST.cba.mode='analyse'; ST.cba.sub='compare'; ST.cba.compare=[]; render(); });
let cmp = await p.evaluate(() => {
  const panel=document.querySelector('#cbacontent .cb-panel');
  return { heading:panel?panel.innerText.split('\n')[0]:null,
           picks:document.querySelectorAll('[data-cbacmp]').length,
           cols:document.querySelectorAll('#cbacontent thead th').length,
           search:!!document.getElementById('cbaCmpQ'),
           bars:/At a glance/.test(document.body.innerText) }; });
ok('Compare renders its own view — the tab is no longer dead',
   /compare courses/i.test(cmp.heading||'') && cmp.picks>0 && cmp.search, cmp.heading);
ok('Compare defaults to two courses, with comparison bars',
   cmp.cols===3 && cmp.bars, `${cmp.cols-1} courses compared`);
const add = await p.evaluate(() => {
  const btns=[...document.querySelectorAll('[data-cbacmp]')].filter(b2=>!b2.disabled);
  const notPicked=btns.find(b2=>!b2.innerText.startsWith('✓'));
  notPicked.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  return ST.cba.compare.length; });
ok('a third course can be added', add===3, `${add} selected`);
const cap = await p.evaluate(() => {
  const btns=[...document.querySelectorAll('[data-cbacmp]')];
  const notPicked=btns.find(b2=>!b2.innerText.startsWith('✓')&&!b2.disabled);
  if(notPicked) notPicked.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  const after=ST.cba.compare.length;
  const blocked=[...document.querySelectorAll('[data-cbacmp]')].some(b2=>b2.disabled);
  return { after, blocked }; });
ok('the maximum of four is enforced and the extra choices are disabled, not silent',
   cap.after===4 && cap.blocked, `${cap.after} selected`);
const rm = await p.evaluate(() => {
  const picked=[...document.querySelectorAll('[data-cbacmp]')].find(b2=>b2.innerText.startsWith('✓'));
  picked.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  return ST.cba.compare.length; });
ok('a course can be removed again', rm===3);
const cmpOpen = await p.evaluate(() => {
  const a=document.querySelector('#cbacontent thead a[data-cbacourse]');
  a.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  return {mode:ST.cba.mode,sub:ST.cba.sub}; });
ok('clicking a compared course opens Analyse → Course',
   cmpOpen.mode==='analyse' && cmpOpen.sub==='course');

// ── SIMULATE ──────────────────────────────────────────────────────────────
const snapshot = () => p.evaluate(() => JSON.stringify({
  intakes:ST.intakes, rates:ST.cba.rates, prices:COURSES.map(c=>({...c})), sim:ST.sim }));
const S0 = await snapshot();
await p.evaluate(() => { ST.cba.mode='simulate'; ST.cba.scenSub='course'; ST.cba.scen={rows:{}}; render(); });
const sim = await p.evaluate(() => {
  const base=cbaCompute(ST,'actual',2026).T.net;
  document.querySelector('[data-cbapreset="stu5"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));
  const after=cbaCompute(ST,'actual',2026,cbaScenOverlay(ST)).T.net;
  const banner=[...document.querySelectorAll('.cb-panel')].find(x=>/Scenario impact/i.test(x.innerText));
  return { base, after, banner:banner?banner.innerText.replace(/\n/g,' | '):null,
           chip:/Scenario active/i.test(document.body.innerText),
           reset:!!document.querySelector('[data-cbascenreset]') }; });
ok('+5 students moves the scenario and the impact is stated above the table, not buried',
   sim.after>sim.base && !!sim.banner && /\$/.test(sim.banner), sim.banner);
ok('an active scenario is announced with a reset control', sim.chip && sim.reset);
await p.evaluate(() => { document.querySelector('[data-cbapreset="comm5"]').dispatchEvent(new MouseEvent('click',{bubbles:true})); });
await click('[data-cbascenreset]');
ok('Reset returns to live and the canonical records were never touched',
   await p.evaluate(() => Object.keys(cbaScen(ST).rows).length===0) && await snapshot()===S0);
const portScen = await p.evaluate(() => {
  ST.cba.scenSub='portfolio'; render();
  const inp=document.querySelector('input[data-cbascen][data-k=students]');
  inp.value=+inp.value+10; inp.dispatchEvent(new Event('input',{bubbles:true}));
  const live=cbaCompute(ST,'actual',2026), scen=cbaCompute(ST,'actual',2026,cbaScenOverlay(ST));
  const out={ d:scen.T.students-live.T.students, better:scen.T.net>live.T.net };
  ST.cba.scen={rows:{}}; render(); return out; });
ok('the whole-portfolio scenario answers the target question without touching live data',
   portScen.d===10 && portScen.better && await snapshot()===S0);

// ── PRESENT ───────────────────────────────────────────────────────────────
await p.evaluate(() => { ST.cba.mode='present'; ST.cba.presentSub='report'; render(); });
await p.emulateMedia({ media:'print' });
const print = await p.evaluate(() => {
  const hidden = sel => [...document.querySelectorAll(sel)]
    .every(el=>getComputedStyle(el).display==='none');
  const rep=document.getElementById('cbaReport');
  return { chrome: hidden('.hdr') && hidden('.module-nav') && hidden('.cb-sticky') &&
                   hidden('.view-toggle') && hidden('button'),
           report: getComputedStyle(rep).display!=='none',
           notes: [...rep.querySelectorAll('details div')].every(x=>getComputedStyle(x).display!=='none'),
           bg: getComputedStyle(document.body).backgroundColor }; });
ok('print hides every control and keeps only the report',
   print.chrome && print.report, JSON.stringify(print).slice(0,110));
ok('print expands the methodology notes and prints on white',
   print.notes && /rgb\(255, 255, 255\)|rgba\(0, 0, 0, 0\)/.test(print.bg));
await p.emulateMedia({ media:'screen' });
await p.evaluate(() => { ST.cba.presentSub='trends'; render(); });
const tr = await txt();
ok('Trends shows a deliberate one-year state, not an empty chart',
   /Trend data will appear here/i.test(tr) &&
   !(await p.evaluate(() => !!document.querySelector('#cbacontent svg'))));

// ── ACCESSIBILITY ─────────────────────────────────────────────────────────
await p.evaluate(() => { ST.cba.mode='manage'; render(); });
const a11y = await p.evaluate(() => {
  const pts=[...document.querySelectorAll('#cbaMatrix g.pt')];
  const hits=[...document.querySelectorAll('#cbaMatrix g.pt circle.hit')];
  const before={mode:ST.cba.mode};
  hits[0].focus();
  const focused=document.activeElement===hits[0];
  const tipOnFocus=!!document.querySelector('.cb-tip.on');
  hits[0].dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  return { focused, tipOnFocus,
           labels:hits.every(x=>x.getAttribute('aria-label')) && pts.every(x=>x.getAttribute('aria-label')),
           navigated:ST.cba.mode==='analyse', before }; });
ok('matrix points are keyboard reachable, describe themselves and activate with Enter',
   a11y.focused && a11y.tipOnFocus && a11y.labels && a11y.navigated, JSON.stringify(a11y));

// ── FINANCIAL LOCK ────────────────────────────────────────────────────────
const C1 = await canon();
ok('FINANCIAL RECONCILIATION — nothing moved across the whole walkthrough',
   JSON.stringify(C1)===JSON.stringify(C0),
   `students ${C1.T.s} · revenue ${Math.round(C1.T.rev)} · net ${Math.round(C1.T.net)} · BCR ${C1.T.bcr.toFixed(4)} · ${C1.rows.length} relevant courses`);

if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nconsole errors: '+errs.join(' | ') : '\nno console errors');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
