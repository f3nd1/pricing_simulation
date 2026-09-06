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

// ══ COMPARE SCHEMES ══════════════════════════════════════════════════════
const seedSchemes = async () => p.evaluate(()=>{
  /* enrolment for every course we attribute, including one sitting exactly on a
     class boundary so the average/marginal sign split is genuinely exercised */
  const iv=[]; let id=1;
  [[0,24],[1,12],[7,18],[20,14],[3,30]].forEach(([ci,n])=>{ for(let m=0;m<12;m++)
    iv.push({id:id++,kind:'budget',ci,month:m,year:2026,students:n/12}); });
  ST.intakes=iv;
  ST.comm.year=2026; ST.comm.basis='budget'; ST.comm.spid=1; ST.comm.attrib={};
  ST.comm.people=[{id:1,name:'A',salary:0,active:true}]; ST.comm.nextId=2;
  ST.comm.base='gross'; ST.comm.timing='enrol';
  [[0,10],[1,6],[7,9],[20,7],[3,15],[5,4]].forEach(([ci,n])=>commAttribSet(ST,1,2026,ci,0,n));
  ST.comm.schemes=null; commSchemesInit(ST);
  ST.comm.schemes.A.bands=[{from:0,to:3000,rate:3},{from:3000,to:null,rate:5}];
  ST.comm.schemes.B.bands=[{from:0,to:8000,rate:2},{from:8000,to:null,rate:9}];
  ST.comm.schemes.C.bands=[{from:0,to:null,rate:12}];
  ST.comm.schemeSel='A'; ST.comm.view='compare'; ST.module='commission'; render();});
await seedSchemes();

// three schemes, one attribution, three different answers
const three = await p.evaluate(()=>{
  const all=commCompareAll(ST,2026);
  return all.map(x=>({k:x.k,c:Math.round(x.score.commission),
    pg:x.score.pctOfGross,pe:x.score.perEnrol,pc:x.score.pctOfContrib,
    stu:x.score.students,gross:Math.round(x.score.gross)}));});
ok('three schemes on the same attribution give three different totals',
   new Set(three.map(x=>x.c)).size===3, three.map(x=>`${x.k}=${x.c}`).join(' · '));
ok('the volume is identical across schemes — only the bands differ',
   new Set(three.map(x=>x.stu)).size===1 && new Set(three.map(x=>x.gross)).size===1,
   `${three[0].stu} enrolments, ${three[0].gross} gross in every scheme`);
ok('a flat 12% scheme really is 12% of gross fees',
   Math.abs(three[2].pg-0.12)<1e-9, `${(three[2].pg*100).toFixed(2)}%`);
ok('per-enrolment and percentage figures follow from the totals',
   three.every(x=>Math.abs(x.pe-x.c/x.stu)<0.51),
   three.map(x=>`${x.k}: ${Math.round(x.pe)}`).join(' · '));

// the overpay row
const over = await p.evaluate(()=>{
  const before=commScore(ST,ST.comm.schemes.A.bands,2026);
  /* a rate high enough that commission per enrolment beats contribution */
  const brutal=[{from:0,to:null,rate:400}];
  const after=commScore(ST,brutal,2026);
  const detail=after.rows.filter(r=>r.overpay).map(r=>({
    n:courseLabel(r.c),per:Math.round(r.perEnrol),avg:Math.round(r.avg)}));
  /* every flagged course must genuinely have commission above contribution */
  const honest=after.rows.filter(r=>r.overpay).every(r=>r.perEnrol>r.avg);
  const noFalseNeg=after.rows.filter(r=>r.avg!=null&&r.perEnrol>r.avg).length===after.overpay;
  return {before:before.overpay, after:after.overpay, priced:after.priced.length,
    detail, honest, noFalseNeg};});
ok('a sane scheme flags nothing', over.before===0);
ok('a scheme paying more than the sale earns is caught, on every affected course',
   over.after===over.priced && over.after>0 && over.honest && over.noFalseNeg,
   over.detail.slice(0,2).map(d=>`${d.n}: pays ${d.per} vs earns ${d.avg}`).join(' · '));

// average, not marginal, and a sign split never counts as overpay
const comparator = await p.evaluate(()=>{
  const sc=commScore(ST,ST.comm.schemes.A.bands,2026);
  const split=sc.rows.filter(r=>r.signSplit);
  const d=cbaCompute(ST,'budget',2026);
  const checks=sc.priced.map(r=>{
    const row=d.rows.find(x=>x.ci===r.ci);
    return Math.abs(r.avg-row.contribution/row.students)<1e-9;});
  return {allAverage:checks.every(Boolean), splits:split.length,
    splitNames:split.map(r=>courseLabel(r.c)),
    splitCountedAsOverpay:split.filter(r=>r.overpay).length,
    splitDetail:split.map(r=>({avg:Math.round(r.avg),mg:Math.round(r.marginal)}))};});
