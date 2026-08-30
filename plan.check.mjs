/* §27/§28 planning solvers: course-level minimum/gap/marginal/full-cost break-even,
   and the UCC break-even planner across all four course mixes.
   node plan.check.mjs -> non-zero exit on failure. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage();
await p.setViewportSize({ width:1440, height:1100 });
const fails=[], errs=[];
p.on('pageerror', e=>errs.push('pageerror: '+e.message));
const ok=(t,c,x='')=>{console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`); if(!c)fails.push(t);};

await p.goto('file://' + process.cwd() + '/ucc_budget_simulator.html');
/* a mix with real budget AND actual enrolment, and one course deliberately small */
await p.evaluate(()=>{
  const prices=COURSES.map(c=>({...c}));
  const intakes=[]; let id=1;
  [[0,30,25],[1,20,22],[2,12,4],[3,40,38]].forEach(([ci,bud,act])=>{
    intakes.push({id:id++,kind:'budget',ci,month:0,year:2026,students:bud});
    intakes.push({id:id++,kind:'actual',ci,month:0,year:2026,students:act});
  });
  localStorage.setItem('ucc_sim_v4', JSON.stringify({prices,intakes,ybYear:2026,module:'cba',
    cba:{driver:'hours',off:{},rates:{},def:{},basis:'actual',otherRev:[]}}));
  localStorage.setItem('ucc_unlocked','ucc2026');
});
await p.reload(); await p.waitForTimeout(500);

// ── §27 course level ──────────────────────────────────────────────────────
const C = await p.evaluate(()=>{
  const d=cbaCompute(ST,'actual',2026);
  const out=[];
  d.rows.filter(r=>r.relevant&&r.included).forEach(r=>{
    const be=cbaSolveCourseBE(ST,r.ci,'actual',2026);
    const mg=cbaMarginal(ST,r.ci,'actual',2026);
    const a=cbaRowAt(ST,r.ci,r.students,'actual',2026);
    const b=cbaRowAt(ST,r.ci,r.students+1,'actual',2026);
    const atBe=be.n!=null?cbaRowAt(ST,r.ci,be.n,'actual',2026):null;
    const below=be.n!=null&&be.n>1?cbaRowAt(ST,r.ci,be.n-1,'actual',2026):null;
    out.push({name:r.name, students:r.students, req:r.reqPeriod, gap:r.opGap,
      contribution:r.contribution, be:be.n, reason:be.reason,
      mgC:mg&&mg.contribution, mgF:mg&&mg.full,
      diffC:b.contribution-a.contribution, diffF:(b.revenue-b.total)-(a.revenue-a.total),
      avg:r.students?r.contribution/r.students:null,
      netAtBe:atBe?atBe.revenue-atBe.total:null,
      netBelow:below?below.revenue-below.total:null, cls:r.cls});
  });
  return out;
});
ok('§27 every included course resolves a full-cost break-even (or a stated reason)',
   C.length>0 && C.every(r=>r.be!=null||r.reason!=='ok'), C.map(r=>`${r.name}:${r.be??r.reason}`).join(' · '));
ok('§27 net full-cost result is >= 0 at the break-even student count',
   C.filter(r=>r.be!=null).every(r=>r.netAtBe>=-0.005),
   C.filter(r=>r.be!=null).map(r=>r.netAtBe.toFixed(2)).join(' · '));
ok('§27 it is the FIRST such count — one student fewer is still negative',
   C.filter(r=>r.be!=null&&r.be>1).every(r=>r.netBelow<0),
   C.filter(r=>r.be!=null&&r.be>1).map(r=>r.netBelow.toFixed(2)).join(' · '));
ok('§27 next-student impact == Scenario(N+1) − Scenario(N), not contribution/students',
   C.every(r=>Math.abs(r.mgC-r.diffC)<0.005 && Math.abs(r.mgF-r.diffF)<0.005));
ok('§27 marginal is genuinely distinct from the average per student',
   C.some(r=>r.avg!=null && Math.abs(r.mgC-r.avg)>0.5),
   C.map(r=>`${r.name} mg ${Math.round(r.mgC)} vs avg ${Math.round(r.avg)}`).join(' · '));
