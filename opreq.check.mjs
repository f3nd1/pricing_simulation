/* Operating requirement: the Course Simulator's one-delivery break-even, the
   rolling pace it implies, and the selected-period requirement must be one
   chain, and the arithmetic shown on screen must always reconcile.
   node opreq.check.mjs -> non-zero exit on failure. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage();
await p.setViewportSize({ width:1440, height:1200 });
const fails=[], errs=[];
p.on('pageerror', e=>errs.push('pageerror: '+e.message));
const ok=(t,c,x='')=>{console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`); if(!c)fails.push(t);};

await p.goto('file://' + process.cwd() + '/ucc_budget_simulator.html');
await p.evaluate(()=>localStorage.setItem('ucc_unlocked','ucc2026'));
await p.reload(); await p.waitForTimeout(500);

/* the chain, for any course of a given duration */
const chain = (mo) => p.evaluate((mo)=>{
  const ci=COURSES.findIndex(c=>(Number(c.mo)||0)===mo);
  if(ci<0) return null;
  const c=COURSES[ci];
  const intakes=[]; let id=1;
  for(let m=0;m<12;m++) intakes.push({id:id++,kind:'budget',ci,month:m,year:2026,students:2});
  ST.intakes=intakes; ST.ybYear=2026;
  const R=cbaRolling(ST,c);
  const r=cbaCompute(ST,'budget',2026).rows.find(x=>x.ci===ci);
  return { name:c.name, mo:c.mo, be:R.beDisplay, beExact:R.beExact, pace:R.pace,
    months:r.months, req:r.reqPeriod, shownReq:cbaReqShown(r), students:r.students,
    shownGap:cbaGapShown(r) };
}, mo);

// ── the CGM worked example ────────────────────────────────────────────────
const cgm = await p.evaluate(()=>{
  const ci=COURSES.findIndex(c=>/^Certificate in General Management/.test(c.name));
  const c=COURSES[ci];
  const intakes=[]; let id=1;
  for(let m=0;m<12;m++) intakes.push({id:id++,kind:'budget',ci,month:m,year:2026,students:m===0?1:0});
  /* one intake per month so the period really is the full year */
  for(let m=1;m<12;m++) intakes.push({id:id++,kind:'budget',ci,month:m,year:2026,students:0});
  intakes.push({id:id++,kind:'budget',ci,month:11,year:2026,students:0.0000001});
  ST.intakes=intakes; ST.ybYear=2026;
  const R=cbaRolling(ST,c);
  const r=cbaCompute(ST,'budget',2026).rows.find(x=>x.ci===ci);
  return { mo:c.mo, be:R.beDisplay, pace:R.pace, months:r.months,
    req:r.reqPeriod, shownReq:cbaReqShown(r), students:r.students, gap:cbaGapShown(r) };});
ok('CGM: a 6-month delivery breaking even at 5 implies ~0.82 enrolments/month',
   cgm.mo===6 && cgm.be===5 && Math.abs(cgm.pace-5/6)<0.05,
   `be ${cgm.be} / ${cgm.mo} months -> ${cgm.pace.toFixed(3)}/month`);
ok('CGM: over a 12-month period the requirement is ~10, not 5',
   cgm.months===12 && cgm.shownReq===10,
   `${cgm.months} months × ${cgm.pace.toFixed(3)} = ${cgm.req.toFixed(2)} -> ${cgm.shownReq}`);
ok('CGM: the chain is exact — pace × months is the requirement',
   Math.abs(cgm.pace*cgm.months-cgm.req)<1e-9);

// ── the same chain holds for a different duration ─────────────────────────
const eight = await chain(8);
ok('an 8-month course follows the same chain: BE ÷ months × period = requirement',
   !!eight && Math.abs(eight.beExact/eight.mo-eight.pace)<1e-9 &&
   Math.abs(eight.pace*eight.months-eight.req)<1e-9,
   eight?`${eight.name}: ${eight.be}/${eight.mo}mo -> ${eight.pace.toFixed(3)}/mo × ${eight.months} = ${eight.req.toFixed(2)}`:'no 8-month course');
