/* CN-mode English leak audit.
   Walks the rendered application in Simplified Chinese and flags visible Latin
   text that is application-owned UI. Course names, user-entered content,
   approved acronyms and brand names are exempted semantically — from the live
   data, not from a whitelist of sentences.
   node cn.check.mjs            -> non-zero exit on any leak
   node cn.check.mjs --report   -> print every leak grouped by screen, exit 0 */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const REPORT = process.argv.includes('--report');
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage();
await p.setViewportSize({ width:1440, height:1200 });
const errs=[];
p.on('pageerror', e=>errs.push('pageerror: '+e.message));

await p.goto('file://' + process.cwd() + '/ucc_budget_simulator.html');
await p.evaluate(()=>{ localStorage.setItem('ucc_unlocked','ucc2026'); localStorage.setItem('ucc_lang','zh'); });
await p.reload(); await p.waitForTimeout(600);

/* the exemption vocabulary, derived from live data + an approved token list */
await p.evaluate(()=>{
  const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  /* every word that appears in a canonical course name or abbreviation */
  const courseWords = new Set();
  COURSES.forEach(c=>{ [c.name,c.abbr,c.group].forEach(v=>norm(v).split(' ').forEach(w=>w&&courseWords.add(w))); });
  /* user-entered content currently in state */
  const userWords = new Set();
  const collectUser = v => norm(v).split(' ').forEach(w=>w&&userWords.add(w));
  (ST.saved||[]).forEach(s=>collectUser(s.name));
  ((ST.strat&&ST.strat.cases)||[]).forEach(c=>collectUser(c.name));
  Object.keys((ST.fx&&ST.fx.savedPeriods)||{}).forEach(collectUser);
  /* approved acronyms, brands and units */
  const TOKENS = `ucc united ceres college edutrust cdac mbmf band ca ca4 fcff pp
    roi bcr ebitda gst cpf fps opex capex cogs fte npv fcf irr dcf
    wacc pl p l ai ielts aeis gce o a level ft pt supabase gpt 4o mini json csv pdf
    en cn i x v vs id url api db sql y n q1 q2 q3 q4 fy ytd mo yr sgd usd`.split(/\s+/);
  TOKENS.forEach(t=>courseWords.add(t));
  window.__CNX = { courseWords, userWords, norm };
  window.__I18N_TRACE = new Set();
});

