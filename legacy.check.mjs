/* UPGRADE TEST — a v1.5x localStorage payload loaded by the current build.
   Everything is asserted against the RENDERED DOM, not helper return values,
   because a correct helper behind a column that never renders is still broken.
   node legacy.check.mjs -> non-zero exit on failure. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage();
await p.setViewportSize({ width:1440, height:1000 });
const fails = [], errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (t,c,x='') => { console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`); if(!c) fails.push(t); };

const AI = 'Diploma in Applied Artificial Intelligence';

await p.goto('file://' + process.cwd() + '/ucc_budget_simulator.html');

/* Build a payload the way an older build would have written it: the AI diploma
   added by the user, stale exclusions from the old "Only courses with students"
   button, a smaster block with no `enrol` group key, and cba.scope:"active". */
const seeded = await p.evaluate(([AI]) => {
  const prices = COURSES.map(c=>({...c}));
  /* the AI diploma is a real registry course — use its real index, and add one
     user-added course too, the way an upgrading user's catalogue actually looks */
  const aiCi = prices.findIndex(c=>c.name===AI);
  prices.push({name:'ZZ User Added Course',cat:'Diploma',fee:8000,mat:0,exam:0,admin:0,app:0,hrs:200,mo:6});
  const intakes = [];
  let id = 1;
  /* AI diploma: 2026 actual 15 across three months, no budget at all */
  [[0,5],[4,6],[8,4]].forEach(([m,n]) => intakes.push({id:id++,kind:'actual',ci:aiCi,month:m,year:2026,students:n}));
  /* two ordinary courses with budget and actual */
  [0,1].forEach(ci => [0,6].forEach(m => {
    intakes.push({id:id++,kind:'budget',ci,month:m,year:2026,students:12});
    intakes.push({id:id++,kind:'actual',ci,month:m,year:2026,students:10}); }));
  intakes.push({id:id++,kind:'budget',ci:0,month:0,year:2027,students:30});
  /* the stale exclusion an old build wrote: budget-only snapshot, so every
     course without BUDGET students was switched off — including the AI diploma */
  const off = {}; prices.forEach(c => {
    if(!intakes.some(i=>i.ci===prices.indexOf(c)&&(i.kind||'budget')==='budget'&&i.year===2026&&i.students>0))
      off[c.name]=true; });
  const legacy = {
    prices, ci:0, tab:'sim', module:'cba', intakes, ybYear:2026, ybCat:'All', ybView:'monthly',
    sim:{ [AI]:{disc:0,agent:40,uni:0,tf:70,cp:100,plan:9,act:40,aDisc:0,aAgent:40,aUni:0,ulecMgmt:500} },
    smaster:{q:'',cat:'All',onlyActive:false,groups:{sim:true,oh:true,act:true,sub:true,price:true}},
    cba:{tab:'status',scope:'active',rankBy:'contribution',driver:'hours',off,rates:{},def:{},
         acadPct:0,chartCi:0,chartMode:'full',basis:'budget',otherRev:[],showRates:false},
    audit:[]
  };
  localStorage.setItem('ucc_sim_v4', JSON.stringify(legacy));
  localStorage.setItem('ucc_unlocked','ucc2026');
  return { aiCi, offCount:Object.keys(off).length, aiOff:!!off[AI] };
}, [AI]);
ok('legacy fixture carries a stale exclusion on the AI diploma',
   seeded.aiOff, `${seeded.offCount} courses switched off by the old bulk button`);

await p.reload(); await p.waitForTimeout(500);