ok('the rolling model reconciles with the Course Simulator over exactly one delivery',
   !!eight && Math.abs(eight.pace*eight.mo-eight.beExact)<1e-9,
   'pace × duration === unrounded break-even');

// ── displayed arithmetic always reconciles, including fractional cases ─────
const round = await p.evaluate(()=>{
  const out=[];
  /* sweep every course and every plausible enrolment so a fractional
     requirement is certainly covered */
  COURSES.forEach((c,ci)=>{
    const intakes=[]; let id=1;
    for(let m=0;m<12;m++) intakes.push({id:id++,kind:'budget',ci,month:m,year:2026,students:2});
    ST.intakes=intakes; ST.ybYear=2026;
    const r=cbaCompute(ST,'budget',2026).rows.find(x=>x.ci===ci);
    if(r.reqPeriod==null) return;
    out.push({name:c.name, frac:r.reqPeriod%1, students:r.students,
      shownReq:cbaReqShown(r), shownGap:cbaGapShown(r),
      reconciles: r.students-cbaReqShown(r)===cbaGapShown(r)});
  });
  return out;});
ok('every course reconciles: students − displayed requirement === displayed gap',
   round.length>0 && round.every(r=>r.reconciles), `${round.length} courses`);
ok('the sweep really included fractional requirements — the case that used to break',
   round.some(r=>r.frac>0.5), `${round.filter(r=>r.frac>0.5).length} with a fraction above .5`);
const oldBug = round.filter(r=>Math.round(Math.abs(r.students-(r.shownReq-1+r.frac)))!==Math.abs(r.shownGap));
ok('the old two-roundings display (ceil for the target, round for the gap) is gone',
   oldBug.length>0, `${oldBug.length} rows would have shown contradictory arithmetic before`);

// ── Budget vs Actual periods ──────────────────────────────────────────────
const per = await p.evaluate(()=>{
  const ci=COURSES.findIndex(c=>/^Certificate in General Management/.test(c.name));
  const intakes=[]; let id=1;
  for(let m=0;m<12;m++) intakes.push({id:id++,kind:'budget',ci,month:m,year:2026,students:2});
  for(let m=0;m<8;m++)  intakes.push({id:id++,kind:'actual',ci,month:m,year:2026,students:3});
  ST.intakes=intakes; ST.ybYear=2026;
  const bud=cbaCompute(ST,'budget',2026), act=cbaCompute(ST,'actual',2026);
  const rb=bud.rows.find(x=>x.ci===ci), ra=act.rows.find(x=>x.ci===ci);
  return { budMonths:rb.months, actMonths:ra.months,
    budReq:cbaReqShown(rb), actReq:cbaReqShown(ra),
    samePace:Math.abs(rb.paceReq-ra.paceReq)<1e-9,
    budLabel:cbaReqColLabel(bud), actLabel:cbaReqColLabel(act) };});
ok('Budget uses the months its own data spans; Actual uses the elapsed months',
   per.budMonths===12 && per.actMonths===8, `budget ${per.budMonths} · actual ${per.actMonths}`);
ok('both bases share one required pace — only the period differs',
   per.samePace && per.actReq<per.budReq, `${per.actReq} vs ${per.budReq}`);
ok('the label carries the selected year on both bases',
   per.budLabel==='\u201926 Operating requirement / yr' &&
   per.actLabel==='\u201926 Operating requirement / yr',
   `${per.budLabel} | ${per.actLabel}`);