ok('contribution per student is the average, r.contribution / r.students',
   comparator.allAverage);
ok('a course at a class boundary is flagged where average and marginal differ in sign',
   comparator.splits>0 &&
   comparator.splitDetail.every(d=>(d.avg>0)!==(d.mg>0)),
   comparator.splitNames.join(', ')+' '+JSON.stringify(comparator.splitDetail));
ok('a sign split never counts toward the overpay row',
   comparator.splitCountedAsOverpay===0);

// zero enrolment: N/A with a reason, excluded everywhere
const na = await p.evaluate(()=>{
  const sc=commScore(ST,ST.comm.schemes.A.bands,2026);
  const un=sc.rows.filter(r=>r.avg==null);
  const d=cbaCompute(ST,'budget',2026);
  return {n:un.length,
    reasons:un.map(r=>r.reason),
    reallyZero:un.every(r=>{const row=d.rows.find(x=>x.ci===r.ci);return row.students===0;}),
    notInPriced:un.every(r=>!sc.priced.some(x=>x.ci===r.ci)),
    notInOverpay:un.every(r=>!r.overpay),
    denomExcludes:Math.abs(sc.contribution-sc.priced.reduce((a,r)=>a+r.contribution,0))<1e-9,
    txt:document.getElementById('app').innerText};});
ok('a course with no enrolment on the basis gets N/A and a stated reason',
   na.n>0 && na.reallyZero && na.reasons.every(r=>/no (budget|actual) enrolment|无(预算|实际)招生/.test(r)),
   na.reasons[0]);
ok('it is excluded from the overpay count, the scatter and the percentage denominator',
   na.notInPriced && na.notInOverpay && na.denomExcludes);
ok('the omission is stated on screen and the chart names what it left out',
   /have no enrolment on this basis/i.test(na.txt) && /not plotted:/i.test(na.txt));

// threshold sweep
const sweep = await p.evaluate(()=>{
  const sw=commSweep(ST,2026,3,9);
  const fees=[...new Set(COURSES.map(c=>c.fee).filter(Boolean))].sort((a,b)=>a-b);
  /* every distinct fee is an evaluation point */
  const coversFees=fees.every(f=>sw.series.some(s=>Math.abs(s.t-f)<1e-9));
  /* low rate below the top fee, high rate above: pushing the threshold up moves
     more fees into the LOW band, so total commission must not increase */
  let monotone=true;
  for(let i=1;i<sw.series.length;i++) if(sw.series[i].commission>sw.series[i-1].commission+1e-6) monotone=false;
  /* it is a step function: consecutive equal stretches exist */
  const flats=sw.series.filter((s,i)=>i>0&&Math.abs(s.commission-sw.series[i-1].commission)<1e-9).length;
  const steps=sw.series.filter((s,i)=>i>0&&Math.abs(s.commission-sw.series[i-1].commission)>1e-6).length;
  /* a threshold below every fee = flat high rate; above every fee = flat low */
  const allHigh=sw.series[0].commission, allLow=sw.series[sw.series.length-1].commission;
  const gross=commScore(ST,[{from:0,to:null,rate:1}],2026).commission*100;
  return {pts:sw.series.length, coversFees, monotone, flats, steps,
    allHigh:Math.round(allHigh), allLow:Math.round(allLow),
    expectHigh:Math.round(gross*0.09), expectLow:Math.round(gross*0.03)};});
ok('the sweep evaluates at every distinct course fee, not on a fixed grid',
   sweep.coversFees, `${sweep.pts} points`);
ok('the series is monotonic in steps as the threshold rises',
   sweep.monotone && sweep.steps>0 && sweep.flats>0,
   `${sweep.steps} steps, ${sweep.flats} flat stretches`);
ok('the extremes match a flat scheme at each rate',
   Math.abs(sweep.allHigh-sweep.expectHigh)<2 && Math.abs(sweep.allLow-sweep.expectLow)<2,
   `${sweep.allHigh} vs ${sweep.expectHigh} · ${sweep.allLow} vs ${sweep.expectLow}`);

// Apply: sandbox until confirmed
const apply = await p.evaluate(()=>{
  const live=JSON.stringify(ST.comm.bands);
  const out={};
  window.confirm=()=>false;
  document.querySelector('[data-commsapply="B"]').click();
  out.afterCancel=JSON.stringify(ST.comm.bands)===live;
  window.confirm=()=>true;
  document.querySelector('[data-commsapply="B"]').click();
  out.afterConfirm=JSON.stringify(ST.comm.bands)===JSON.stringify(ST.comm.schemes.B.bands);
  out.schemesUntouched=JSON.stringify(ST.comm.schemes.B.bands)!==live;
  out.logged=(ST.audit||[]).some(a=>/Apply scheme to live bands/.test(a.what||''));
  ST.comm.bands=JSON.parse(live); render();
  return out;});
