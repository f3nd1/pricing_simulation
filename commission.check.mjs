/* Sales Commission: cliff banding, band validation, salary + commission
   arithmetic, persistence, and isolation from every other module.
   node commission.check.mjs -> non-zero exit on failure. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const errs=[], fails=[];
const ok=(t,c,x='')=>{console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`);if(!c)fails.push(t);};
const p=await b.newPage(); await p.setViewportSize({width:1440,height:1200});
p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+process.cwd()+'/ucc_budget_simulator.html');
await p.evaluate(()=>{
  const prices=COURSES.map(c=>({...c})); const intakes=[]; let id=1;
  [[0,24],[1,12]].forEach(([ci,n])=>{ for(let m=0;m<12;m++)
    intakes.push({id:id++,kind:'budget',ci,month:m,year:2026,students:n/12}); });
  localStorage.setItem('ucc_sim_v4',JSON.stringify({prices,intakes,ybYear:2026,module:'commission'}));
  localStorage.setItem('ucc_unlocked','ucc2026');});
await p.reload(); await p.waitForTimeout(400);

// ── cliff band selection, at and either side of a boundary ────────────────
const cliff = await p.evaluate(()=>{
  ST.comm.bands=[{from:0,to:3000,rate:3},{from:3000,to:null,rate:5}];
  const at=f=>{const b=commBandFor(ST,f);return {rate:commRateFor(ST,f),from:b&&b.from,to:b&&b.to};};
  return {below:at(2999.99), on:at(3000), above:at(3000.01), deep:at(8400), zero:at(0)};});
ok('a fee below the boundary earns the lower band rate', cliff.below.rate===3, JSON.stringify(cliff.below));
ok('a fee exactly ON the boundary belongs to the upper band, not both',
   cliff.on.rate===5 && cliff.on.from===3000, JSON.stringify(cliff.on));
ok('a fee just above the boundary earns the upper rate', cliff.above.rate===5);
ok('the whole fee earns one rate — bands are not sliced like tax brackets',
   await p.evaluate(()=>{
     const fee=8400, whole=fee*commRateFor(ST,fee)/100;
     const sliced=3000*0.03+(fee-3000)*0.05;
     const line=commMonthLines(ST,1,2026,0);
     return Math.abs(whole-fee*0.05)<1e-9 && Math.abs(whole-sliced)>1;}),
   'cliff 5% of the whole fee, not 3% then 5%');
ok('a zero-fee course still resolves to the band containing zero', cliff.zero.rate===3);

// ── a fee outside every band ─────────────────────────────────────────────
const outside = await p.evaluate(()=>{
  ST.comm.bands=[{from:5000,to:6000,rate:4}];
  const r=commRateFor(ST,1000), band=commBandFor(ST,1000);
  const iss=commBandIssues(ST);
  ST.module='commission'; ST.comm.year=2026; ST.comm.month=0;
  commAttribSet(ST,1,2026,0,0,10); render();
  const txt=document.getElementById('app').innerText;
  const line=commMonthLines(ST,1,2026,0).find(l=>l.ci===0);
  return {rate:r, band, uncovered:iss.uncovered.length, txt,
    lineRate:line?line.rate:null, lineComm:line?line.commission:null};});
ok('a fee outside every band earns 0% and is never given a fabricated rate',
   outside.rate===0 && outside.band===null && outside.lineRate===0 && outside.lineComm===0);
ok('uncovered fees are detected and reported on screen',
   outside.uncovered>0 && /outside every band/i.test(outside.txt),
   `${outside.uncovered} uncovered`);
ok('the 0% is shown as 0%, not blank or a dash', /0%/.test(outside.txt));

// ── band validation ──────────────────────────────────────────────────────
const val = await p.evaluate(()=>{
  const check=bands=>{ST.comm.bands=bands;const i=commBandIssues(ST);
    render();
    return {o:i.overlap.length,g:i.gap.length,inv:i.invalid.length,
            txt:document.getElementById('app').innerText};};
  return {
    overlap: check([{from:0,to:4000,rate:3},{from:3000,to:null,rate:5}]),
    gap:     check([{from:0,to:2000,rate:3},{from:3000,to:null,rate:5}]),
    invalid: check([{from:3000,to:1000,rate:3}]),
    clean:   check([{from:0,to:3000,rate:3},{from:3000,to:null,rate:5}])};});
ok('overlapping bands are detected and explained in words',
   val.overlap.o===1 && /overlap/i.test(val.overlap.txt), `${val.overlap.o} overlap`);
ok('a gap between bands is detected and explained',
   val.gap.g===1 && /gap between bands/i.test(val.gap.txt), `${val.gap.g} gap`);
ok('a band ending at or below its start is rejected',
   val.invalid.inv===1 && /ends at or below its start/i.test(val.invalid.txt));
ok('clean bands report continuous coverage instead of a warning',
   val.clean.o===0 && val.clean.g===0 && /continuous/i.test(val.clean.txt));

// ── salary + commission arithmetic ───────────────────────────────────────
const money = await p.evaluate(()=>{
  ST.comm.bands=[{from:0,to:3000,rate:3},{from:3000,to:null,rate:5}];
  ST.comm.people=[{id:1,name:'A',salary:3000,active:true},{id:2,name:'B',salary:2000,active:true}];
  ST.comm.nextId=3; ST.comm.attrib={}; ST.comm.base='gross'; ST.comm.timing='enrol';
  ST.comm.year=2026; ST.comm.month=0; ST.comm.spid=1;
  commAttribSet(ST,1,2026,0,0,10);          /* 10 enrolments of COURSES[0] in Jan */
  const c0=COURSES[0], fee=c0.fee, rate=commRateFor(ST,fee);
  const M=commMonthTotal(ST,1,2026,0);
  const expect=10*fee*rate/100;
  const Y=commYear(ST,1,2026), T=commTeamYear(ST,2026);
  return {fee,rate,commission:M.commission,expect,salary:M.salary,total:M.total,
    students:M.students, yearSalary:Y.salary, yearTotal:Y.total,
    teamTotal:T.total, teamSalary:T.salary,
    febEmpty:commMonthTotal(ST,1,2026,1).commission};});