/* class-size step: crossing a class boundary must cost a whole extra class */
const step = await p.evaluate(()=>{
  const d=cbaCompute(ST,'actual',2026);
  const r=d.rows.find(x=>x.included&&x.cls>1);
  if(!r) return null;
  const n=r.cls; /* exactly full class -> next student opens a new class */
  const a=cbaRowAt(ST,r.ci,n,'actual',2026), b=cbaRowAt(ST,r.ci,n+1,'actual',2026);
  const c=cbaRowAt(ST,r.ci,n-1,'actual',2026);
  return {cls:r.cls, aCls:a.classes, bCls:b.classes,
          stepMg:b.contribution-a.contribution, flatMg:a.contribution-c.contribution};
});
ok('§27 the solver respects the class-size step (teaching cost is not linear)',
   step && step.bCls===step.aCls+1 && step.stepMg<step.flatMg,
   step?`classes ${step.aCls}→${step.bCls} · step ${Math.round(step.stepMg)} vs flat ${Math.round(step.flatMg)}`:'no multi-seat class');
ok('§27 minimum enrolment and the gap agree with the rolling-intake requirement',
   C.every(r=>r.req!=null && Math.abs(r.gap-(r.students-r.req))<1e-9));

// ── §28 UCC break-even planner ────────────────────────────────────────────
const U = await p.evaluate(()=>{
  const before=JSON.stringify({prices:ST.prices,intakes:ST.intakes});
  const d=cbaCompute(ST,'actual',2026);
  const res={};
  ['actual','budget','positive','custom'].forEach(k=>{
    if(k==='custom'){ ST.cba.mixCustom={}; d.rows.filter(r=>r.included&&r.hasActivity)
      .slice(0,2).forEach((r,i)=>ST.cba.mixCustom[r.ci]= i===0?70:30); }
    const s=cbaSolveUcc(ST,d,k);
    if(s.err){res[k]={err:s.err};return;}
    const ov={rows:{}}; Object.entries(s.alloc).forEach(([ci,n])=>ov.rows[ci]={students:n});
    const at=cbaCompute(ST,'actual',2026,ov);
    res[k]={total:s.total, current:s.current, added:s.d,
      allocSum:Object.values(s.alloc).reduce((a,x)=>a+x,0),
      ints:Object.values(s.alloc).every(n=>Number.isInteger(n)&&n>=0),
      net:at.T.net, bcr:at.T.bcr,
      netBelow:s.prevNet,
      consBcr:at.T.benefit/at.T.cost};
  });
  return {res, unchanged: before===JSON.stringify({prices:ST.prices,intakes:ST.intakes})};
});
const R=U.res;
ok('§28 all four course mixes resolve a target', ['actual','budget','positive','custom']
   .every(k=>R[k] && !R[k].err), JSON.stringify(Object.fromEntries(Object.entries(R).map(([k,v])=>[k,v.err||v.total]))));
ok('§28 the per-course targets are whole students and sum exactly to the total',
   Object.values(R).every(v=>v.err||(v.allocSum===v.total && v.ints)));
ok('§28 UCC net full-cost result is >= 0 at the target enrolment',
   Object.values(R).every(v=>v.err||v.net>=-0.005),
   Object.entries(R).map(([k,v])=>`${k}:${v.err||v.net.toFixed(2)}`).join(' · '));
ok('§28 the total one student lower still leaves a deficit — the target is the first break-even',
   Object.values(R).every(v=>v.err||v.netBelow<0),
   Object.entries(R).map(([k,v])=>`${k}:${v.err||v.netBelow.toFixed(2)}`).join(' · '));
ok('§28 the mix matters — the targets are not one universal number',
   new Set(Object.values(R).filter(v=>!v.err).map(v=>v.total)).size>1,
   Object.entries(R).map(([k,v])=>`${k}=${v.err||v.total}`).join(' · '));
ok('§28 BCR at target comes from consolidated totals, ~1.00, never averaged course BCRs',
   Object.values(R).every(v=>v.err||(Math.abs(v.bcr-v.consBcr)<1e-9 && v.bcr>=1 && v.bcr<1.05)),
   Object.entries(R).map(([k,v])=>`${k}:${v.err||v.bcr.toFixed(4)}`).join(' · '));
ok('§28 the planner is a sandbox — no live price or enrolment record changed', U.unchanged);

