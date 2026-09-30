/* Google sign-in: fail-closed session handling, token isolation from every
   persistence path, and the honest on-screen wording.
   node auth.check.mjs -> non-zero exit on failure. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
import http from 'node:http';
import fs from 'node:fs';
const { chromium } = pkg;

/* Served over http, because file:// has origin "null" and OAuth cannot
   redirect there — the signed-in states are unreachable from file://. */
const FILE = process.cwd()+'/ucc_budget_simulator.html';
const srv = http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end(fs.readFileSync(FILE));});
await new Promise(r=>srv.listen(8791,'127.0.0.1',r));
const ORIGIN='http://127.0.0.1:8791/';

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const errs=[], fails=[];
const ok=(t,c,x='')=>{console.log(`${c?'PASS':'FAIL'}  ${t}${x?' — '+x:''}`);if(!c)fails.push(t);};
const p=await b.newPage(); await p.setViewportSize({width:1440,height:1000});
p.on('pageerror',e=>errs.push(e.message));
await p.goto(ORIGIN);
await p.evaluate(()=>localStorage.setItem('ucc_unlocked','ucc2026'));
await p.reload(); await p.waitForTimeout(400);

const tok = (email,secsFromNow=3600) => {
  const payload=Buffer.from(JSON.stringify({email})).toString('base64').replace(/=+$/,'');
  return {t:'h.'+payload+'.s', exp:Math.floor(Date.now()/1000)+secsFromNow};
};

// ── fail closed: every degenerate session is "not signed in" ─────────────
const closed = await p.evaluate(()=>{
  const out={};
  const set=v=>{try{localStorage.setItem('ucc_auth',v);}catch(e){}authLoad();return authLive();};
  out.none      = (localStorage.removeItem('ucc_auth'),authLoad(),authLive());
  out.garbage   = set('not json at all');
  out.empty     = set('{}');
  out.noToken   = set(JSON.stringify({expires_at:Math.floor(Date.now()/1000)+3600}));
  out.noExpiry  = set(JSON.stringify({access_token:'x'}));
  out.expired   = set(JSON.stringify({access_token:'x',expires_at:Math.floor(Date.now()/1000)-1}));
  out.expiringNow=set(JSON.stringify({access_token:'x',expires_at:Math.floor(Date.now()/1000)+5}));
  localStorage.removeItem('ucc_auth');authLoad();
  return out;});
ok('no session at all is not signed in', closed.none===null);
ok('UNPARSEABLE stored session is not signed in, it does not throw', closed.garbage===null);
ok('a session with no token is not signed in', closed.empty===null&&closed.noToken===null);
ok('a session with no expiry is not signed in — never assumed valid', closed.noExpiry===null);
ok('an EXPIRED session is not signed in', closed.expired===null);
ok('a session expiring within the 30s margin is already treated as dead',
   closed.expiringNow===null, 'no token expires mid-request');

// ── the token never reaches any persistence path ─────────────────────────
const iso = await p.evaluate(t=>{
  authStore({access_token:t,refresh_token:'SECRET_REFRESH',expires_at:Math.floor(Date.now()/1000)+3600,email:'a@unitedceres.edu.sg'});
  saveToStorage();
  const snap=JSON.stringify(buildFullSnapshot());
  const local=localStorage.getItem('ucc_sim_v4')||'';
  return {inSnapshot:snap.includes(t)||snap.includes('SECRET_REFRESH')||snap.includes('access_token'),
          inLocalState:local.includes(t)||local.includes('SECRET_REFRESH'),
          inOwnKey:(localStorage.getItem('ucc_auth')||'').includes(t),
          stKeys:Object.keys(ST).filter(k=>/auth|token/i.test(k))};}, tok('a@unitedceres.edu.sg').t);
ok('THE TOKEN IS NEVER IN THE CLOUD SNAPSHOT — it would be uploaded to ucc_saves',
   !iso.inSnapshot);
ok('the token is not in the app localStorage payload either', !iso.inLocalState);
ok('the token lives in its own key, and nothing auth-shaped is on ST',
   iso.inOwnKey && iso.stKeys.length===0, iso.stKeys.join(',')||'no auth keys on ST');

// ── request headers carry the user, not the anon key ─────────────────────
const hdr = await p.evaluate(t=>{
  authStore({access_token:t,refresh_token:'r',expires_at:Math.floor(Date.now()/1000)+3600,email:'a@unitedceres.edu.sg'});
  const live=sbHeaders();
  authStore(null);
  const dead=sbHeaders();
  return {live:live.Authorization, dead:dead.Authorization, apikey:live.apikey};}, tok('a@unitedceres.edu.sg').t);
ok('a signed-in request is authorised as the USER, not as the anon key',
   hdr.live==='Bearer '+tok('a@unitedceres.edu.sg').t.replace(/\.s$/,'.s') || hdr.live.startsWith('Bearer h.'),
   hdr.live.slice(0,24)+'…');
ok('the anon key still identifies the project in apikey', !!hdr.apikey);
ok('with no session the request is not smuggled through as the user',
   hdr.dead!==hdr.live);