ok('commission = enrolments × fee × band rate',
   Math.abs(money.commission-money.expect)<1e-9,
   `10 × ${money.fee} × ${money.rate}% = ${money.expect.toFixed(2)}`);
ok('monthly total = fixed salary + commission',
   Math.abs(money.total-(money.salary+money.commission))<1e-9,
   `${money.salary} + ${money.commission.toFixed(2)} = ${money.total.toFixed(2)}`);
ok('the enrolment count behind the figure is reported', money.students===10);
ok('a month with no attribution earns salary only', money.febEmpty===0);
ok('the year total is twelve months of salary plus the commission earned',
   Math.abs(money.yearSalary-money.salary*12)<1e-9 &&
   Math.abs(money.yearTotal-(money.salary*12+money.commission))<1e-9);
ok('the team row sums both salespeople',
   Math.abs(money.teamSalary-(3000+2000)*12)<1e-9 && money.teamTotal>money.yearTotal);

// ── base and timing toggles ──────────────────────────────────────────────
const toggles = await p.evaluate(()=>{
  const gross=commMonthTotal(ST,1,2026,0).commission;
  /* give this course a real discount so the toggle is genuinely exercised */
  ST.cba.rates[COURSES[0].name]={...(ST.cba.rates[COURSES[0].name]||{}),disc:20};
  ST.comm.base='net';
  const net=commMonthTotal(ST,1,2026,0).commission;
  const disc=Number(cbaRate(ST,COURSES[0],'disc'))||0;
  const expectNet=gross*(1-disc/100);
  ST.comm.base='gross';
  delete ST.cba.rates[COURSES[0].name];
  ST.comm.timing='spread';
  const mo=COURSES[0].mo;
  const spread=[0,1,mo-1,mo].map(m=>commMonthTotal(ST,1,2026,m).commission);
  const spreadYear=commYear(ST,1,2026).commission;
  ST.comm.timing='enrol';
  return {gross,net,disc,expectNet,spread,spreadYear,mo};});
ok('the net-of-discount toggle applies that course\'s discount to the fee',
   toggles.disc===20 && toggles.net<toggles.gross &&
   Math.abs(toggles.net-toggles.expectNet)<1e-9,
   `${toggles.gross.toFixed(2)} gross -> ${toggles.net.toFixed(2)} net at ${toggles.disc}%`);
ok('spreading divides one intake evenly across the course months and stops after them',
   Math.abs(toggles.spread[0]-toggles.gross/toggles.mo)<1e-9 &&
   Math.abs(toggles.spread[1]-toggles.spread[0])<1e-9 && toggles.spread[3]===0,
   `${toggles.mo} months`);
ok('spreading moves when the money lands, not how much of it there is',
   Math.abs(toggles.spreadYear-toggles.gross)<1e-6);

