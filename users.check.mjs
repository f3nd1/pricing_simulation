/* Users & access: the three guards, the ported rules, and the refusal paths
   that read as success if nobody checks them.
   node users.check.mjs -> non-zero exit on failure.

   Served over HTTP because the entry gate needs an origin OAuth could use;
   the REST calls are intercepted, so no request reaches Supabase. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http'; import fs from 'node:fs';
const { chromium } = pkg;
const srv=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});
  r.end(fs.readFileSync(process.cwd()+'/ucc_budget_simulator.html'));});
await new Promise(r=>srv.listen(8797,'127.0.0.1',r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const errs=[],fails=[];
const ok=(t,c,x='')=>{console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`);if(!c)fails.push(t);};
const p=await b.newPage(); await p.setViewportSize({width:1440,height:1000});
p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:8797/');
await p.evaluate(()=>localStorage.setItem('ucc_auth',JSON.stringify({access_token:'h.e30.s',
  refresh_token:'t',expires_at:Math.floor(Date.now()/1000)+86400,email:'renzo@unitedceres.edu.sg'})));
await p.reload();
/* Let the startup adminResolve() settle before any test sets a verdict,
   or its late reply overwrites what the test just established. */
await p.waitForTimeout(800);
await p.waitForFunction(()=>ADMINV.checked===true||!sbReady(),{timeout:8000}).catch(()=>{});

/* Fake Supabase. Every reply is scripted, so the tests exercise OUR handling
   of a refusal rather than the database's willingness to produce one. */
const install = (script) => p.evaluate(s=>{
  window.__calls=[];
  window.fetch=async(url,opt)=>{
    const u=String(url),m=(opt&&opt.method)||'GET';
    window.__calls.push(m+' '+u.replace(/^https?:\/\/[^/]+/,''));
    for(const r of s){
      if(new RegExp(r.match).test(u)&&(!r.method||r.method===m))
        return {ok:r.status===undefined||r.status<400,status:r.status||200,
          json:async()=>r.body,text:async()=>JSON.stringify(r.body)};
    }
    return {ok:false,status:404,json:async()=>({}),text:async()=>'{}'};
  };}, script);

const AS = (any,root) => p.evaluate(([a,r])=>{ADMINV={checked:true,any:a,root:r};},[any,root]);

// ── guard 1 and 2 ────────────────────────────────────────────────────────
const g = await p.evaluate(()=>{
  ADMINV={checked:false,any:false,root:false};
  ST.module='simulator'; render();
  const drawer=document.querySelector('.nav-drawer');
  const inDrawer=!!drawer&&/Users & access/.test(drawer.innerText);
  ST.module='users'; render();
  const t=document.getElementById('app').innerText;
  return {inDrawer, refused:/Not available/i.test(t), noForm:!document.getElementById('usrAddInput'),
    saysAsk:/ask an administrator/i.test(t)};});
ok('the drawer hides Users & access from a non-admin', !g.inDrawer);
ok('NAVIGATING STRAIGHT TO THE MODULE IS REFUSED, not just unlinked',
   g.refused && g.noForm, 'render_() refuses independently of the drawer');
ok('the refusal says who to ask, by role rather than by name', g.saysAsk);

const g2 = await p.evaluate(()=>{
  ADMINV={checked:true,any:true,root:false};
  ST.module='simulator'; render();
  const inDrawer=/Users & access/.test(document.querySelector('.nav-drawer').innerText);
  return {inDrawer};});
ok('an admin sees the entry in the drawer', g2.inDrawer);

// ── the admin verdict comes from the database, and fails closed ─────────
await install([{match:'/rpc/is_any_admin',body:true},{match:'/rpc/is_admin',body:false}]);
const rpc = await p.evaluate(async()=>{ADMINV={checked:false,any:false,root:false};
  const v=await adminResolve();
  return {v, calls:window.__calls.filter(c=>/rpc/.test(c))};});
ok('the admin verdict is asked of the database, not recomputed here',
   rpc.v.any===true && rpc.v.root===false &&
   rpc.calls.some(c=>/rpc\/is_any_admin/.test(c)) && rpc.calls.some(c=>/rpc\/is_admin/.test(c)),
   rpc.calls.join(' · '));
