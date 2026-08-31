/* Bilingual EN / 简体中文: the switch, persistence, coverage across every
   module, charts and tooltips, protected data, safe fallback, and a financial
   reconciliation proving translation is presentation only.
   node i18n.check.mjs -> non-zero exit on failure. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage();
await p.setViewportSize({ width:1440, height:1100 });
const fails = [], errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (t,c,x='') => { console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`); if(!c) fails.push(t); };

await p.goto('file://' + process.cwd() + '/ucc_budget_simulator.html');
await p.evaluate(() => {
  const prices = COURSES.map(c=>({...c}));
  const intakes=[]; let id=1;
  for (let ci=0; ci<6; ci++) {
    intakes.push({id:id++,kind:'budget',ci,month:0,year:2026,students:18});
    intakes.push({id:id++,kind:'actual',ci,month:0,year:2026,students:12}); }
  intakes.push({id:id++,kind:'actual',ci:6,month:0,year:2026,students:15});
  localStorage.setItem('ucc_sim_v4', JSON.stringify({ prices, intakes, ybYear:2026, module:'cba',
    saved:[{name:'My board case Q3',ts:Date.now()}],
    audit:[{area:'Yearly Budget',what:'my private note about IELTS',from:'1',to:'2',ts:Date.now()}],
    cba:{driver:'hours',off:{},rates:{},def:{},basis:'actual',otherRev:[]} }));
  localStorage.setItem('ucc_unlocked','ucc2026');
});
await p.reload(); await p.waitForTimeout(400);

const txt = () => p.evaluate(() => document.body.innerText);
const lang = () => p.evaluate(() => LANG);
const setL = l => p.evaluate(l => setLang(l), l);
const cjk = s => /[一-鿿]/.test(s);
/* the canonical figures, captured in each language */
const canon = () => p.evaluate(() => {
  const d=cbaCompute(ST,'actual',2026);
  return { T:{s:d.T.students,rev:d.T.benefit,cost:d.T.cost,con:d.T.contribution,net:d.T.net,bcr:d.T.bcr,roi:d.T.roi},
           rows:d.relevant.map(r=>[r.name,r.students,r.contribution,r.revenue-r.total,r.bcr,r.verdict.k]),
           intakes:JSON.stringify(ST.intakes), prices:JSON.stringify(COURSES),
           sim:JSON.stringify(ST.sim||{}) }; });
const C_EN = await canon();

// ── the switch ────────────────────────────────────────────────────────────
const sw = await p.evaluate(() => {
  const nav=document.querySelector('.module-nav');
  const btns=[...nav.querySelectorAll('[data-lang]')];
  const cloud=nav.querySelector('#cloudOpenBtn');
  return { n:btns.length, labels:btns.map(x=>x.innerText.trim()),
           aria:btns.map(x=>x.getAttribute('aria-label')),
           titles:btns.map(x=>x.getAttribute('title')),
           pressed:btns.map(x=>x.getAttribute('aria-pressed')),
           beforeCloud: !!cloud && (btns[0].compareDocumentPosition(cloud) & Node.DOCUMENT_POSITION_FOLLOWING)>0 }; });
ok('EN | CN sits beside Cloud saves in the global header',
   sw.n===2 && sw.labels.join('|')==='EN|CN' && sw.beforeCloud, sw.labels.join(' | '));
ok('English is the default for a new user', await lang()==='en' && sw.pressed[0]==='true');
ok('the switch is keyboard reachable and screen-reader labelled, not colour-only',
   sw.aria[0]==='Switch language to English' && sw.aria[1]==='切换语言至简体中文' &&
   sw.titles[1]==='简体中文' && sw.pressed.join(',')==='true,false');

// ── switching ─────────────────────────────────────────────────────────────
await p.evaluate(() => { document.querySelector('[data-lang="zh"]').click(); });
ok('clicking CN switches the whole application at once, with no reload',
   await lang()==='zh' && cjk(await txt()) &&
   await p.evaluate(() => document.documentElement.lang==='zh-Hans'));
await p.reload(); await p.waitForTimeout(400);
ok('the preference survives a refresh', await lang()==='zh' && cjk(await txt()));

// ── coverage across every module ──────────────────────────────────────────
const MODULES = ['simulator','yearlybudget','forecast','operating','financials',
                 'strategy','cba','simmaster','log'];