// ── Course Simulator assumptions reach Cost-Benefit, and what blocks them ──
const flow = await p.evaluate(()=>{
  const c=COURSES[ST.ci];
  const base=cbaRate(ST,c,'rate');
  ST.tf=base+25; saveToStorage();
  const afterSave=cbaRate(ST,c,'rate');
  ST.cba.rates[c.name]={rate:base+40};
  const withOverride=cbaRate(ST,c,'rate');
  ST.tf=base+60; saveToStorage();
  const editMasked=cbaRate(ST,c,'rate');
  const notice=cbaOverrideNotice(ST,c);
  delete ST.cba.rates[c.name];
  const cleared=cbaRate(ST,c,'rate');
  const noNotice=cbaOverrideNotice(ST,c);
  ST.tf=base; saveToStorage();
  return {base, afterSave, withOverride, editMasked, cleared,
    hasNotice:notice.length>0, noticeNamesField:/Teacher fee/.test(notice), noNotice:noNotice===""};});
ok('a saved Course Simulator edit reaches Cost-Benefit immediately',
   flow.afterSave===flow.base+25);
ok('a Cost-Benefit override masks it, and that is what the notice reports',
   flow.editMasked===flow.withOverride && flow.hasNotice && flow.noticeNamesField);
ok('clearing the override hands control back to the Course Simulator',
   flow.cleared===flow.base+60 && flow.noNotice);

// ── the wording is on screen, in both languages ───────────────────────────
const words = await p.evaluate(()=>{
  const ci=COURSES.findIndex(c=>/^Certificate in General Management/.test(c.name));
  ST.module='cba'; ST.cba.mode='analyse'; ST.cba.sub='course'; ST.cba.chartCi=ci;
  ST.cba.basis='budget'; render();
  const en=document.getElementById('cbacontent').innerText;
  ST.cba.sub='portfolio'; render();
  const enPort=document.getElementById('cbacontent').innerText;
  setLang('zh'); ST.cba.sub='course'; render();
  const zh=document.getElementById('cbacontent').innerText;
  ST.cba.sub='portfolio'; render();
  const zhPort=document.getElementById('cbacontent').innerText;
  setLang('en');
  return {en,enPort,zh,zhPort};});
ok('EN Course view shows the three concepts as one derivation',
   /break-even for one course delivery/i.test(words.en) &&
   /required enrolment pace/i.test(words.en) &&
   /operating requirement/i.test(words.en) &&
   /not a disagreement/i.test(words.en));
ok('EN says which enrolment is compared with which period',
   /compared with the operating requirement/i.test(words.en));
ok('EN gap language is plain, with no bare minus signs',
   /(above|below) requirement|meets requirement/i.test(words.en) &&
   !/above minimum|below minimum/i.test(words.en+words.enPort));
ok('EN Portfolio headers carry the short year and the / yr wording',
   /\u201926 Operating requirement \/ yr/.test(words.enPort) &&
   /Gap to \u201926 requirement/.test(words.enPort) &&
   !/minimum needed/i.test(words.enPort) && !/2026 Operating requirement/.test(words.enPort));
ok('CN Course view carries the same three concepts',
   /单个课程周期盈亏平衡/.test(words.zh) && /所需招生节奏/.test(words.zh) &&
   /运营所需招生人数/.test(words.zh) && /并不矛盾/.test(words.zh));
ok('CN states the basis and period',
   /(预算|实际)招生人数与.*运营所需招生人数进行比较/.test(words.zh));
ok('CN gap language is plain',
   /(高于要求|低于要求|达到要求)/.test(words.zh));
ok('CN Portfolio headers carry the short year',
   /\u201926 年运营所需招生人数 \/ 年/.test(words.zhPort) &&
   /距 \u201926 年运营要求差额/.test(words.zhPort));