// ── boundary proximity ───────────────────────────────────────────────────
const bound = await p.evaluate(()=>{
  ST.comm.bands=[{from:0,to:3000,rate:3},{from:3000,to:null,rate:5}];
  const near=commBoundary(ST,2900), far=commBoundary(ST,8400);
  return {near,far};});
ok('a fee within 5% of a boundary is flagged, one further away is not',
   bound.near.near5pct===true && bound.far.near5pct===false,
   `2900 is ${bound.near.absDist} from ${bound.near.edge}`);
ok('the distance in dollars and the per-enrolment difference are both reported',
   bound.near.absDist===100 && Math.abs(bound.near.deltaPer-2900*0.02)<1e-9,
   `$${bound.near.absDist} away, ${bound.near.deltaPer.toFixed(2)} per enrolment`);

// ── seeding reads Yearly Budget without writing to it ────────────────────
const seed = await p.evaluate(()=>{
  ST.comm.attrib={}; ST.comm.spid=1; ST.comm.month=0; ST.comm.basis='budget'; render();
  const before=JSON.stringify(ST.intakes);
  document.querySelector('[data-commseed]').click();
  const after=JSON.stringify(ST.intakes);
  return {seeded:commAttribGet(ST,1,2026,0,0),
    yb:cbaEnrolBetween(ST,0,2026,'budget',0,0), intakesUnchanged:before===after};});
ok('seeding copies the Yearly Budget month total as a starting point',
   seed.seeded!=null && Math.abs(seed.seeded-seed.yb)<1e-9, `${seed.seeded} from ${seed.yb}`);
ok('seeding does not touch the Yearly Budget records', seed.intakesUnchanged);

// ── isolation: nothing here reaches any other module ─────────────────────
const iso = await p.evaluate(()=>{
  const snap=()=>{const d=cbaCompute(ST,'budget',2026),f=fcPnl(ST),yi=FC_YEARS.indexOf(2026);
    return JSON.stringify({cost:d.T.cost,benefit:d.T.benefit,net:d.T.net,bcr:d.T.bcr,
      pool:d.pool,direct:d.T.direct,cogs:f.cogs[yi],opex:f.opex[yi],
      fcNet:f.net[yi],intakes:ST.intakes.length,students:d.T.students});};
  const before=snap();
  ST.comm.bands=[{from:0,to:3000,rate:37},{from:3000,to:null,rate:91}];
  ST.comm.people[0].salary=999999;
  commAttribSet(ST,1,2026,3,5,500);
  render();
  const after=snap();
  const moved=commTeamYear(ST,2026).total;
  ST.comm.bands=[{from:0,to:3000,rate:3},{from:3000,to:null,rate:5}];
  ST.comm.people[0].salary=3000;
  return {same:before===after, moved};});
ok('changing rates, salary and attribution moves this module\'s totals', iso.moved>0);
ok('and moves Cost-Benefit, Forecast and Yearly Budget by exactly $0', iso.same);
ok('no commission line was written into the forecast expense arrays',
   await p.evaluate(()=>{
     const lbls=[...ST.fx.exp.cogs,...ST.fx.exp.opex].flatMap(g=>g.items.map(l=>l.label));
     return !lbls.some(l=>/sales commission|salesperson/i.test(l));}));

// ── persistence across a reload ──────────────────────────────────────────
await p.evaluate(()=>{
  ST.comm.people=[{id:1,name:'Persist Test',salary:4321,active:true}];
  ST.comm.bands=[{from:0,to:2500,rate:2.5},{from:2500,to:null,rate:7}];
  ST.comm.year=2026; ST.comm.month=3; ST.comm.base='net'; ST.comm.timing='spread';
  commAttribSet(ST,1,2026,2,3,7);
  saveToStorage();});
await p.reload(); await p.waitForTimeout(400);
const persisted = await p.evaluate(()=>({
  name:ST.comm.people[0].name, salary:ST.comm.people[0].salary,
  band:ST.comm.bands[1].rate, month:ST.comm.month,
  base:ST.comm.base, timing:ST.comm.timing,
  attrib:commAttribGet(ST,1,2026,2,3)}));
ok('every commission input survives a reload',
   persisted.name==='Persist Test' && persisted.salary===4321 && persisted.band===7 &&
   persisted.month===3 && persisted.base==='net' && persisted.timing==='spread' &&
   persisted.attrib===7, JSON.stringify(persisted));