/* one screen: every visible Latin run that is not exempt */
const scan = () => p.evaluate(() => {
  const { courseWords, userWords, norm } = window.__CNX;
  const out = new Map();
  const exempt = run => {
    const words = norm(run).split(' ').filter(Boolean);
    if (!words.length) return true;
    return words.every(w => /^\d+$/.test(w) || courseWords.has(w) || userWords.has(w));
  };
  const add = (txt, where) => {
    /* Latin runs of two or more letters, keeping intra-run punctuation */
    (String(txt).match(/[A-Za-z][A-Za-z0-9'’&/().,%\- ]*[A-Za-z0-9)%]|[A-Za-z]{2,}/g) || [])
      .map(s=>s.trim()).filter(s=>s.length>1 && !exempt(s))
      .forEach(s => { if(!out.has(s)) out.set(s, where); });
  };
  const vis = el => { const r=el.getBoundingClientRect?el.getBoundingClientRect():null;
    return !r || r.width>0 || r.height>0 || el.closest('[hidden]')===null; };
  const root = document.getElementById('app') || document.body;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode()); ) {
    const el = n.parentElement;
    if (!el || el.closest('script,style')) continue;
    if (el.closest('[data-i18n-skip]')) continue;      /* course names, user data, commit text */
    if (getComputedStyle(el).display === 'none' || !vis(el)) continue;
    add(n.nodeValue, el.tagName.toLowerCase() + (el.className?'.'+String(el.className).split(' ')[0]:''));
  }
  root.querySelectorAll('[title],[placeholder],[aria-label],[data-tip],[alt]').forEach(el=>{
    if (el.closest('[data-i18n-skip]')) return;
    ['title','placeholder','aria-label','alt'].forEach(a=>{
      if(el.hasAttribute(a)) add(el.getAttribute(a), '@'+a); });
    /* data-tip carries HTML by design — scan its text, not its markup */
    if(el.hasAttribute('data-tip')){
      const d=document.createElement('div'); d.innerHTML=el.getAttribute('data-tip');
      add(d.textContent, '@data-tip'); }
  });
  /* the floating tooltip and any open dialog live outside #app */
  document.querySelectorAll('.cb-tip, dialog[open], .modal, .sheet').forEach(el=>{
    if(getComputedStyle(el).display!=='none') add(el.innerText, 'overlay'); });
  return [...out].map(([t,where])=>({t,where}));
});

/* Walk every module, then every tab / view toggle the module actually renders.
   Driving the real controls means the audit cannot drift from the UI. */
const MODS = await p.evaluate(()=>MODULES.map(m=>[m.key,m.label]));
const found = new Map();
const record = async name => {
  const leaks = await scan();
  if (leaks.length) {
    const prev = found.get(name) || [];
    const seen = new Set(prev.map(l=>l.t));
    found.set(name, prev.concat(leaks.filter(l=>!seen.has(l.t))));
  }
};
/* selectors for anything that switches a view without leaving the module */
const TABSEL = '.tab, .tabs button, [data-tab], [data-optab], [data-valtab], [data-strattab],'
  + ' [data-fxtab], [data-logtab], [data-ybview], [data-cbamode], [data-cbasub],'
  + ' [data-cbaview], [data-cbascen], [data-cbapresent], .view-toggle button, [data-view]';
for (const [key,label] of MODS) {
  await p.evaluate(k=>{ ST.module=k; render(); }, key);
  await p.waitForTimeout(80);
  await record(label);
  const n = await p.evaluate(sel=>document.querySelectorAll(sel).length, TABSEL);
  for (let i=0;i<n;i++){
    const tab = await p.evaluate(([sel,i,k])=>{
      ST.module=k; render();
      const els=[...document.querySelectorAll(sel)];
      if(!els[i]) return null;
      const t=(els[i].innerText||els[i].getAttribute('aria-label')||'').trim().slice(0,24);
      els[i].click();
      return t||('#'+i);
    }, [TABSEL,i,key]);
    if(tab==null) continue;
    await p.waitForTimeout(60);
    await record(`${label} · ${tab}`);
  }
}
/* click-reached surfaces: Cloud Save and the break-even planner */
await p.evaluate(()=>{ const el=document.getElementById('cloudOpenBtn'); if(el) el.click(); });
await p.waitForTimeout(250);
await record('Cloud Save dialog');
await p.evaluate(()=>{ document.querySelectorAll('[data-cloudclose],[aria-label="Close"]').forEach(e=>e.click()); });
await p.evaluate(()=>{ ST.module='cba'; ST.cba.mode='manage'; ST.cba.view='advanced'; render();
  const e=document.querySelector('[data-cbagobe]'); if(e)e.click();
  const s=document.querySelector('[data-cbasolve]'); if(s)s.click(); });
await p.waitForTimeout(80);
await record('Cost-Benefit · break-even planner');

/* the exact untranslated source strings, straight from the i18n fallback path */
const miss = await p.evaluate(()=>{
  const prot = i18nProtected();
  const ex = window.__CNX;
  const allowed = t => ex.norm(t).split(' ').filter(Boolean)
    .every(w => /^\d+$/.test(w) || ex.courseWords.has(w) || ex.userWords.has(w));
  return [...window.__I18N_TRACE]
    .filter(t=>!prot.has(t) && !/[\u4e00-\u9fff]/.test(t) && !allowed(t)).sort();
});
if (process.argv.includes('--miss')) { miss.forEach(t=>console.log(t)); await b.close(); process.exit(0); }
console.log(`\ni18n fallback misses: ${miss.length} distinct source strings`);

let total = 0;
const byModule = new Map();
for (const [screen, leaks] of found) {
  total += leaks.length;
  const mod = screen.split(' · ')[0];
  byModule.set(mod, (byModule.get(mod)||0) + leaks.length);
  if (REPORT) {
    console.log(`\n### ${screen}  (${leaks.length})`);
    leaks.forEach(l => console.log(`   ${l.t}   [${l.where}]`));
  }
}
const uniq = new Set();
for (const [,leaks] of found) leaks.forEach(l=>uniq.add(l.t));
console.log('\n=== CN leak summary ===');
[...byModule].sort((a,b)=>b[1]-a[1]).forEach(([m,n])=>console.log(`  ${String(n).padStart(4)}  ${m}`));
console.log(`  ${String(total).padStart(4)}  TOTAL occurrences`);
console.log(`  ${String(uniq.size).padStart(4)}  DISTINCT strings`);
if (errs.length) console.log('console errors: ' + errs.join(' | '));
await b.close();
if (REPORT) { console.log('\n--- distinct ---'); [...uniq].sort().forEach(t=>console.log(t)); }
process.exit(REPORT ? 0 : (total || errs.length ? 1 : 0));