// ── §4 the course's real records after the upgrade load ────────────────────
const rec = await p.evaluate(([AI]) => {
  const ci = COURSES.findIndex(c=>c.name===AI);
  const of = k => ST.intakes.filter(i=>i.ci===ci&&i.year===2026&&(i.kind||'budget')===k);
  return { ci, name:(COURSES[ci]||{}).name,
    budRecs: of('budget').map(i=>`${i.month}:${i.students}`),
    actRecs: of('actual').map(i=>`${i.month}:${i.students}`),
    bud: of('budget').reduce((a,i)=>a+i.students,0),
    act: of('actual').reduce((a,i)=>a+i.students,0),
    included: cbaOn(ST,COURSES[ci]), offFlag: ST.cba.off[AI]===true,
    simExists: !!(ST.sim&&ST.sim[AI]), priceExists: !!COURSES[ci],
    ybYear: ST.ybYear, cbaYear: cbaYear(ST), basis: ST.cba.basis, scope: ST.cba.scope };
}, [AI]);
console.log('\n  AI diploma after legacy load:', JSON.stringify(rec,null,1).replace(/\n/g,'\n  '), '\n');
ok('legacy state survives the upgrade intact', rec.ci>=0 && rec.act===15 && rec.bud===0 &&
   rec.offFlag===true && rec.simExists && rec.priceExists,
   `ci ${rec.ci} · budget ${rec.bud} · actual ${rec.act} · excluded ${rec.offFlag}`);

const ci = rec.ci;
const text = () => p.evaluate(() => document.body.innerText);
const go = (mod,tab,basis,scope) => p.evaluate(([mod,tab,basis,scope]) => {
  ST.module=mod; if(tab)cbaGo(ST,tab); if(basis)ST.cba.basis=basis; if(scope)ST.cba.scope=scope;
  saveToStorage(); render(); }, [mod,tab,basis,scope]);

// ── §3 Simulator Inputs must SHOW the enrolment columns, by default ────────
await go('simmaster');
const sm = await p.evaluate(([AI,ci]) => {
  const heads = [...document.querySelectorAll('th')].map(t=>t.innerText.trim());
  const row = [...document.querySelectorAll('tbody tr')].find(tr=>tr.innerText.includes(AI));
  const cells = row ? [...row.querySelectorAll('td')].map(t=>t.innerText.trim()) : null;
  const grp = [...document.querySelectorAll('[data-smgrp]')].map(b=>b.innerText.trim());
  return { heads, cells, grp, groups:JSON.parse(JSON.stringify(ST.smaster.groups)),
           bodyHasYear: /Enrolment 2026/i.test(document.body.innerText) };
}, [AI,ci]);
ok('§3 the Enrolment group is ON by default after a legacy load, not hidden',
   sm.groups.enrol===true, `smaster.groups = ${JSON.stringify(sm.groups)}`);
ok('§3 Simulator Inputs renders an explicitly year-labelled enrolment header',
   sm.bodyHasYear, sm.heads.filter(h=>/enrolment/i.test(h)).join(' | ') || '(none)');
ok('§3 the AI diploma row shows its real 2026 Actual 15 in the rendered DOM',
   !!sm.cells && sm.cells.includes('15'),
   sm.cells ? sm.cells.slice(0,10).join(' | ') : 'row not rendered');
/* §14 two different "Actual" concepts must not share a label */
const actHeads = sm.heads.filter(h=>/actual/i.test(h) && !/^actual (discount|agent|uni)/i.test(h));
ok('§14 the simulator assumption and the Yearly Budget enrolment have distinct names',
   new Set(actHeads).size === actHeads.length &&
   actHeads.some(h=>/simulator actual/i.test(h)) && actHeads.some(h=>/actual enrolments/i.test(h)),
   actHeads.join(' | '));

// ── §8/§9 Course Status counts and the three views, in the DOM ─────────────
await go('cba','status','actual','incl');
let t = await text();
ok('§8 counts are factual: the excluded course still raises "with Actual enrolment"',
   /Excluded but actual enrolment[\s\S]{0,40}?1/i.test(t.replace(/\n/g,' ')) ||
   /1[\s\S]{0,10}Excluded but/i.test(t.replace(/\n/g,' ')),
   (t.match(/Configured courses[\s\S]{0,220}/i)||[''])[0].replace(/\n+/g,' · ').slice(0,220));