// ── the two worked examples, end to end through the UI ───────────────────
const worked = await p.evaluate(()=>{
  const pick=[['Diploma in Business Management',20],['IELTS Preparatory Course',24]];
  const intakes=[]; let id=1;
  pick.forEach(([nm,stu])=>{
    const ci=COURSES.findIndex(c=>c.name===nm);
    for(let m=0;m<12;m++) intakes.push({id:id++,kind:'budget',ci,month:m,year:2026,students:stu/12});
  });
  ST.intakes=intakes; ST.ybYear=2026; ST.cba.basis='budget';
  const d=cbaCompute(ST,'budget',2026);
  const out=pick.map(([nm,stu])=>{
    const ci=COURSES.findIndex(c=>c.name===nm), c=COURSES[ci];
    const R=cbaRolling(ST,c), r=d.rows.find(x=>x.ci===ci);
    return {nm, mo:c.mo, beExact:R.beExact, beDisplay:R.beDisplay, pace:R.pace,
      months:r.months, req:r.reqPeriod, shownReq:cbaReqShown(r),
      students:r.students, gap:cbaGapShown(r), words:cbaGapWords(cbaGapShown(r)),
      oneLine:cbaReqOneLine(ST,r)};
  });
  ST.module='cba'; ST.cba.mode='analyse'; ST.cba.sub='portfolio'; render();
  const ex=d.live.find(x=>x.reqPeriod!=null)||d.rows.find(x=>x.reqPeriod!=null);
  const heads=[...document.querySelectorAll('th')];
  const gapTh=heads.find(h=>/Gap to/i.test(h.textContent));
  const reqTh=heads.find(h=>/Operating requirement/i.test(h.textContent));
  const tipOf=el=>{const i=el&&el.querySelector('.cb-i');
    const v=i&&(i.getAttribute('data-tip')||i.getAttribute('title'))||'';
    const box=document.createElement('div'); box.innerHTML=v; return box.textContent;};
  return {out, header:cbaReqColLabel(d),
    gapHasIcon: !!(gapTh && gapTh.querySelector('.cb-i')),
    reqHasIcon: !!(reqTh && reqTh.querySelector('.cb-i')),
    gapHeader: cbaGapColLabel(d), reqTip: tipOf(reqTh), gapTip: tipOf(gapTh),
    table:document.getElementById('cbacontent').innerText};});
const [dbm,ielts]=worked.out;
ok('DBM: exact break-even over its 8-month delivery gives the required pace',
   dbm.mo===8 && Math.abs(dbm.beExact-7.09)<0.02 && Math.abs(dbm.pace-0.886)<0.01,
   `exact ${dbm.beExact.toFixed(3)} (headline ${dbm.beDisplay}) / ${dbm.mo} mo = ${dbm.pace.toFixed(3)}/mo`);
ok('DBM: the 2026 requirement is 11, rounded up from 10.63',
   dbm.months===12 && Math.abs(dbm.req-10.63)<0.02 && dbm.shownReq===11,
   `${dbm.req.toFixed(2)} -> ${dbm.shownReq}`);
ok('DBM: budget 20 against a requirement of 11 reads "9 above requirement"',
   dbm.students===20 && dbm.gap===9 && /9 above requirement/.test(dbm.words), dbm.words);
ok('IELTS: the same chain holds on its own live values',
   ielts.mo===6 && Math.abs(ielts.pace-ielts.beExact/ielts.mo)<1e-9 &&
   ielts.shownReq===Math.ceil(ielts.pace*ielts.months),
   `exact ${ielts.beExact.toFixed(2)} / ${ielts.mo} mo = ${ielts.pace.toFixed(2)}/mo x ${ielts.months} = ${ielts.req.toFixed(2)} -> ${ielts.shownReq}`);
ok('IELTS: budget 24 reconciles with the displayed requirement',
   ielts.students===24 && ielts.gap===24-ielts.shownReq &&
   new RegExp(`${Math.abs(ielts.gap)} (above|below) requirement`).test(ielts.words), ielts.words);
ok('the derivation line uses the EXACT break-even, not the rounded headline',
   dbm.oneLine.includes(dbm.beExact.toFixed(2)) && !dbm.oneLine.includes(`${dbm.beDisplay} break-even`),
   dbm.oneLine);
