/* Contextual help across Cost-Benefit: every mode and subview explains itself,
   in both languages, without a second tooltip mechanism and without touching
   financial state.  node help.check.mjs -> non-zero exit on failure. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage();
await p.setViewportSize({ width:1440, height:1100 });
const fails=[], errs=[];
p.on('pageerror', e=>errs.push('pageerror: '+e.message));
const ok=(t,c,x='')=>{console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`); if(!c)fails.push(t);};

await p.goto('file://' + process.cwd() + '/ucc_budget_simulator.html');
await p.evaluate(()=>{
  const prices=COURSES.map(c=>({...c})); const intakes=[]; let id=1;
  [[0,30,25],[1,20,22],[2,12,4],[3,40,38]].forEach(([ci,bud,act])=>{
    for(let m=0;m<12;m++){ intakes.push({id:id++,kind:'budget',ci,month:m,year:2026,students:bud/12});
      if(m<9) intakes.push({id:id++,kind:'actual',ci,month:m,year:2026,students:act/9}); }});
  localStorage.setItem('ucc_sim_v4',JSON.stringify({prices,intakes,ybYear:2026,module:'cba',
    cba:{driver:'hours',off:{},rates:{},def:{},basis:'budget',otherRev:[]}}));
  localStorage.setItem('ucc_unlocked','ucc2026');});
await p.reload(); await p.waitForTimeout(500);

/* the tooltip text reachable from a screen, via the one existing component */
const tipsOn = (code) => p.evaluate((code)=>{
  eval(code); render();
  return [...document.querySelectorAll('#app [data-tip]')].map(el=>{
    const d=document.createElement('div'); d.innerHTML=el.getAttribute('data-tip');
    return d.textContent; });
}, code);

const SCREENS=[
 ['Manage',"ST.module='cba';ST.cba.mode='manage';",
  [/Management overview of the current Cost-Benefit position/,/Best for: starting your review/]],
 ['Analyse → Portfolio',"ST.cba.mode='analyse';ST.cba.sub='portfolio';",
  [/See all analysed courses together/,/Best for: finding issues and opportunities/,
   /Portfolio = Find/,/Course = Understand/,/Compare = Decide/]],
 ['Analyse → Course',"ST.cba.mode='analyse';ST.cba.sub='course';",
  [/Deep-dive into one course/,/Best for: understanding why a course has its current result/]],
 ['Analyse → Compare',"ST.cba.mode='analyse';ST.cba.sub='compare';",
  [/Compare 2 to 4 courses side by side/,/Best for: comparing alternatives before a decision/]],
 ['UCC Break-even',"ST.cba.mode='breakeven';",
  [/Estimate how many total enrolments UCC needs/,/not the break-even of one individual course/,
   /The assumed proportion of students across courses/,
   /Uses the current Actual enrolment proportions/,
   /Uses the course proportions planned in the selected Budget/,
   /Assumes additional enrolment is directed only to courses/,
   /not a prediction that student demand will follow this mix/,
   /Choose your own enrolment proportions/]],
 ['Simulate → One course',"ST.cba.mode='simulate';ST.cba.scenSub='course';",
  [/Change assumptions for one course in a sandbox/,/Best for: what-if testing one course/]],
 ['Simulate → Whole portfolio',"ST.cba.mode='simulate';ST.cba.scenSub='portfolio';",
  [/Test changes across several courses together/,/Best for: testing a combined enrolment/]],
 ['Present → Management report',"ST.cba.mode='present';ST.cba.presentSub='report';",
  [/concise management-ready summary/,/Best for: management or board review/]],
 ['Present → Trends',"ST.cba.mode='present';ST.cba.presentSub='trends';",
  [/Compare Cost-Benefit results across multiple years/,/Best for: seeing direction over time/]],
];
for (const [name, code, wants] of SCREENS){
  const tips=(await tipsOn(code)).join(' ~ ');
  const missing=wants.filter(re=>!re.test(tips));
  ok(`${name} explains itself`, missing.length===0, missing.map(String).join(' · '));
}
/* the module-level guide, reachable from every mode */
const guide = await tipsOn("ST.cba.mode='manage';");
ok('a single "How to use Cost-Benefit" entry covers all five modes',
   /Start here\. See what needs attention/.test(guide.join(' ')) &&
   /Understand the portfolio and individual courses/.test(guide.join(' ')) &&
   /Estimate what UCC needs as a whole/.test(guide.join(' ')) &&
   /Test what-if scenarios without changing live data/.test(guide.join(' ')) &&
   /Turn the analysis into a management view or trend report/.test(guide.join(' ')));

/* one mechanism, not two */
const mech = await p.evaluate(()=>({
  infoIcons:document.querySelectorAll('#app .cb-i').length,
  tipEls:document.querySelectorAll('.cb-tip').length,
  allHaveTip:[...document.querySelectorAll('#app .cb-i')].every(e=>e.hasAttribute('data-tip'))}));
ok('help reuses the single existing tooltip component',
   mech.tipEls===1 && mech.infoIcons>0 && mech.allHaveTip, `${mech.infoIcons} icons, ${mech.tipEls} tooltip element`);