ok('§7 the upgrade warning names the excluded course and its student count',
   /excluded from this analysis/i.test(t) && t.includes(AI) && /\(15\)/.test(t));

const inView = () => p.evaluate(([AI]) => {
  const tbl = [...document.querySelectorAll('table')].find(x=>/Action/i.test(x.innerText));
  return !!(tbl && tbl.innerText.includes(AI)); }, [AI]);
const v1 = await inView();
await go('cba','status','actual','activity'); const v2 = await inView();
const v2txt = await p.evaluate(([AI]) => {
  const tr = [...document.querySelectorAll('tbody tr')].find(x=>x.innerText.includes(AI));
  return tr ? tr.innerText.replace(/\n/g,' | ') : null; }, [AI]);
await go('cba','status','actual','all'); const v3 = await inView();
await go('cba','status','actual','incl');
ok('§9 Included+activity hides it · All activity shows it · All configured shows it',
   v1===false && v2===true && v3===true, `incl ${v1} · activity ${v2} · all ${v3}`);
ok('§9 in All activity the row keeps 15 and is badged Excluded',
   !!v2txt && /15/.test(v2txt) && /Excluded/i.test(v2txt), v2txt);

// ── §10 Include in analysis, through the real button ───────────────────────
await go('cba','status','actual','activity');
const before = await p.evaluate(() => { const d=cbaCompute(ST,'actual');
  return {rev:d.T.benefit,dir:d.T.direct,con:d.T.contribution,bcr:d.T.bcr,n:d.counts.both}; });
const clicked = await p.evaluate(([AI]) => {
  const btn = document.querySelector(`[data-cbainc="${AI.replace(/"/g,'&quot;')}"]`);
  if(!btn) return false; btn.click(); return true; }, [AI]);
ok('§10 the "Include in analysis" button exists on the excluded row', clicked);
const after = await p.evaluate(() => { const d=cbaCompute(ST,'actual');
  return {rev:d.T.benefit,dir:d.T.direct,con:d.T.contribution,bcr:d.T.bcr,n:d.counts.both,
          included:cbaOn(ST,COURSES.length&&COURSES[COURSES.length-1])}; });
ok('§10 including it moves revenue, direct cost, contribution and BCR at once',
   after.n===before.n+1 && after.rev>before.rev && after.dir>before.dir && after.bcr!==before.bcr,
   `analysed ${before.n}→${after.n} · revenue ${Math.round(before.rev)}→${Math.round(after.rev)} · BCR ${before.bcr?.toFixed(3)}→${after.bcr?.toFixed(3)}`);
const ybIntact = await p.evaluate(([ci]) => ST.intakes.filter(i=>i.ci===ci&&i.year===2026&&i.kind==='actual')
  .reduce((a,i)=>a+i.students,0), [ci]);
ok('§10 Yearly Budget is untouched by the inclusion change', ybIntact===15, `${ybIntact} actual`);

// ── §11/§12 edit through the real Yearly Budget UI, then navigate ──────────
const edited = await p.evaluate(([ci]) => {
  ST.module='yearlybudget'; ST.ybYear=2026; ST.ybForm.kind='actual'; render();
  const ik = ST.intakes.find(i=>i.ci===ci&&i.year===2026&&i.kind==='actual');
  const inp = document.querySelector(`[data-ikstu="${ik.id}"]`);
  if(!inp) return {found:false};
  inp.value = String(ik.students+1);
  inp.dispatchEvent(new Event('change',{bubbles:true}));   /* the real handler */
  return {found:true, id:ik.id, now:ik.students};
}, [ci]);
ok('§11 the Yearly Budget student input is editable and its handler fires',
   edited.found && edited.now===6, `intake now ${edited.now}`);
await go('simmaster');
const smAfter = await p.evaluate(([AI]) => {
  const row = [...document.querySelectorAll('tbody tr')].find(tr=>tr.innerText.includes(AI));
  return row ? [...row.querySelectorAll('td')].map(t=>t.innerText.trim()) : null; }, [AI]);