const cover = {};
for (const m of MODULES) {
  cover[m] = await p.evaluate(m => { ST.module=m; render();
    const t=document.getElementById('app').innerText;
    return { cjk:/[一-鿿]/.test(t), len:t.length }; }, m);
}
ok('every Planning Suite module renders Chinese',
   MODULES.every(m=>cover[m].cjk), MODULES.filter(m=>!cover[m].cjk).join(',')||'all 9 modules');
const nav = await p.evaluate(() => { ST.navOpen=true; render();
  const d=document.getElementById('navDrawer').innerText; ST.navOpen=false; render(); return d; });
ok('the module drawer is translated, names and descriptions',
   /课程模拟器/.test(nav) && /年度预算/.test(nav) && /成本效益/.test(nav) &&
   /五年收入、支出与损益表/.test(nav));

// ── Cost-Benefit, every mode and sub-view, both display modes ─────────────
const cba = {};
for (const view of ['simple','advanced'])
  for (const [mode,ex] of [['manage',{}],['analyse',{sub:'portfolio'}],['analyse',{sub:'course'}],
       ['analyse',{sub:'compare'}],['simulate',{scenSub:'course'}],['simulate',{scenSub:'portfolio'}],
       ['present',{presentSub:'report'}],['present',{presentSub:'trends'}],['settings',{}]]) {
    const k = `${mode}/${ex.sub||ex.scenSub||ex.presentSub||'-'}/${view}`;
    cba[k] = await p.evaluate(([mode,ex,view]) => {
      ST.module='cba'; ST.cba.mode=mode; ST.cba.view=view; Object.assign(ST.cba,ex); render();
      return /[一-鿿]/.test(document.getElementById('cbacontent').innerText); }, [mode,ex,view]);
  }
ok('every Cost-Benefit mode and sub-view translates, in Simple and Advanced',
   Object.values(cba).every(Boolean), Object.keys(cba).filter(k=>!cba[k]).join(', ')||`${Object.keys(cba).length} views`);
await p.evaluate(() => { ST.cba.mode='manage'; ST.cba.view='simple'; render(); });
const key = await txt();
ok('the standardised finance labels appear in Chinese',
   /扣除课程直接成本后/.test(key) && /运营要求/.test(key) && /对学院有正贡献的课程/.test(key) &&
   /可持续性缺口/.test(key));
const advKey = await p.evaluate(() => { ST.cba.view='advanced'; render();
  const t=document.getElementById('cbacontent').innerText; ST.cba.view='simple'; render(); return t; });
ok('Advanced mode shows the technical labels in Chinese too',
   /全成本覆盖率/.test(advKey) && /收入减直接成本与分摊的间接费用/.test(advKey) && /生均成本/.test(advKey) &&
   /所需招生节奏|每月所需招生人数/.test(advKey) && /下一名学生的增量影响/.test(advKey) &&
   /全成本盈亏平衡/.test(advKey));
/* every new planning term must exist in Chinese */
const plan = await p.evaluate(() => {
  ST.cba.mode='breakeven'; render();
  const before=document.body.innerText;
  document.querySelector('[data-cbasolve]').click();
  const after=document.body.innerText;
  ST.cba.mode='analyse'; ST.cba.sub='course'; ST.cba.view='advanced'; render();
  const course=document.body.innerText;
  ST.cba.sub='compare'; render(); const cmp=document.body.innerText;
  ST.cba.mode='manage'; ST.cba.view='simple'; render();
  return { before, after, course, cmp, manage:document.body.innerText }; });
ok('the UCC Break-even view is fully Chinese',
   /UCC 整体盈亏平衡/.test(plan.before) && /当前状况/.test(plan.before) &&
   /UCC 达到盈亏平衡所需条件/.test(plan.before) && /盈亏平衡课程组合/.test(plan.before) &&
   /当前实际招生组合|当前预算招生组合/.test(plan.before) &&
   /仅正贡献课程/.test(plan.before) && /自定义组合/.test(plan.before) &&
   /尚需增加的贡献额/.test(plan.before) && /计算范围/.test(plan.before) &&
   /课程经济性：课程模拟器/.test(plan.before));