/* accessibility */
const a11y = await p.evaluate(()=>{
  ST.cba.mode='breakeven'; render();
  const icons=[...document.querySelectorAll('#app .cb-i')];
  const labelled=icons.every(e=>e.getAttribute('aria-label')&&e.getAttribute('role')==='button'
                              &&e.getAttribute('tabindex')==='0');
  const first=icons[0]; first.focus();
  const focused=document.activeElement===first;
  first.dispatchEvent(new FocusEvent('focus'));
  const shownOnFocus=document.querySelector('.cb-tip').classList.contains('on');
  first.click();
  const stuck=document.querySelector('.cb-tip').classList.contains('on');
  first.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
  const closed=!document.querySelector('.cb-tip').classList.contains('on');
  return {labelled,focused,shownOnFocus,stuck,closed,n:icons.length};});
ok('every info icon is focusable and labelled for assistive tech',
   a11y.labelled && a11y.focused, `${a11y.n} icons`);
ok('keyboard focus opens the help and Escape closes it',
   a11y.shownOnFocus && a11y.closed);
ok('a tap keeps the help open instead of timing out mid-sentence', a11y.stuck);

/* CN */
const zh = await p.evaluate(()=>{
  setLang('zh');
  const grab=code=>{eval(code);render();
    return [...document.querySelectorAll('#app [data-tip]')].map(el=>{
      const d=document.createElement('div'); d.innerHTML=el.getAttribute('data-tip');
      return d.textContent;}).join(' ~ ');};
  const out={
    manage:grab("ST.cba.mode='manage'"),
    analyse:grab("ST.cba.mode='analyse';ST.cba.sub='portfolio'"),
    course:grab("ST.cba.mode='analyse';ST.cba.sub='course'"),
    compare:grab("ST.cba.mode='analyse';ST.cba.sub='compare'"),
    be:grab("ST.cba.mode='breakeven'"),
    sim:grab("ST.cba.mode='simulate';ST.cba.scenSub='course'"),
    simP:grab("ST.cba.mode='simulate';ST.cba.scenSub='portfolio'"),
    rep:grab("ST.cba.mode='present';ST.cba.presentSub='report'"),
    tre:grab("ST.cba.mode='present';ST.cba.presentSub='trends'")};
  setLang('en');
  return out;});
ok('CN Manage, Analyse and the mental model',
   /当前成本效益状况的管理概览/.test(zh.manage) && /从整体查看所有已分析课程/.test(zh.analyse) &&
   /课程组合 = 找问题/.test(zh.analyse) && /单个课程 = 看原因/.test(zh.analyse) &&
   /课程比较 = 做比较/.test(zh.analyse));
ok('CN Course and Compare',
   /深入查看单个课程的招生情况/.test(zh.course) && /使用相同指标并排比较/.test(zh.compare));
ok('CN UCC Break-even and every mix option',
   /估算在所选课程组合下/.test(zh.be) && /并不是单个课程的盈亏平衡/.test(zh.be) &&
   /计算 UCC 盈亏平衡时所假设的学生在不同课程之间的分布比例/.test(zh.be) &&
   /按照目前各课程实际招生的比例/.test(zh.be) && /按照所选预算中规划的课程招生比例/.test(zh.be) &&
   /假设新增招生只进入目前扣除课程自身直接成本后仍有正向贡献的课程/.test(zh.be) &&
   /这是规划情景/.test(zh.be) && /自行设定各课程的招生比例/.test(zh.be));
ok('CN Simulate and Present',
   /在沙盒情景中调整单个课程的假设/.test(zh.sim) && /同时测试多个课程的变化/.test(zh.simP) &&
   /面向管理层的简明成本效益总结/.test(zh.rep) && /比较多个年度的成本效益结果/.test(zh.tre));
ok('CN module guide', /从这里开始，查看当前最需要关注的事项/.test(zh.manage) &&
   /在不修改实时数据的情况下测试假设情景/.test(zh.manage));

/* responsive, and help never moves a number */
const resp=[];
for (const w of [1440,1280,768,375]){
  await p.setViewportSize({width:w,height:900});
  for (const [name,code] of SCREENS.map(x=>[x[0],x[1]])){
    const r=await p.evaluate((code)=>{ eval(code); render();
      const icon=document.querySelector('#app .cb-i');
      let clipped=false;
      if(icon){ icon.click();
        const t=document.querySelector('.cb-tip').getBoundingClientRect();
        clipped = t.left<0 || t.top<0 || t.right>window.innerWidth+1 || t.bottom>window.innerHeight+1;
        document.body.click(); }
      return {of:document.documentElement.scrollWidth-document.documentElement.clientWidth, clipped};}, code);
    if(r.of>1||r.clipped) resp.push(`${w}px ${name} overflow ${r.of} clipped ${r.clipped}`);
  }
}
ok('no horizontal overflow and no clipped popover at 1440, 1280, 768 or 375',
   resp.length===0, resp.slice(0,3).join(' | '));
await p.setViewportSize({width:1440,height:1100});

const fin = await p.evaluate(()=>{
  const before=JSON.stringify(cbaCompute(ST).T);
  document.querySelectorAll('#app .cb-i').forEach(e=>e.click());
  document.body.click();
  return before===JSON.stringify(cbaCompute(ST).T);});
ok('opening help changes no financial state', fin);

if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nconsole errors: '+errs.join(' | ') : '\nno console errors');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