const cloud = await p.evaluate(()=>{
  /* round-trip through JSON, which is what the cloud path actually does */
  const snap=JSON.parse(JSON.stringify(buildFullSnapshot()));
  ST.comm.people[0].salary=1;
  applyFullSnapshot(snap);
  return {inSnapshot:!!snap.comm, restored:ST.comm.people[0].salary};});
ok('commission state is carried by the cloud snapshot in both directions',
   cloud.inSnapshot && cloud.restored===4321);

// ── the screen ───────────────────────────────────────────────────────────
const ui = await p.evaluate(()=>{
  ST.comm.people=[{id:1,name:'A',salary:3000,active:true}];
  ST.comm.bands=[{from:0,to:3000,rate:3},{from:3000,to:null,rate:5}];
  ST.comm.base='gross'; ST.comm.timing='enrol'; ST.comm.attrib={}; ST.comm.month=0;
  commAttribSet(ST,1,2026,0,0,10);
  ST.module='commission'; ST.comm.onlyAttributed=false; render();
  const all=document.querySelectorAll('#app [data-commat]').length;
  const txtAll=document.getElementById('app').innerText;
  ST.comm.onlyAttributed=true; render();
  const few=document.querySelectorAll('#app [data-commat]').length;
  const txtFew=document.getElementById('app').innerText;
  ST.comm.onlyAttributed=false; render();
  return {all,few,txtAll,txtFew,
    tipEls:document.querySelectorAll('.cb-tip').length,
    icons:document.querySelectorAll('#app .cb-i').length,
    yearCols:document.querySelectorAll('#app tfoot').length};});
ok('the entry grid lists every course by default and no course vanishes silently',
   ui.all===36 && /Showing 36 of 36/i.test(ui.txtAll), `${ui.all} rows`);
ok('a narrowing filter announces itself with a count and a clearable chip',
   ui.few<ui.all && /Showing 1 of 36/i.test(ui.txtFew) && /Attributed only/i.test(ui.txtFew),
   `${ui.few} of ${ui.all}`);
ok('workings tooltips use the one existing component, not a second mechanism',
   ui.tipEls===1 && ui.icons>0, `${ui.icons} icons, ${ui.tipEls} tooltip element`);
ok('the year-at-a-glance table carries a team payroll total row', ui.yearCols>0);
ok('the screen states that this pay is outside Cost-Benefit and Forecast',
   /not part of Cost-Benefit full cost or Forecast expenses/i.test(ui.txtAll));

// ── CN ───────────────────────────────────────────────────────────────────
const zh = await p.evaluate(()=>{
  setLang('zh'); ST.module='commission'; render();
  const t=document.getElementById('app').innerText;
  ST.comm.bands=[{from:0,to:4000,rate:3},{from:3000,to:null,rate:5}]; render();
  const warn=document.getElementById('app').innerText;
  ST.comm.bands=[{from:0,to:3000,rate:3},{from:3000,to:null,rate:5}];
  setLang('en');
  return {t,warn};});
ok('the module is fully Chinese, with the salesperson name left alone',
   /销售佣金/.test(zh.t) && /佣金区间/.test(zh.t) && /已分配招生/.test(zh.t) &&
   /全年一览/.test(zh.t) && /销售团队薪酬总额/.test(zh.t) && /A/.test(zh.t) &&
   !/Commission bands|Attributed enrolments|Year at a glance/.test(zh.t));
ok('CN states the base and timing in words', /佣金按/.test(zh.t) && /计入/.test(zh.t));
ok('CN band warnings are Chinese', /区间重叠/.test(zh.warn));

// ── responsive ───────────────────────────────────────────────────────────
for (const lang of ['en','zh']) for (const w of [1440,1280,768,375]){
  await p.setViewportSize({width:w,height:900});
  const of = await p.evaluate((lang)=>{
    if((localStorage.getItem('ucc_lang')||'en')!==lang) setLang(lang);
    ST.module='commission'; render();
    return document.documentElement.scrollWidth-document.documentElement.clientWidth;}, lang);
  if(of>1) errs.push(`${lang} ${w}px overflow=${of}`);
}
await p.evaluate(()=>setLang('en'));
ok('no horizontal page scroll at 1440, 1280, 768 or 375 in either language',
   !errs.some(e=>/overflow/.test(e)));

if(errs.length)fails.push(...errs);
console.log(errs.length?'\nerrors: '+errs.join(' | '):'\nno console errors, no overflow');
console.log(fails.length?`\nFAILED (${fails.length})`:'\nALL PASS');
await b.close();
process.exit(fails.length?1:0);