ok('the derivation names the period rather than leaving it implicit',
   /needed in 2026/.test(dbm.oneLine) && /needed in 2026/.test(ielts.oneLine));
ok('the column header carries the short year and says per year',
   worked.header==='\u201926 Operating requirement / yr' &&
   worked.table.includes('\u201926 Operating requirement / yr'), worked.header);
ok('the gap header carries the same short year',
   worked.gapHeader==='Gap to \u201926 requirement' &&
   worked.table.includes('Gap to \u201926 requirement'), worked.gapHeader);
ok('both headers carry their own info icon',
   worked.reqHasIcon && worked.gapHasIcon);
ok('the requirement tooltip explains the annualised rolling method',
   /annualised for the selected year/.test(worked.reqTip) &&
   /rolling monthly enrolment pace/.test(worked.reqTip) &&
   /not a minimum class size/.test(worked.reqTip));
ok('the gap tooltip explains the subtraction with an example',
   /Difference between the enrolment figure used in this view/.test(worked.gapTip) &&
   /17 students against a requirement of 10 means 7 above/.test(worked.gapTip));

const hdr2028 = await p.evaluate(()=>{
  ST.intakes=ST.intakes.map(k=>({...k,year:2028})); ST.ybYear=2028;
  return cbaReqColLabel(cbaCompute(ST,'budget',2028));});
ok('the short year follows the selected year', hdr2028==='\u201928 Operating requirement / yr', hdr2028);
const zhHdr = await p.evaluate(()=>{
  setLang('zh');
  const dz=cbaCompute(ST,'budget',2028);
  const h=cbaReqColLabel(dz);
  ST.module='cba'; ST.cba.mode='analyse'; ST.cba.sub='portfolio'; render();
  const t=document.getElementById('cbacontent').innerText;
  const d=cbaCompute(ST,'budget',2028);
  const r=d.live[0]||d.rows.find(x=>x.reqPeriod!=null);
  const line=r?cbaReqOneLine(ST,r):'';
  setLang('en');
  return {h,t,line};});
ok('CN header carries the same short year', zhHdr.h==='\u201928 年运营所需招生人数 / 年', zhHdr.h);
ok('CN derivation line is Chinese and keeps the live figures',
   /个月课程周期精确盈亏平衡为/.test(zhHdr.line) && /每月需/.test(zhHdr.line) && /人/.test(zhHdr.line),
   zhHdr.line);
ok('CN footer describes Advanced without the word minimum',
   await p.evaluate(()=>{ setLang('zh'); ST.cba.view='simple';
     ST.module='cba'; ST.cba.mode='analyse'; ST.cba.sub='portfolio'; render();
     const t=document.getElementById('cbacontent').innerText; setLang('en');
     return /所选期间的运营所需招生人数/.test(t) && !/最低/.test(t);}));
await p.evaluate(()=>{ ST.intakes=ST.intakes.map(k=>({...k,year:2026})); ST.ybYear=2026; });

// ── nothing financial moved ───────────────────────────────────────────────
const fin = await p.evaluate(()=>{
  const d=cbaCompute(ST,'budget',2026);
  return {benefit:d.T.benefit, cost:d.T.cost, bcr:d.T.bcr, contribution:d.T.contribution,
    pool:d.pool, reqSum:d.live.reduce((a,r)=>a+(r.reqPeriod||0),0)};});
ok('the underlying requirement stays unrounded — only the display was made consistent',
   fin.reqSum%1!==0, `sum of unrounded requirements ${fin.reqSum.toFixed(4)}`);
ok('revenue, cost, contribution, BCR and the overhead pool are all still finite numbers',
   [fin.benefit,fin.cost,fin.contribution,fin.pool].every(Number.isFinite) && fin.bcr>0);

if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nconsole errors: '+errs.join(' | ') : '\nno console errors');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
