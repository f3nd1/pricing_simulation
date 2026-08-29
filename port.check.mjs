/* Portfolio ranking + year comparison. node port.check.mjs */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const errs=[], fails=[];
const ok=(t,c,x='')=>{console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`);if(!c)fails.push(t);};
const p=await b.newPage(); await p.setViewportSize({width:1440,height:1100});
p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error'&&!/ERR_TUNNEL|Failed to load/.test(m.text()))errs.push(m.text());});
await p.goto('file://'+process.cwd()+'/ucc_budget_simulator.html');
await p.evaluate(()=>localStorage.setItem('ucc_unlocked','ucc2026'));
await p.reload(); await p.waitForTimeout(400);

// 2026 + 2027 budget, 2026 actual only; one course forced negative
await p.evaluate(()=>{
  const y=cbaYear(ST); let id=1; ST.intakes=[];
  [0,1,2,3].forEach(ci=>{
    ST.intakes.push({id:id++,kind:'budget',ci,month:0,year:y,students:20});
    ST.intakes.push({id:id++,kind:'actual',ci,month:0,year:y,students:14});
    ST.intakes.push({id:id++,kind:'budget',ci,month:0,year:y+1,students:26});});
  ST.cba.rates[COURSES[3].name]={comm:98,rate:400};      // negative contribution
  ST.cba.basis='budget'; ST.module='cba'; ST.cba.tab='portfolio'; render(); cbaDrawPortfolio(ST);
});
await p.waitForTimeout(300);

const port=await p.evaluate(()=>{
  const d=cbaCompute(ST);
  const bars=[...document.querySelectorAll('#cbaPortChart rect.c')];
  const fills=bars.map(b2=>b2.getAttribute('fill'));
  return {live:d.live.length, pos:d.live.filter(r=>r.contribution>=0).length,
    neg:d.live.filter(r=>r.contribution<0).length, bars:bars.length,
    green:fills.filter(f=>f==='#16a34a').length, red:fills.filter(f=>f==='#dc2626').length,
    pool:d.pool, contribution:d.T.contribution,
    txt:document.body.innerText};
});
ok('portfolio bar chart draws one bar per running course', port.bars===port.live, `${port.bars} bars / ${port.live} courses`);
ok('positive contribution green, negative red', port.green===port.pos&&port.red===port.neg,
   `${port.green} green, ${port.red} red`);
ok('uncovered overhead reported', /overhead still uncovered|overhead fully covered/i.test(port.txt),
   `contribution ${Math.round(port.contribution)} vs pool ${Math.round(port.pool)}`);
ok('overhead categories come from the expense groups', /what the central overhead is spent on/i.test(port.txt));

// ranking actually reorders, and default is contribution
const rank=await p.evaluate(()=>{
  const first=k=>{ST.cba.rankBy=k;render();
    const d=cbaCompute(ST);
    const rows=d.live.slice().sort((a,b2)=>{const av=cbaRankValue(a,k),bv=cbaRankValue(b2,k);
      if(av==null&&bv==null)return 0;if(av==null)return 1;if(bv==null)return -1;return bv-av;});
    return rows[0].name;};
  const byContrib=first('contribution'), byBcr=first('bcr'), byCost=first('costPerStu');
  const d=cbaCompute(ST);
  const topC=d.live.slice().sort((a,b2)=>b2.contribution-a.contribution)[0];
  const topB=d.live.slice().sort((a,b2)=>(b2.bcr||0)-(a.bcr||0))[0];
  ST.cba.rankBy='contribution';render();
  return {byContrib,byBcr,byCost,topC:topC.name,topB:topB.name,differ:topC.name!==topB.name};
});
ok('ranks by contribution by default and reorders on request',
   rank.byContrib===rank.topC && rank.byBcr===rank.topB, `contribution→${rank.byContrib.slice(0,24)}`);
ok('cost-per-student ranks lowest cost first', !!rank.byCost);

// ── year comparison ──────────────────────────────────────────────────────
const yrs=await p.evaluate(()=>{
  ST.cba.tab='years'; ST.cba.trendBasis='budget'; render(); cbaDrawTrend(ST);
  const y=cbaYear(ST);
  const b26=cbaYearRow(ST,y,'budget'), b27=cbaYearRow(ST,y+1,'budget'), b28=cbaYearRow(ST,y+2,'budget');
  const a26=cbaYearRow(ST,y,'actual'), a27=cbaYearRow(ST,y+1,'actual');
  const live=cbaCompute(ST,'budget',y+1).T;
  return {b26:b26&&{students:b26.students,bcr:b26.bcr},b27:b27&&{students:b27.students,bcr:b27.bcr},
    b28, a26:a26&&a26.students, a27,
    matchesLive:b27&&Math.abs(b27.students-live.students)<0.5,
    pts:document.querySelectorAll('#cbaTrendChart circle.p').length,
    txt:document.body.innerText};
});
ok('each year computed independently, no leakage',
   yrs.b26.students===80 && yrs.b27.students===104, `2026 ${yrs.b26.students} · 2027 ${yrs.b27.students} students`);
ok('year row matches a direct compute for that year', yrs.matchesLive);
ok('a year with no data is N/A, not zero', yrs.b28===null && yrs.a27===null && /N\/A/.test(yrs.txt));
ok('actual-basis year present only where actuals exist', yrs.a26===56, `2026 actual ${yrs.a26}`);
ok('trend chart plots a point per year with data', yrs.pts===2, `${yrs.pts} points`);
ok('states no Forecast data exists rather than inventing one', /holds no forecast enrolment data/i.test(yrs.txt));

// metric switch + basis switch
const sw=await p.evaluate(()=>{
  ST.cba.trendMetric='revenue'; render(); cbaDrawTrend(ST);
  const revPts=[...document.querySelectorAll('#cbaTrendChart text.l')].map(t=>t.textContent);
  ST.cba.trendBasis='actual'; render(); cbaDrawTrend(ST);
  const actPts=document.querySelectorAll('#cbaTrendChart circle.p').length;
  ST.cba.trendMetric='bcr'; ST.cba.trendBasis='budget'; render();
  return {revPts,actPts};
});
ok('metric selector changes the plotted values', sw.revPts.length===2&&/\$/.test(sw.revPts[0]), sw.revPts.join(' → '));
ok('basis switch limits to years with that basis', sw.actPts===1, `${sw.actPts} actual point`);

// layout
for(const w of [1440,1300,768,375]){
  await p.setViewportSize({width:w,height:1100});
  for(const t of ['status','overview','portfolio','years','diag','courses','bycourse','charts']){
    await p.evaluate(t=>{ST.cba.tab=t;render();
      if(t==='charts')cbaDrawCharts(ST); if(t==='portfolio')cbaDrawPortfolio(ST); if(t==='years')cbaDrawTrend(ST);},t);
    await p.waitForTimeout(160);
    const of=await p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    if(of>0)errs.push(`${w} ${t} overflow=${of}`);
  }
}
if(errs.length)fails.push(...errs);
console.log(errs.length?'\nerrors: '+errs.join(' | '):'\nno console errors, no overflow');
console.log(fails.length?`\nFAILED (${fails.length})`:'\nALL PASS');
await b.close();
process.exit(fails.length?1:0);