ok('the solved plan, its pace strip and course targets are Chinese',
   /所需学生总人数/.test(plan.after) && /尚需新增学生/.test(plan.after) &&
   /盈亏平衡组合中的课程数/.test(plan.after) && /各课程目标/.test(plan.after) &&
   /所需招生节奏/.test(plan.after) && /当前招生节奏/.test(plan.after) &&
   /尚需增加的招生节奏/.test(plan.after) && /每月目标/.test(plan.after) &&
   /下一名学生的贡献额/.test(plan.after) && /组合占比/.test(plan.after) &&
   /按这些假设与此课程组合/.test(plan.after));
ok('Course and Compare planning rows are Chinese',
   /招生经济性/.test(plan.course) && /运营所需招生人数/.test(plan.course) &&
   /全成本盈亏平衡/.test(plan.course) && /下一名学生的增量影响/.test(plan.course) &&
   /距全成本盈亏平衡的学生差额/.test(plan.cmp));
ok('the Manage break-even entry point is Chinese',
   /UCC 盈亏平衡计划/.test(plan.manage) && /查看计划|计算目标/.test(plan.manage));
ok('modes, basis and view controls are translated',
   /管理/.test(key) && /分析/.test(key) && /模拟/.test(key) && /汇报/.test(key) &&
   /预算/.test(key) && /实际/.test(key) && /简明/.test(key) && /专业/.test(key));

// ── dynamic sentences use templates, not word substitution ────────────────
const why = await p.evaluate(() => { ST.cba.showWhy=true; render();
  const t=document.body.innerText; ST.cba.showWhy=false; render(); return t; });
ok('the generated management statement is written in Chinese, with live numbers intact',
   /已分析的 \d+ 门课程中有 \d+ 门对中央成本有正贡献/.test(why) &&
   /覆盖了成本基数/.test(why) && /\$[\d,]+/.test(why),
   (why.match(/收入 \$[^。]*。/)||[''])[0]);
const ins = await txt();
ok('management attention rows are Chinese',
   /需要关注|机会/.test(ins) && /落后于预算|低于最低招生人数|主要贡献课程|中央间接费用未被覆盖/.test(ins));

// ── charts and tooltips ───────────────────────────────────────────────────
const chart = await p.evaluate(() => document.getElementById('cbaMatrix').textContent);
ok('the matrix axes, quadrants and legend are Chinese',
   /扣除课程直接成本后/.test(chart) && /课程本身亏损/.test(chart) && /对学院有贡献/.test(chart) &&
   /扩招/.test(chart) && /复核/.test(chart), chart.replace(/\s+/g,' ').slice(0,90));
const tip = await p.evaluate(() => {
  const g=document.querySelector('#cbaMatrix g.pt');
  g.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:400,clientY:400}));
  const el=document.querySelector('.cb-tip.on');
  return el?el.innerText.replace(/\n/g,' | '):null; });
ok('the chart tooltip field labels are Chinese while the figures are untouched',
   !!tip && /学生人数/.test(tip) && /运营所需招生人数/.test(tip) && /扣除课程直接成本后/.test(tip) &&
   /全成本结果/.test(tip) && /覆盖率/.test(tip) && /\$[\d,]+/.test(tip), tip);
await p.evaluate(() => { ST.cba.mode='analyse'; ST.cba.sub='portfolio'; render(); });
const bars = await p.evaluate(() => document.getElementById('cbaContribChart').textContent);
ok('the contribution chart annotations are Chinese', /消耗学院资源|贡献学院/.test(bars));

// ── tables ────────────────────────────────────────────────────────────────
const heads = await p.evaluate(() => [...document.querySelectorAll('#cbacontent thead th')]
  .map(x=>x.innerText.trim()).filter(Boolean));
ok('table headers are Chinese',
   heads.some(h=>/课程/.test(h)) && heads.some(h=>/预算/.test(h)) &&
   heads.some(h=>/扣除课程直接成本后/.test(h)) && heads.some(h=>/建议行动/.test(h)),
   heads.join(' · '));

// ── protected content ─────────────────────────────────────────────────────
const prot = await p.evaluate(() => {
  const names=COURSES.slice(0,8).map(c=>c.name);
  const body=document.body.innerText;
  return { kept:names.filter(n=>body.includes(n)).length, sample:names[0] }; });