ok('declining the confirm leaves the live bands alone', apply.afterCancel);
ok('confirming copies the scheme into the live bands', apply.afterConfirm);
ok('applying is recorded in the audit trail', apply.logged);
const sandbox = await p.evaluate(()=>{
  const live=JSON.stringify(ST.comm.bands);
  ST.comm.schemes.C.bands=[{from:0,to:null,rate:44}];
  ST.comm.schemes.A.name='Renamed'; render();
  return JSON.stringify(ST.comm.bands)===live;});
ok('editing or renaming a scheme never touches the live bands', sandbox);

// schemes persist
await p.evaluate(()=>{
  ST.comm.schemes.B.bands=[{from:0,to:4444,rate:1.5},{from:4444,to:null,rate:8.5}];
  ST.comm.schemes.B.name='Threshold test'; ST.comm.view='compare'; ST.comm.schemeSel='B';
  saveToStorage();});
await p.reload(); await p.waitForTimeout(400);
const kept = await p.evaluate(()=>({
  name:ST.comm.schemes&&ST.comm.schemes.B.name,
  from:ST.comm.schemes&&ST.comm.schemes.B.bands[1].from,
  rate:ST.comm.schemes&&ST.comm.schemes.B.bands[1].rate,
  view:ST.comm.view, sel:ST.comm.schemeSel}));
ok('scheme bands, names and the selected view survive a reload',
   kept.name==='Threshold test' && kept.from===4444 && kept.rate===8.5 &&
   kept.view==='compare' && kept.sel==='B', JSON.stringify(kept));
const cloudS = await p.evaluate(()=>{
  const snap=JSON.parse(JSON.stringify(buildFullSnapshot()));
  ST.comm.schemes.B.bands[1].rate=1;
  applyFullSnapshot(snap);
  return {carried:!!(snap.comm&&snap.comm.schemes), rate:ST.comm.schemes.B.bands[1].rate};});
ok('schemes ride the cloud snapshot in both directions',
   cloudS.carried && cloudS.rate===8.5);

// isolation
await seedSchemes();
const isoS = await p.evaluate(()=>{
  const other=()=>{const d=cbaCompute(ST,'budget',2026),f=fcPnl(ST),yi=FC_YEARS.indexOf(2026);
    return JSON.stringify({cost:d.T.cost,benefit:d.T.benefit,net:d.T.net,bcr:d.T.bcr,pool:d.pool,
      cogs:f.cogs[yi],opex:f.opex[yi],fcNet:f.net[yi],intakes:JSON.stringify(ST.intakes).length,
      off:JSON.stringify(ST.cba.off),rates:JSON.stringify(ST.cba.rates)});};
  const b4=other(), c4=commScore(ST,ST.comm.schemes.A.bands,2026).commission;
  ST.comm.schemes.A.bands=[{from:0,to:999,rate:33},{from:999,to:null,rate:77}];
  ST.comm.schemeSel='A'; render();
  const af=other(), c5=commScore(ST,ST.comm.schemes.A.bands,2026).commission;
  return {same:b4===af, moved:Math.abs(c5-c4)>1};});
ok('changing a scheme moves this view', isoS.moved);
ok('and moves Cost-Benefit, Forecast and Yearly Budget by exactly $0', isoS.same);

// charts
await seedSchemes();
const charts = await p.evaluate(()=>{
  const t0=performance.now(); render(); const ms=performance.now()-t0;
  return {ms:Math.round(ms),
    svgs:document.querySelectorAll('#app svg').length,
    onG:document.querySelectorAll('#app g[tabindex]').length,
    marks:document.querySelectorAll('#app svg [tabindex="0"][role="button"]').length,
    labelled:[...document.querySelectorAll('#app svg [tabindex="0"]')].every(e=>e.getAttribute('aria-label')),
    tipEls:document.querySelectorAll('.cb-tip').length,
    plotted:(document.getElementById('app').innerText.match(/plotted/g)||[]).length};});
ok('all four charts draw', charts.svgs===4, `${charts.svgs} svg`);
ok('render with all four charts stays under 400ms', charts.ms<400, `${charts.ms}ms`);
ok('focusable marks are on shapes, never on a <g>',
   charts.onG===0 && charts.marks>0, `${charts.marks} marks, ${charts.onG} on <g>`);
