import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const {chromium}=pkg;
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const errs=[]; const fails=[];
const ok=(t,c,x='')=>{console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`);if(!c)fails.push(t);};
for(const w of [1440,1300,768,375]){
  const p=await b.newPage();
  p.on('pageerror',e=>errs.push(w+' '+e.message));
  p.on('console',m=>{if(m.type()==='error'&&!/ERR_TUNNEL|Failed to load/.test(m.text()))errs.push(w+' '+m.text());});
  await p.setViewportSize({width:w,height:1100});
  await p.goto('file:///home/user/pricing_simulation/ucc_budget_simulator.html');
  await p.evaluate(()=>localStorage.setItem('ucc_unlocked','ucc2026'));
  await p.reload(); await p.waitForTimeout(400);
  await p.evaluate(()=>{const y=cbaYear(ST),IE=COURSES.findIndex(c=>/IELTS/i.test(c.name));let id=1;ST.intakes=[];
    for(let m=0;m<12;m++)ST.intakes.push({id:id++,kind:'budget',ci:IE,month:m,year:y,students:2});
    for(let m=0;m<9;m++)ST.intakes.push({id:id++,kind:'actual',ci:IE,month:m,year:y,students:m<8?2:1});
    [1,2].forEach(ci=>[0,6].forEach(m=>{ST.intakes.push({id:id++,kind:'budget',ci,month:m,year:y,students:15});
      ST.intakes.push({id:id++,kind:'actual',ci,month:m,year:y,students:12});}));
    ST.cba.runBasis='one';ST.cba.chartCi=IE;ST.module='cba';});
  for(const t of ['status','overview','diag','courses','bycourse','charts']){
    for(const bs of ['budget','actual']){
      await p.evaluate(([t,bs])=>{ST.cba.tab=t;ST.cba.basis=bs;render();if(t==='charts')cbaDrawCharts(ST);},[t,bs]);
      await p.waitForTimeout(200);
      const of=await p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
      if(of>0)errs.push(`${w} ${t}/${bs} overflow=${of}`);
    }
  }
  if(w===1440){
    const m=await p.evaluate(()=>{ST.cba.tab='diag';ST.cba.basis='actual';render();
      const r=cbaCompute(ST,'actual').live.find(x=>x.ci===ST.cba.chartCi);
      const f0=cbaFeeScenario(r,0),f5=cbaFeeScenario(r,0.05);
      const c0=cbaRateScenario(r,Math.round(r.comm*100),0),c30=cbaRateScenario(r,30,0);
      return {rev:r.revenue,direct:r.direct,contrib:r.contribution,teach:r.teaching,comm:r.commission,
        feeBaseMatches:Math.abs(f0.contribution-r.contribution)<0.01,
        fee5Gain:Math.round(f5.perStu-f0.perStu),
        commPerStu:Math.round(r.commission/r.students),
        commGain:Math.round(c30.perStu-c0.perStu),
        c0Matches:Math.abs(c0.contribution-r.contribution)<0.01,
        txt:document.body.innerText};});
    ok('scenario engine reuses the live formulas (0% fee change = live figures)',m.feeBaseMatches&&m.c0Matches);
    ok('revenue − direct = contribution holds in diagnostics',Math.abs((m.rev-m.direct)-m.contrib)<0.5,
       `${Math.round(m.rev)} − ${Math.round(m.direct)} = ${Math.round(m.contrib)}`);
    ok('teaching + commission = direct',Math.abs((m.teach+m.comm)-m.direct)<0.5);
    ok('fee +5% shows a per-student gain net of commission',m.fee5Gain>0,`+$${m.fee5Gain}/student`);
    ok('commission cut 40%→30% quantified in dollars',m.commGain>0,
       `commission costs $${m.commPerStu}/student; −10pp gives +$${m.commGain}/student`);
    ok('states Price List is untouched',/scenario only\s*—\s*price list unchanged/i.test(m.txt));
    ok('discloses discount / uni commission are not in the figures',/not currently in the cost-benefit figures/i.test(m.txt));
    ok('names the largest direct cost driver',/is the largest direct cost/i.test(m.txt));
  }
  await p.close();
}
console.log('ERRORS:',errs.length?errs:'none');
console.log(fails.length?`FAILED (${fails.length})`:'ALL PASS');
await b.close();
process.exit(fails.length||errs.length?1:0);