for (const [label,script] of [
  ['an error reply', [{match:'/rpc/',status:500,body:{}}]],
  ['a non-true reply', [{match:'/rpc/',body:'yes'}]],
  ['a null reply', [{match:'/rpc/',body:null}]]]){
  await install(script);
  const v=await p.evaluate(async()=>{ADMINV={checked:false,any:false,root:false};return await adminResolve();});
  ok(`FAILS CLOSED on ${label} — not known and could not check both mean not an admin`,
     v.any===false && v.root===false);
}

// ── a refused DELETE arrives as zero rows and NO error ──────────────────
await AS(true,true);
await install([{match:'/allowed_users',method:'DELETE',status:200,body:[]}]);
const refusedDel = await p.evaluate(async()=>await usrRemove('someone@unitedceres.edu.sg'));
ok('A REFUSED REMOVAL IS NOT REPORTED AS SUCCESS — zero rows means refused',
   refusedDel.ok===false && /refused/i.test(refusedDel.reason), refusedDel.reason.slice(0,60));
await install([{match:'/allowed_users',method:'DELETE',status:200,body:[{email:'someone@unitedceres.edu.sg'}]}]);
const okDel = await p.evaluate(async()=>await usrRemove('someone@unitedceres.edu.sg'));
ok('a removal that really happened is reported as success', okDel.ok===true);
await install([{match:'/admin_grants',method:'DELETE',status:200,body:[]}]);
const refusedRev = await p.evaluate(async()=>await usrRevoke('x@unitedceres.edu.sg'));
ok('the same is true of revoking an administrator', refusedRev.ok===false);
await install([{match:'/ucc_saves',method:'DELETE',status:200,body:[]}]);
const refusedScen = await p.evaluate(async()=>{ST.sbStatus='';await sbDeleteScenario(1);return ST.sbStatus;});
ok('AND OF DELETING A CLOUD SCENARIO — the pre-existing defect', /refused/i.test(refusedScen||''),
   (refusedScen||'').slice(0,70));

// ── the address rules ───────────────────────────────────────────────────
const addr = await p.evaluate(()=>{
  const c=(r,e)=>usrCheckAddress(r,e||[]);
  return {blank:c(''),noAt:c('felix'),wrongDomain:c('a@gmail.com'),
    lookalike:c('a@unitedceres.edu.sg.attacker.com'),
    space:c('a b@unitedceres.edu.sg'),
    dupe:c('A@UnitedCeres.Edu.Sg',['a@unitedceres.edu.sg']),
    good:c('  New.Person@UnitedCeres.Edu.Sg  ')};});
ok('a blank address is refused', !addr.blank.ok);
ok('an address with no @ is refused', !addr.noAt.ok);
ok('a personal address is refused before it is sent', !addr.wrongDomain.ok &&
   /Only @unitedceres\.edu\.sg/.test(addr.wrongDomain.reason));
ok('a lookalike domain is refused', !addr.lookalike.ok);
ok('a space before the @ is refused', !addr.space.ok);
ok('a duplicate is caught regardless of case', !addr.dupe.ok && /already on the list/i.test(addr.dupe.reason));
ok('a good address is trimmed and lower-cased', addr.good.ok && addr.good.email==='new.person@unitedceres.edu.sg');

// ── both pinned rows explain themselves ─────────────────────────────────
const pins = await p.evaluate(()=>({
  root:usrRemovalBlocked('felix@unitedceres.edu.sg'),
  self:usrRemovalBlocked('renzo@unitedceres.edu.sg'),
  other:usrRemovalBlocked('someone@unitedceres.edu.sg'),
  rootMixedCase:usrRemovalBlocked('Felix@UnitedCeres.Edu.Sg')}));
ok('THE ROOT ROW IS PINNED AND SAYS WHY', !!pins.root && /main administrator/i.test(pins.root));
ok('YOUR OWN ROW IS PINNED AND SAYS WHY — gd4 explains only the root',
   !!pins.self && /your own account/i.test(pins.self));
ok('the pin is case-insensitive', !!pins.rootMixedCase);
ok('anybody else can be removed', pins.other===null);

// ── writes refuse before they are sent ──────────────────────────────────
await AS(false,false);
await install([{match:'.',body:[]}]);
const blocked = await p.evaluate(async()=>{
  window.__calls=[];
  const a=await usrAdd('x@unitedceres.edu.sg');
  const g=await usrGrant('x@unitedceres.edu.sg');
  return {a,g,writes:window.__calls.filter(c=>/^(POST|DELETE)/.test(c)&&!/rpc/.test(c))};});