ok('every focusable mark carries an accessible label', charts.labelled);
ok('the charts share the one tooltip element', charts.tipEls===1);
ok('each chart states how much of the data it plotted', charts.plotted>=4, `${charts.plotted} statements`);
const focusable = await p.evaluate(()=>{
  const el=document.querySelector('#app svg circle.hit')||document.querySelector('#app svg [tabindex="0"]');
  el.focus();
  const got=document.activeElement===el;
  el.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));
  const shown=document.querySelector('.cb-tip').classList.contains('on');
  const still=document.activeElement===el;      /* raise() must not steal it */
  el.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));
  const hid=!document.querySelector('.cb-tip').classList.contains('on');
  return {got,shown,still,hid};});
ok('keyboard focus reaches a chart mark and opens its tooltip',
   focusable.got && focusable.shown, JSON.stringify(focusable));
ok('focus is not stolen by raise, and focusout closes the tooltip',
   focusable.still && focusable.hid);

// CN across the compare view
const zhS = await p.evaluate(()=>{
  setLang('zh'); render();
  const t=document.getElementById('app').innerText;
  const attrs=[...document.querySelectorAll('#app [aria-label]')].map(e=>e.getAttribute('aria-label')).join(' ~ ');
  const tips=[...document.querySelectorAll('#app [data-tip]')].map(e=>{
    const d=document.createElement('div');d.innerHTML=e.getAttribute('data-tip');return d.textContent;}).join(' ~ ');
  setLang('en');
  return {t,attrs,tips};});
ok('the compare view is Chinese: table, charts and course rows',
   /方案对比/.test(zhS.t) && /全年佣金/.test(zhS.t) && /佣金高于贡献额/.test(zhS.t) &&
   /方案形状/.test(zhS.t) && /阈值扫描/.test(zhS.t) && /分课程/.test(zhS.t) &&
   /生均贡献额/.test(zhS.t) && /下一名学生/.test(zhS.t));
ok('chart omission and axis text are Chinese',
   /已绘制/.test(zhS.t) && /生均贡献额 →/.test(zhS.t) && /已测试阈值/.test(zhS.t));
ok('the class-boundary explanation is Chinese',
   /班级容量临界/.test(zhS.tips) || /班级容量临界/.test(zhS.t));