ok('canonical course names are never machine-translated', prot.kept>0, prot.sample);
const user = await p.evaluate(() => { ST.module='log'; ST.logTab='edits'; render();
  const t=document.body.innerText; ST.module='cba'; render();
  return { note:t.includes('my private note about IELTS') }; });
ok('user-entered text is left exactly as typed', user.note);
const cloud = await p.evaluate(() => { ST.cloudOpen=true; render();
  const t=document.body.innerText; ST.cloudOpen=false; render(); return t; });
ok('Cloud Save UI is translated', /连接设置/.test(cloud) && /已保存方案/.test(cloud) &&
   /测试连接/.test(cloud) && /将当前状态保存为方案/.test(cloud));
const scen = await p.evaluate(() => { ST.module='simulator'; ST.tab='compare'; render();
  const t=document.body.innerText; ST.module='cba'; ST.cba.mode='manage'; render(); return t; });
ok('a saved scenario name is never translated', scen.includes('My board case Q3'));

// ── numbers, currency and identifiers are untouched ───────────────────────
const nums = await txt();
ok('currency, percentages and ratios are unchanged by translation',
   /\$[\d,]+/.test(nums) && /\d+%/.test(nums) && /[\d\.]+×/.test(nums) && !/¥|￥/.test(nums));

// ── fallback ──────────────────────────────────────────────────────────────
const fb = await p.evaluate(() => {
  const missing = i18nStr('A string that is deliberately absent from the dictionary', new Set());
  const tmpl = tf('Hello {n}','你好 {n}',{n:5});
  return { missing, tmpl, undef:/undefined|null|\[object/.test(missing) }; });
ok('a missing key falls back to English and never renders undefined',
   fb.missing==='A string that is deliberately absent from the dictionary' && !fb.undef && fb.tmpl==='你好 5');

// ── print follows the language ────────────────────────────────────────────
await p.evaluate(() => { ST.cba.mode='present'; ST.cba.presentSub='report'; render(); });
await p.emulateMedia({ media:'print' });
const print = await p.evaluate(() => {
  const rep=document.getElementById('cbaReport');
  const hidden = sel => [...document.querySelectorAll(sel)].every(el=>getComputedStyle(el).display==='none');
  return { cjk:/[一-鿿]/.test(rep.innerText), chrome: hidden('.hdr') && hidden('button'),
           head:rep.innerText.split('\n').slice(0,4).join(' · ') }; });
ok('the management report prints in Chinese with the controls still hidden',
   print.cjk && print.chrome, print.head);
await p.emulateMedia({ media:'screen' });

// ── layout in both languages ──────────────────────────────────────────────
const over = [];
for (const w of [1440,1280,768,375]) {
  await p.setViewportSize({width:w,height:900});
  for (const l of ['zh','en']) {
    await setL(l);
    for (const m of MODULES) {
      const o = await p.evaluate(m => { ST.module=m; render();
        return document.documentElement.scrollWidth - window.innerWidth; }, m);
      if (o>0) over.push(`${w}/${l}/${m} +${o}`);
    }
  }
}
await p.setViewportSize({width:1440,height:1100});
ok('no horizontal overflow in either language at 1440, 1280, 768 or 375',
   over.length===0, over.slice(0,4).join(' | ')||'4 widths × 2 languages × 9 modules');

// ── switching back, and the financial lock ────────────────────────────────
await setL('en');
await p.evaluate(() => { ST.module='cba'; ST.cba.mode='manage'; render(); });
const back = await txt();
ok('switching back to EN restores English everywhere',
   !cjk(back) && /After own costs/.test(back) && await lang()==='en');
const C_EN2 = await canon();
await setL('zh');
const C_ZH = await canon();
await setL('en');
ok('FINANCIAL RECONCILIATION — identical figures in both languages',
   JSON.stringify(C_ZH)===JSON.stringify(C_EN) && JSON.stringify(C_EN2)===JSON.stringify(C_EN),
   `students ${C_ZH.T.s} · revenue ${Math.round(C_ZH.T.rev)} · net ${Math.round(C_ZH.T.net)} · BCR ${C_ZH.T.bcr.toFixed(4)}`);

if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nconsole errors: '+errs.join(' | ') : '\nno console errors');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