// ── the authorize URL ────────────────────────────────────────────────────
const url = await p.evaluate(()=>({
  redirect:authRedirectUrl(), possible:authPossible()}));
ok('sign-in is offered over http(s), where the redirect can land', url.possible);
ok('the redirect target is this exact page, with no auth fragment on it',
   url.redirect.startsWith('http://127.0.0.1:8791/') && !url.redirect.includes('#'), url.redirect);

// ── consuming the provider redirect ──────────────────────────────────────
const back = await p.evaluate(t=>{
  localStorage.removeItem('ucc_auth');authLoad();
  history.replaceState(null,'','/#access_token='+t+'&refresh_token=rr&expires_in=3600&token_type=bearer');
  const r=authConsumeRedirect();
  return {r, email:authEmail(), live:!!authLive(),
          hashScrubbed:!location.hash, urlClean:!location.href.includes('access_token')};},
  tok('someone@unitedceres.edu.sg').t);
ok('a successful redirect establishes the session', back.r&&back.r.ok&&back.live);
ok('the email is read from the token for display', back.email==='someone@unitedceres.edu.sg');
ok('THE TOKEN IS SCRUBBED FROM THE ADDRESS BAR AND HISTORY',
   back.hashScrubbed && back.urlClean);

const denied = await p.evaluate(()=>{
  localStorage.removeItem('ucc_auth');authLoad();
  history.replaceState(null,'','/#error=access_denied&error_description=Wrong%20domain');
  const r=authConsumeRedirect();
  return {r, live:!!authLive(), scrubbed:!location.hash};});
ok('a REFUSED sign-in does not create a session and says why',
   !denied.live && denied.r && /Wrong domain/.test(denied.r.error), denied.r&&denied.r.error);
ok('the error is scrubbed from the address bar too', denied.scrubbed);

// ── cloud operations refuse to run without a session ─────────────────────
const gated = await p.evaluate(async()=>{
  localStorage.removeItem('ucc_auth');authLoad();
  let hits=0; const real=window.fetch;
  window.fetch=(...a)=>{if(String(a[0]).includes('/rest/v1/'))hits++;return real(...a);};
  await sbFetchSaves(); await sbSaveScenario('x');
  await sbOverwriteScenario(1); await sbLoadScenario(1); await sbDeleteScenario(1);
  window.fetch=real;
  return {hits, ready:sbReady(), status:ST.sbStatus};});
ok('NO CLOUD REQUEST IS SENT WITHOUT A LIVE SESSION — all five operations refuse',
   gated.hits===0 && !gated.ready, `${gated.hits} requests attempted`);
ok('an expired session says so rather than failing silently',
   /expired|Sign in/i.test(gated.status||''), gated.status||'(blank)');

// ── the wording, in both languages ───────────────────────────────────────
for (const [lang,notProt,approved] of [
     ['en',/does not protect this page/i,/approved list/i],
     ['zh',/并不保护本页面/,/已批准名单/]]){
  const w = await p.evaluate(l=>{
    localStorage.removeItem('ucc_auth');authLoad();
    if((localStorage.getItem('ucc_lang')||'en')!==l)setLang(l);
    ST.cloudOpen=true;render();
    const out=document.body.innerText;
    const t2=(()=>{authStore({access_token:'h.'+btoa(JSON.stringify({email:'x@unitedceres.edu.sg'})).replace(/=+$/,'')+'.s',
      refresh_token:'r',expires_at:Math.floor(Date.now()/1000)+3600,email:'x@unitedceres.edu.sg'});
      render();return document.body.innerText;})();
    authStore(null);render();
    return {out,t2};}, lang);
  ok(`${lang.toUpperCase()}: the panel states plainly that sign-in does NOT protect the page`,
     notProt.test(w.out) && notProt.test(w.t2));
  ok(`${lang.toUpperCase()}: it never claims the app or its contents are protected`,
     !/app is (now )?(secure|protected)|contents are protected|your data is secure/i.test(w.out));
  ok(`${lang.toUpperCase()}: it explains access is by approved list`, approved.test(w.out));
}
await p.evaluate(()=>{setLang('en');ST.cloudOpen=false;render();});

// ── no sideways scroll with the panel open, either language ──────────────
for (const lang of ['en','zh']) for (const w of [1440,1280,768,375]){
  await p.setViewportSize({width:w,height:900});
  const of = await p.evaluate(l=>{
    if((localStorage.getItem('ucc_lang')||'en')!==l)setLang(l);
    ST.cloudOpen=true;render();
    return document.documentElement.scrollWidth-document.documentElement.clientWidth;},lang);
  if(of>1)errs.push(`cloud panel ${lang} ${w}px overflow=${of}`);
}
await p.evaluate(()=>{setLang('en');ST.cloudOpen=false;render();});
ok('the Cloud Save panel does not scroll the page sideways at any width, either language',
   !errs.some(e=>/cloud panel/.test(e)));

if(errs.length)fails.push(...errs);
console.log(errs.length?'\nerrors: '+errs.join(' | '):'\nno console errors, no overflow');
console.log(fails.length?`\nFAILED (${fails.length})`:'\nALL PASS');
await b.close(); srv.close();
process.exit(fails.length?1:0);