const leak = await p.evaluate(()=>{
  setLang('zh'); render();
  const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const allow=new Set();
  COURSES.forEach(c=>[c.name,c.abbr,c.group].forEach(v=>norm(v).split(' ').forEach(w=>w&&allow.add(w))));
  (ST.comm.people||[]).forEach(p=>norm(p.name).split(' ').forEach(w=>w&&allow.add(w)));
  COMM_SCHEME_KEYS.forEach(k=>norm((ST.comm.schemes[k]||{}).name).split(' ').forEach(w=>w&&allow.add(w)));
  `ucc roi bcr gst cpf fte i x v en cn united ceres college supabase n a`
    .split(' ').forEach(w=>allow.add(w));
  const out=new Set();
  const add=txt=>(String(txt).match(/[A-Za-z][A-Za-z0-9'’&/().,%\- ]*[A-Za-z0-9)%]|[A-Za-z]{2,}/g)||[])
    .map(x=>x.trim()).filter(x=>x.length>1)
    .filter(x=>!norm(x).split(' ').every(w=>/^\d+$/.test(w)||allow.has(w)))
    .forEach(x=>out.add(x));
  const root=document.getElementById('app');
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  for(let n;(n=w.nextNode());){const el=n.parentElement;
    if(!el||el.closest('script,style')||el.closest('[data-i18n-skip]'))continue;
    add(n.nodeValue);}
  root.querySelectorAll('[aria-label],[title],[placeholder]').forEach(el=>{
    if(el.closest('[data-i18n-skip]'))return;
    ['aria-label','title','placeholder'].forEach(a=>{if(el.hasAttribute(a))add(el.getAttribute(a));});});
  root.querySelectorAll('[data-tip]').forEach(el=>{
    if(el.closest('[data-i18n-skip]'))return;
    const d=document.createElement('div');d.innerHTML=el.getAttribute('data-tip');add(d.textContent);});
  setLang('en');
  return [...out];});
ok('no untranslated English anywhere in the compare view, text or attributes',
   leak.length===0, leak.slice(0,6).join(' · '));

// ══ DISCRIMINATION ═══════════════════════════════════════════════════════
const disc = await p.evaluate(()=>{
  const set=(att,schemes)=>{
    const iv=[];let id=1;
    COURSES.forEach((c,ci)=>{for(let m=0;m<12;m++)
      iv.push({id:id++,kind:'budget',ci,month:m,year:2026,students:2});});
    ST.intakes=iv; ST.comm.year=2026; ST.comm.attrib={}; ST.comm.spid=1;
    ST.comm.people=[{id:1,name:'A',salary:0,active:true}]; ST.comm.nextId=2;
    att.forEach(([ci,m,n])=>commAttribSet(ST,1,2026,ci,m,n));
    ST.comm.schemes=null; commSchemesInit(ST);
    ST.comm.schemes.A.bands=[{from:0,to:3000,rate:3},{from:3000,to:null,rate:5}];
    ST.comm.schemes.B.bands=schemes||[{from:0,to:8000,rate:2},{from:8000,to:null,rate:9}];
    ST.comm.schemes.C.bands=[{from:0,to:null,rate:3}];
    ST.module='commission'; ST.comm.view='compare'; render();
    const all=commCompareAll(ST,2026);
    const sep=commSeparability(ST,all,2026);
    const txt=document.getElementById('app').innerText;
    return {sep:{separable:sep.separable,ties:sep.ties.length,untested:sep.untested.length,
                 zones:sep.zones.length,tooFew:sep.tooFewFees,basis:sep.basis},
            totals:all.map(x=>Math.round(x.score.commission)),
            chip:(txt.match(/lowest cost/g)||[]).length,
            notSep:/not separable on this attribution/i.test(txt), txt};
  };
  return {
    tie:      set([[0,0,10]]),
    sameFee:  set([[0,0,10],[1,0,6]]),
    partial:  set([[0,0,10],[7,1,9]]),
    full:     set([[0,0,10],[7,1,9],[20,2,7]]),
    identical:set([[0,0,10],[7,1,9],[20,2,7]],[{from:0,to:3000,rate:3},{from:3000,to:null,rate:5}]),
    none:     set([])};});

ok('the three-way tie case is caught and no winner is crowned',
   disc.tie.sep.ties>0 && !disc.tie.sep.separable && disc.tie.chip===0,
   `totals ${disc.tie.totals.join('/')} · ${disc.tie.sep.ties} tie group(s)`);
ok('the tie explanation names the schemes and the range they differ on',
   /produce the same total/i.test(disc.tie.txt) &&
   /differ only above \$3,000/i.test(disc.tie.txt) &&
   /no attributed course fee falls there/i.test(disc.tie.txt));
ok('two courses sharing one fee is still one distinct fee, and is caught',
   disc.sameFee.sep.basis.courses===2 && disc.sameFee.sep.basis.distinctFees===1 &&
   disc.sameFee.sep.tooFew && disc.sameFee.chip===0,
   `${disc.sameFee.sep.basis.courses} courses, ${disc.sameFee.sep.basis.distinctFees} distinct fee`);
ok('the floor is two DISTINCT fees, not two courses',
   /Only 1 distinct course fee is attributed/i.test(disc.sameFee.txt));
ok('a partially tested boundary suppresses the badge even when totals differ',
   new Set(disc.partial.totals).size===disc.partial.totals.length &&
   disc.partial.sep.untested>0 && disc.partial.chip===0,
   `totals ${disc.partial.totals.join('/')} · ${disc.partial.sep.untested} untested zone(s)`);
ok('an untested boundary says what would test it',
   /Attribute a course priced (above|between)/i.test(disc.partial.txt));
ok('a fully exercised attribution restores the badge',
   disc.full.sep.separable && disc.full.sep.untested===0 && disc.full.sep.ties===0 &&
   disc.full.chip===1, `${disc.full.sep.zones} zones, all exercised`);
ok('two schemes with identical bands are reported as unseparable by any attribution',
   disc.identical.sep.ties>0 && disc.identical.chip===0 &&
   /their bands are the same/i.test(disc.identical.txt));
ok('the basis line shows even when the ranking IS supported',
   /Based on 3 course\(s\) across 3 month\(s\), 26 enrolments, fees \$2,480 to \$8,120/i.test(disc.full.txt) &&
   /3 distinct fee\(s\)/i.test(disc.full.txt));
ok('the basis line counts courses, months, enrolments and the fee range correctly',
   disc.full.sep.basis.courses===3 && disc.full.sep.basis.months===3 &&
   disc.full.sep.basis.enrolments===26 && disc.full.sep.basis.min===2480 &&
   disc.full.sep.basis.max===8120);
ok('an empty attribution says there is nothing to compare rather than ranking',
   disc.none.sep.basis.enrolments===0 && disc.none.chip===0 &&
   /Nothing is attributed for this year yet/i.test(disc.none.txt));
ok('the suppressed state is labelled, not silent',
   disc.tie.notSep && disc.full.notSep===false);
ok('disagreement zones are computed exactly from the union of band edges',
   disc.full.sep.zones===3, `${disc.full.sep.zones} zones for 3 schemes with edges 3000/8000`);

const discZh = await p.evaluate(()=>{
  setLang('zh');
  const iv=[];let id=1;
  COURSES.forEach((c,ci)=>{for(let m=0;m<12;m++)iv.push({id:id++,kind:'budget',ci,month:m,year:2026,students:2});});
  ST.intakes=iv; ST.comm.attrib={}; ST.comm.spid=1; ST.comm.year=2026;
  commAttribSet(ST,1,2026,0,0,10);
  ST.comm.schemes=null; commSchemesInit(ST);
  ST.comm.schemes.B.bands=[{from:0,to:8000,rate:2},{from:8000,to:null,rate:9}];
  ST.module='commission'; ST.comm.view='compare'; render();
  const bad=document.getElementById('app').innerText;
  commAttribSet(ST,1,2026,7,1,9); commAttribSet(ST,1,2026,20,2,7); render();
  const good=document.getElementById('app').innerText;
  setLang('en');
  return {bad,good};});
ok('CN: the unseparable state, the tie reason and the remedy are Chinese',
   /当前招生分配无法区分各方案/.test(discZh.bad) && /的合计相同/.test(discZh.bad) &&
   /请分配一门学费/.test(discZh.bad) && /不同学费共/.test(discZh.bad));
ok('CN: the supported state and its basis line are Chinese',
   /当前招生分配可以区分各方案/.test(discZh.good) && /基于/.test(discZh.good) &&
   /均至少有一笔已分配的学费/.test(discZh.good));

// ══ RATIO COHERENCE, TAKE-HOME, BASELINE ════════════════════════════════
const coh = await p.evaluate(()=>{
  const set=(enrolled,attrib)=>{
    const iv=[];let id=1;
    enrolled.forEach(([ci,n])=>{for(let m=0;m<12;m++)
      iv.push({id:id++,kind:'budget',ci,month:m,year:2026,students:Math.max(1,Math.round(n/12))});});
    ST.intakes=iv; ST.comm.year=2026; ST.comm.basis='budget'; ST.comm.attrib={};
    ST.comm.people=[{id:1,name:'One',salary:3000,active:true},{id:2,name:'Two',salary:2000,active:true}];
    ST.comm.nextId=3; ST.comm.spid=1;
    attrib.forEach(([spid,ci,n])=>commAttribSet(ST,spid,2026,ci,0,n));
    ST.comm.schemes=null; commSchemesInit(ST);
    ST.comm.schemes.B.bands=[{from:0,to:8000,rate:2},{from:8000,to:null,rate:9}];
    ST.comm.schemes.C.bands=[{from:0,to:null,rate:3}];
    ST.comm.baseline=null; ST.module='commission'; ST.comm.view='compare'; render();
  };
  /* partial coverage: 5 attributed, only 2 with budget enrolment */
  set([[0,24],[1,12]], [[1,0,10],[1,1,6],[1,5,4],[2,9,3],[2,11,2]]);
  const sc=commScore(ST,ST.comm.schemes.A.bands,2026);
  const all=commCompareAll(ST,2026);
  const txt=document.getElementById('app').innerText;
  /* full coverage for comparison */
  set([[0,24],[1,12]], [[1,0,10],[1,1,6]]);
  const full=commScore(ST,ST.comm.schemes.A.bands,2026);
  return {
    partial:{rows:sc.rows.length,priced:sc.priced.length,
      commission:sc.commission,pricedCommission:sc.pricedCommission,
      contribution:sc.contribution,pct:sc.pctOfContrib,
      covCourses:sc.covCourses,covMoney:sc.covMoney},
    full:{rows:full.rows.length,priced:full.priced.length,
      commission:full.commission,pricedCommission:full.pricedCommission,
      contribution:full.contribution,pct:full.pctOfContrib},
    txt};});

ok('the ratio divides commission on measured courses by those same courses contribution',
   Math.abs(coh.partial.pct-coh.partial.pricedCommission/coh.partial.contribution)<1e-12 &&
   coh.partial.pricedCommission<coh.partial.commission,
   `${Math.round(coh.partial.pricedCommission)} ÷ ${Math.round(coh.partial.contribution)} = ${(coh.partial.pct*100).toFixed(1)}%`);
ok('it can no longer exceed 100% through a population mismatch',
   coh.partial.pct<1 && coh.partial.commission/coh.partial.contribution>coh.partial.pct,
   `coherent ${(coh.partial.pct*100).toFixed(1)}% vs the old mismatched ${(coh.partial.commission/coh.partial.contribution*100).toFixed(1)}%`);
ok('at full coverage the numerator is the whole commission, so nothing regresses',
   coh.full.priced===coh.full.rows &&
   Math.abs(coh.full.pricedCommission-coh.full.commission)<1e-9 &&
   Math.abs(coh.full.pct-coh.full.commission/coh.full.contribution)<1e-12);
ok('coverage is reported as courses AND share of commission',
   Math.abs(coh.partial.covCourses-coh.partial.priced/coh.partial.rows)<1e-12 &&
   Math.abs(coh.partial.covMoney-coh.partial.pricedCommission/coh.partial.commission)<1e-12,
   `${Math.round(coh.partial.covCourses*100)}% of courses, ${Math.round(coh.partial.covMoney*100)}% of commission`);
ok('the coverage is stated under the table, not only in a tooltip',
   /% of contribution covers \d+ of \d+ attributed courses, \d+% of the commission/i.test(coh.txt));
ok('the table says why that numerator is smaller than the commission column',
   /why its numerator is smaller than the commission total beside it/i.test(coh.txt));
ok('each row carries its own coverage count', /\d+ of \d+ courses/i.test(coh.txt));
const zeroCov = await p.evaluate(()=>{
  ST.intakes=[]; ST.comm.attrib={}; ST.comm.spid=1;
  commAttribSet(ST,1,2026,0,0,5); render();
  const sc=commScore(ST,ST.comm.schemes.A.bands,2026);
  return {pct:sc.pctOfContrib,priced:sc.priced.length,txt:document.getElementById('app').innerText};});
ok('with no measurable course at all the ratio is N/A, not zero',
   zeroCov.pct===null && zeroCov.priced===0 && /N\/A/.test(zeroCov.txt));

const take = await p.evaluate(()=>{
  const iv=[];let id=1;
  [[0,24],[1,12],[7,18],[20,14]].forEach(([ci,n])=>{for(let m=0;m<12;m++)
    iv.push({id:id++,kind:'budget',ci,month:m,year:2026,students:Math.round(n/12)});});
  ST.intakes=iv; ST.comm.year=2026; ST.comm.attrib={};
  ST.comm.people=[{id:1,name:'One',salary:3000,active:true},{id:2,name:'Two',salary:2600,active:true}];
  ST.comm.nextId=3; ST.comm.spid=1;
  [[1,0,10],[1,7,9]].forEach(([sp,ci,n])=>commAttribSet(ST,sp,2026,ci,0,n));
  [[2,1,6],[2,20,7]].forEach(([sp,ci,n])=>commAttribSet(ST,sp,2026,ci,1,n));
  ST.comm.schemes=null; commSchemesInit(ST);
  ST.comm.schemes.C.bands=[{from:0,to:null,rate:3}];
  ST.comm.baseline=null; ST.comm.schemeSel='C'; render();
  const liveBefore=JSON.stringify(ST.comm.bands);
  const THa=commTakeHome(ST,ST.comm.schemes.A.bands,2026);
  const THc=commTakeHome(ST,ST.comm.schemes.C.bands,2026);
  const liveAfter=JSON.stringify(ST.comm.bands);
  /* each person's commission must come from their OWN attribution */
  const scAll=commScore(ST,ST.comm.schemes.C.bands,2026);
  const sc1=commScore(ST,ST.comm.schemes.C.bands,2026,1);
  const sc2=commScore(ST,ST.comm.schemes.C.bands,2026,2);
  return {THa,THc,liveUnchanged:liveBefore===liveAfter,
    perPersonSums:Math.abs(sc1.commission+sc2.commission-scAll.commission)<1e-9,
    p1:Math.round(sc1.commission),p2:Math.round(sc2.commission),
    txt:document.getElementById('app').innerText};});
ok('take-home is salary for the year plus commission for the year, per person',
   take.THc.rows.every(r=>Math.abs(r.take-(r.salary+r.commission))<1e-9) &&
   take.THc.rows[0].salary===36000,
   take.THc.rows.map(r=>`${r.name} ${Math.round(r.take)}`).join(' · '));
ok('the team row is the sum of the people',
   Math.abs(take.THc.take-take.THc.rows.reduce((a,r)=>a+r.take,0))<1e-9);
ok('each salesperson is scored on their OWN attribution, and the parts sum to the whole',
   take.perPersonSums && take.p1>0 && take.p2>0, `${take.p1} + ${take.p2}`);
ok('salary is identical across schemes, so only commission moves',
   take.THa.salary===take.THc.salary && take.THa.commission!==take.THc.commission);
ok('SCORING A SCHEME NEVER MUTATES THE LIVE BANDS', take.liveUnchanged);
ok('the per-salesperson breakdown and its team row are on screen',
   /Take-home/i.test(take.txt) && /Sales team/i.test(take.txt) &&
   /Fixed salary/i.test(take.txt));
ok('the screen says salary does not change with the scheme',
   /Salary does not change with the scheme/i.test(take.txt));

const bl = await p.evaluate(()=>{
  const out={};
  ST.comm.baseline=null;
  /* A and B default to the same bands, so B is made distinct before asserting
     that the live bands resolve to it */
  ST.comm.schemes.B.bands=[{from:0,to:5000,rate:1},{from:5000,to:null,rate:11}];
  ST.comm.bands=JSON.parse(JSON.stringify(ST.comm.schemes.B.bands));
  out.livesOnB=commLiveScheme(ST); out.baseIsB=commBaselineKey(ST);
  /* ambiguity: make A and B identical, first in order must win */
  ST.comm.schemes.A.bands=JSON.parse(JSON.stringify(ST.comm.schemes.B.bands));
  out.tieBreak=commLiveScheme(ST);
  /* nothing matches */
  ST.comm.bands=[{from:0,to:1234,rate:4},{from:1234,to:null,rate:6}];
  out.noMatch=commLiveScheme(ST); out.fallback=commBaselineKey(ST);
  render(); out.warn=/No scheme matches the bands currently in force/i.test(document.getElementById('app').innerText);
  /* an explicit choice overrides the default */
  ST.comm.baseline='C'; out.explicit=commBaselineKey(ST);
  ST.comm.baseline=null;
  return out;});
ok('the baseline defaults to the scheme matching the bands in force',
   bl.livesOnB==='B' && bl.baseIsB==='B');
ok('when two schemes match, the first in A/B/C order wins', bl.tieBreak==='A');
ok('when no scheme matches, it falls back to A and says so plainly',
   bl.noMatch===null && bl.fallback==='A' && bl.warn);
ok('an explicit baseline choice overrides the default', bl.explicit==='C');
const diff = await p.evaluate(()=>{
  ST.comm.schemes=null; commSchemesInit(ST);
  ST.comm.schemes.C.bands=[{from:0,to:null,rate:3}];
  ST.comm.bands=JSON.parse(JSON.stringify(ST.comm.schemes.A.bands));
  ST.comm.baseline=null; render();
  const all=commCompareAll(ST,2026);
  const A=all.find(x=>x.k==='A').score.commission, C=all.find(x=>x.k==='C').score.commission;
  const t=document.getElementById('app').innerText;
  return {delta:Math.round(C-A), txt:t,
    saysSaves:new RegExp('saves \\$'+Math.round(A-C).toLocaleString()+' against A').test(t),
    baselineRow:/baseline/i.test(t)};});
ok('the difference is stated in words against the named baseline',
   diff.delta<0 && diff.saysSaves,
   (diff.txt.match(/saves \$[\d,]+ against \w+/)||[''])[0]);
ok('the baseline row says baseline rather than a zero difference', diff.baselineRow);

const zhNew = await p.evaluate(()=>{
  /* one attributed course with no enrolment, so the coverage line renders */
  commAttribSet(ST,1,2026,5,0,4);
  ST.comm.bands=JSON.parse(JSON.stringify(ST.comm.schemes.A.bands));
  ST.comm.baseline=null;
  setLang('zh'); render();
  const t=document.getElementById('app').innerText;
  ST.comm.bands=[{from:0,to:99,rate:1}]; render();
  const warn=document.getElementById('app').innerText;
  setLang('en');
  return {t,warn};});
ok('CN: take-home, baseline and coverage wording',
   /团队实得合计/.test(zhNew.t) && /与基准方案相比/.test(zhNew.t) &&
   /实得收入/.test(zhNew.t) && /销售团队/.test(zhNew.t) &&
   /固定薪酬不随方案变化/.test(zhNew.t) && /占贡献额一列涵盖/.test(zhNew.t) &&
   /(较 .+ 节省|较 .+ 多支出)/.test(zhNew.t));
ok('CN: the no-matching-baseline warning', /没有任何方案与当前正式使用的区间一致/.test(zhNew.warn));

// responsive, charts included
for (const lang of ['en','zh']) for (const w of [1440,1280,768,375]){
  await p.setViewportSize({width:w,height:900});
  const of = await p.evaluate((lang)=>{
    if((localStorage.getItem('ucc_lang')||'en')!==lang) setLang(lang);
    ST.module='commission'; ST.comm.view='compare'; render();
    return document.documentElement.scrollWidth-document.documentElement.clientWidth;}, lang);
  if(of>1) errs.push(`compare ${lang} ${w}px overflow=${of}`);
}
await p.evaluate(()=>{setLang('en');ST.comm.view='earnings';});
ok('the compare view does not scroll the page sideways at any width, either language',
   !errs.some(e=>/compare .* overflow/.test(e)));

if(errs.length)fails.push(...errs);
console.log(errs.length?'\nerrors: '+errs.join(' | '):'\nno console errors, no overflow');
console.log(fails.length?`\nFAILED (${fails.length})`:'\nALL PASS');
await b.close();
process.exit(fails.length?1:0);