/* the UI path renders and stays a scenario */
const UI = await p.evaluate(()=>{
  ST.module='cba'; ST.cba.mode='manage'; ST.cba.view='advanced';
  ST.cba.bePlan=null; render();
  const before=JSON.stringify(ST.intakes);
  const entry=document.querySelector('[data-cbagobe]');       /* Manage entry point */
  if(entry) entry.click();
  const btn=document.querySelector('[data-cbasolve]');        /* inside the planner */
  if(btn) btn.click();
  const t=document.getElementById('cbacontent').innerText;
  return {had:!!entry&&!!btn, plan:!!ST.cba.bePlan, txt:t, unchanged:before===JSON.stringify(ST.intakes),
    apply:!!document.querySelector('[data-cbabeapply]')};
});
ok('§28 the Manage entry point solves and shows a result', UI.had && UI.plan &&
   /students needed|total students needed/i.test(UI.txt));
ok('§28 solving writes nothing back to the budget and offers no Apply action',
   UI.unchanged && !UI.apply);

/* ── CN: every new planning surface renders in Chinese ────────────────── */
const ZH = await p.evaluate(()=>{
  setLang('zh');
  ST.module='cba'; ST.cba.mode='manage'; ST.cba.view='advanced'; ST.cba.bePlan=null; render();
  const strip=document.getElementById('cbacontent').innerText;
  document.querySelector('[data-cbagobe]').click();
  const planner=document.getElementById('cbacontent').innerText;
  document.querySelector('[data-cbasolve]').click();
  const solved=document.getElementById('cbacontent').innerText;
  ST.cba.mode='analyse'; ST.cba.sub='portfolio'; render();
  const port=document.getElementById('cbacontent').innerText;
  ST.cba.sub='course'; render();
  const course=document.getElementById('cbacontent').innerText;
  ST.cba.sub='compare'; render();
  const cmp=document.getElementById('cbacontent').innerText;
  setLang('en');
  return {strip,planner,solved,port,course,cmp};
});
/* Course titles stay English by instruction, so the leak scan covers only the
   surfaces this task introduced: the Manage strip and the planner. */
const leak = t => [...new Set((t.match(/[A-Za-z][A-Za-z' ]{3,}/g)||[])
  .map(x=>x.trim()).filter(x=>x.length>3))]
  .filter(x=>!/^(UCC|BCR|ROI|Certificate|Diploma|Advanced|Higher|in|and|of|the|Level|English|Business|Management|Artificial|Intelligence|Computing|Data|Science|United|Ceres|College|Tourism|Hospitality|Preparatory|Postgraduate|Course|Language|Mandarin|Primary|Secondary|General|Applied|Learning|Cert|Bus|Admin|IELTS|AEIS|GCE)$/i
    .test(x.split(/\s+/)[0])||!x.split(/\s+/).every(w=>/^(i|UCC|BCR|ROI|FT|PT|AI|IELTS|AEIS|GCE|O|A|Certificate|Diploma|Advanced|Higher|in|and|of|the|Level|English|Business|Management|Artificial|Intelligence|Computing|Data|Science|United|Ceres|College|Tourism|Hospitality|Preparatory|Postgraduate|Course|Language|Mandarin|Primary|Secondary|General|Applied|Learning|Cert|Bus|Admin|Administration)$/i.test(w)));
[['Manage break-even strip',ZH.strip],['break-even planner',ZH.planner],
 ['solver result',ZH.solved]]
  .forEach(([nm,t])=>ok(`CN ${nm} shows no untranslated English`, leak(t).length===0, leak(t).join(' · ')));
/* the new Portfolio / Course / Compare additions, asserted by term */
ok('CN the new Portfolio columns are translated',
   /运营要求/.test(ZH.port) && /距全成本盈亏平衡的学生差额/.test(ZH.port) &&
   /所需招生节奏|每月所需招生人数/.test(ZH.port) && /下一名学生的增量影响/.test(ZH.port) &&
   /全成本盈亏平衡/.test(ZH.port));
ok('CN the Course view enrolment-economics strip is translated',
   /招生经济性/.test(ZH.course) && /下一名学生的增量影响/.test(ZH.course) &&
   /全成本盈亏平衡/.test(ZH.course));
ok('CN the Compare view carries the same planning terms',
   /全成本盈亏平衡/.test(ZH.cmp) && /运营所需招生人数|所需招生节奏/.test(ZH.cmp));
ok('CN the planner keeps its Chinese terminology',
   /UCC 盈亏平衡计划/.test(ZH.planner) && /盈亏平衡课程组合/.test(ZH.planner) &&
   /所需学生总人数/.test(ZH.solved) && /各课程目标/.test(ZH.solved));

if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nconsole errors: '+errs.join(' | ') : '\nno console errors');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