ok('a non-admin write is refused BEFORE any request is sent',
   !blocked.a.ok && !blocked.g.ok && blocked.writes.length===0,
   `${blocked.writes.length} requests attempted`);
await AS(true,false);
const grantBlocked = await p.evaluate(async()=>await usrGrant('x@unitedceres.edu.sg'));
ok('a DELEGATED admin cannot grant administrator — only the root can',
   !grantBlocked.ok && /main administrator/i.test(grantBlocked.reason));

// ── a missing admin_grants degrades, it does not blank the page ─────────
await AS(true,true);
await install([
  {match:'/allowed_users',body:[{email:'felix@unitedceres.edu.sg',note:null,added_at:null},
                                {email:'renzo@unitedceres.edu.sg',note:null,added_at:null}]},
  {match:'/admin_grants',status:404,body:{code:'42P01',message:'relation does not exist'}}]);
const degraded = await p.evaluate(async()=>{
  ST.module='users'; ST.users.people=null; ST.users.loadError='';
  await usrRefresh();
  const t=document.getElementById('app').innerText;
  return {missing:ST.users.grantsMissing, peopleShown:(ST.users.people||[]).length,
    says:/not set up on this database yet/i.test(t), stillRenders:!!document.getElementById('usrAddInput')};});
ok('A MISSING admin_grants DEGRADES — the sign-in list still renders',
   degraded.missing && degraded.peopleShown===2 && degraded.stillRenders);
ok('and it says so rather than showing an empty panel', degraded.says);

// ── the page states what it does not do ─────────────────────────────────
const honest = await p.evaluate(()=>document.getElementById('app').innerText);
ok('the page says removing someone does NOT hide the page',
   /does not hide this page/i.test(honest) && /internal rather than confidential/i.test(honest));
ok('it never claims the page or its figures are protected',
   !/(page|app|data|figures?) (is|are) (protected|secure|encrypted)/i.test(honest));

// ── no auth or people data reaches any persistence path ─────────────────
const iso = await p.evaluate(()=>{
  ST.users.people=[{email:'renzo@unitedceres.edu.sg',note:null,addedAt:null}];
  ADMINV={checked:true,any:true,root:true};
  saveToStorage();
  const local=JSON.parse(localStorage.getItem('ucc_sim_v4')||'{}');
  const snap=buildFullSnapshot();
  /* ST.module is legitimately persisted and may BE "users" right now, so
     look for the state object and the data in it, not the word. */
  return {localHasUsers:'users' in local, snapHasUsers:'users' in snap,
          localHasEmail:/renzo@/.test(JSON.stringify(local)),
          snapHasEmail:/renzo@/.test(JSON.stringify(snap)),
          localHasVerdict:/ADMINV|"any":true/.test(JSON.stringify(local))};});
ok('THE PEOPLE LIST AND ADMIN VERDICT ARE IN NO PERSISTENCE WHITELIST',
   !iso.localHasUsers && !iso.snapHasUsers && !iso.localHasEmail &&
   !iso.snapHasEmail && !iso.localHasVerdict,
   'no users state, no address, no cached admin verdict in either path');

// ── responsive, both languages ──────────────────────────────────────────
for (const lang of ['en','zh']) for (const w of [1440,1280,768,375]){
  await p.setViewportSize({width:w,height:900});
  const of=await p.evaluate(l=>{if((localStorage.getItem('ucc_lang')||'en')!==l)setLang(l);
    ST.module='users';render();
    return document.documentElement.scrollWidth-document.documentElement.clientWidth;},lang);
  if(of>1)errs.push(`users ${lang} ${w}px overflow=${of}`);
}
const zh = await p.evaluate(()=>{setLang('zh');ST.module='users';render();
  const t=document.getElementById('app').innerText;setLang('en');return t;});
ok('CN: the page is translated', /用户与访问权限/.test(zh) && /可登录人员/.test(zh) && /主管理员/.test(zh));
ok('CN: it makes the same honest statement', /内部资料/.test(zh));
ok('the page does not scroll sideways at any width, either language',
   !errs.some(e=>/users .* overflow/.test(e)));

if(errs.length)fails.push(...errs);
console.log(errs.length?'\nerrors: '+errs.join(' | '):'\nno console errors, no overflow');
console.log(fails.length?`\nFAILED (${fails.length})`:'\nALL PASS');
await b.close(); srv.close();
process.exit(fails.length?1:0);