ok('§11 Simulator Inputs shows 16 after the edit, with no page reload',
   !!smAfter && smAfter.includes('16'), (smAfter||[]).slice(0,10).join(' | '));
await go('cba','status','actual','activity');
const cbaAfter = await p.evaluate(([AI]) => {
  const tr = [...document.querySelectorAll('tbody tr')].find(x=>x.innerText.includes(AI));
  return tr ? tr.innerText.replace(/\n/g,' | ') : null; }, [AI]);
ok('§11 Cost-Benefit All activity shows 16 too', !!cbaAfter && /\b16\b/.test(cbaAfter), cbaAfter);

const budIndep = await p.evaluate(([ci]) => {
  ST.intakes.push({id:88888,kind:'budget',ci,month:1,year:2026,students:7}); saveToStorage();
  const b=cbaCompute(ST,'budget'), a=cbaCompute(ST,'actual');
  return { bud:b.rows.find(r=>r.ci===ci).students, act:a.rows.find(r=>r.ci===ci).students }; }, [ci]);
ok('§12 adding Budget 7 does not disturb Actual 16',
   budIndep.bud===7 && budIndep.act===16, `budget ${budIndep.bud} · actual ${budIndep.act}`);
const yrIndep = await p.evaluate(([ci]) => {
  ST.ybYear=2027; render(); const a=cbaCompute(ST,'actual').rows.find(r=>r.ci===ci).students;
  ST.ybYear=2026; render(); const b=cbaCompute(ST,'actual').rows.find(r=>r.ci===ci).students;
  return {y2027:a, y2026:b}; }, [ci]);
ok('§18 years stay independent', yrIndep.y2027===0 && yrIndep.y2026===16,
   `2027 ${yrIndep.y2027} · 2026 ${yrIndep.y2026}`);

// ── §18 reload persistence, through the DOM ────────────────────────────────
await p.evaluate(() => { ST.module='simmaster'; saveToStorage(); });
await p.reload(); await p.waitForTimeout(500);
const persisted = await p.evaluate(([AI]) => {
  const row = [...document.querySelectorAll('tbody tr')].find(tr=>tr.innerText.includes(AI));
  return { cells: row?[...row.querySelectorAll('td')].map(t=>t.innerText.trim()):null,
           groups: JSON.parse(JSON.stringify(ST.smaster.groups)) }; }, [AI]);
ok('§18 after a real reload the enrolment columns are still shown and still 16',
   !!persisted.cells && persisted.cells.includes('16') && persisted.groups.enrol===true,
   (persisted.cells||[]).slice(0,10).join(' | '));

// ── §16 a legacy cloud snapshot through applyFullSnapshot ──────────────────
const cloud = await p.evaluate(([AI,ci]) => {
  const snap = JSON.parse(JSON.stringify(buildFullSnapshot()));
  delete snap.cba.scope;                       /* an older snapshot had no scope */
  ST.intakes=[]; ST.cba.off={}; render();
  applyFullSnapshot(snap); ST.module='simmaster'; render();
  const row=[...document.querySelectorAll('tbody tr')].find(tr=>tr.innerText.includes(AI));
  return { cells: row?[...row.querySelectorAll('td')].map(t=>t.innerText.trim()):null,
           scope: cbaScope(ST),
           act: cbaCompute(ST,'actual').rows.find(r=>r.ci===ci).students }; }, [AI,ci]);
ok('§16 a legacy cloud snapshot restores and every screen re-reads it',
   !!cloud.cells && cloud.cells.includes('16') && cloud.act===16 && !!cloud.scope,
   `Simulator Inputs 16 · Cost-Benefit ${cloud.act} · scope "${cloud.scope}"`);

if (errs.length) fails.push(...errs);
console.log(errs.length ? '\nconsole errors: '+errs.join(' | ') : '\nno console errors');
console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASS');
await b.close();
process.exit(fails.length ? 1 : 0);
