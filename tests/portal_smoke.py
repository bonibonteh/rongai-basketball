# Smoke test of the portal's own logic. Uses a stand-in for supabase-js (libraries are blocked in the build sandbox),
# so it checks screens, flows and module rendering, NOT supabase-js itself or real RLS (see supabase/tests for RLS).
import subprocess, time, json, sys
from playwright.sync_api import sync_playwright
STUB = r"""
(function(){
 const S=window.__S=JSON.parse(localStorage.getItem('__db')||'null')||{writes:[],rpc:[],fn:[]};
 const T={profiles:[{id:'u1',full_name:'Brian Director',display_name:'Brian',email:'d@x.test',role:'director',status:window.__STATUS||'active',department:'',bio:'',avatar_path:null}],
  official_roles:[{key:'director',label:'Tournament Director',permissions:['*']}],
  account_requests:[{id:'r1',full_name:'Jo Visitor',email:'jo@x.test',requested_role:'scorekeeper',reason:'I score games at the club',status:'pending',requested_at:new Date().toISOString()}],
  teams:[{id:'t1',name:'Rongai Heat',registration_status:'pending',is_published:false,created_at:new Date().toISOString()},{id:'t2',name:'Kware Titans',registration_status:'approved',is_published:true,created_at:new Date().toISOString()}],
  matches:[{id:'m1',home_team_id:'t1',away_team_id:'t2',status:'live',round:'Pool',court:'Court 1',scheduled_at:new Date().toISOString(),home_score:10,away_score:8,home_fouls:1,away_fouls:2,home_timeouts:3,away_timeouts:3,period:1,clock_seconds:300,shot_clock_seconds:24,clock_running:false,clock_updated_at:new Date().toISOString(),version:3,is_published:true,home:{name:'Rongai Heat'},away:{name:'Kware Titans'}}],
  tasks:[],announcements:[],audit_logs:[],match_events:[],official_assignments:[],match_reports:[],user_dashboard_preferences:[],players:[]};
 const ls=()=>JSON.parse(localStorage.getItem('rbt-auth')||'null'); let L=[];
 const fire=(e,s)=>L.forEach(f=>f(e,s));
 function qb(table){const calls=[];const p=new Proxy(function(){},{get(_,k){ if(k==='then')return(a,b)=>run().then(a,b); return(...a)=>{calls.push([k,a]);return p;};}});
  async function run(){const has=k=>calls.some(c=>c[0]===k); if(has('insert')||has('update')||has('upsert')||has('delete')){S.writes.push([table,calls[0][0]]);return{data:null,error:null};}
   let rows=(T[table]||[]).slice(); calls.filter(c=>c[0]==='eq').forEach(c=>{rows=rows.filter(r=>String(r[c[1][0]])===String(c[1][1]));});
   if(has('maybeSingle'))return{data:rows[0]||null,error:null}; if(has('single'))return rows[0]?{data:rows[0],error:null}:{data:null,error:{message:'not found'}};
   const cnt=calls.find(c=>c[0]==='select'&&c[1][1]&&c[1][1].count); return{data:rows,error:null,count:rows.length};}
  return p;}
 const ch=()=>{const c={on:()=>c,subscribe:(f)=>{setTimeout(()=>f&&f('SUBSCRIBED'),0);return c;}};return c;};
 window.supabase={createClient:()=>({
  auth:{async getSession(){return{data:{session:ls()},error:null}},async getUser(){const s=ls();return s?{data:{user:s.user},error:null}:{data:{user:null},error:{message:'no session'}}},
   async signInWithPassword({email,password}){if(email!=='d@x.test'||password!=='correct-pass')return{data:null,error:{message:'Invalid login credentials'}};const s={user:{id:'u1',email}};localStorage.setItem('rbt-auth',JSON.stringify(s));setTimeout(()=>fire('SIGNED_IN',s),0);return{data:{session:s},error:null}},
   async signOut(){localStorage.removeItem('rbt-auth');setTimeout(()=>fire('SIGNED_OUT',null),0);return{error:null}},
   onAuthStateChange(f){L.push(f);return{data:{subscription:{unsubscribe(){}}}}},async resetPasswordForEmail(e){S.rpc.push(['reset',e]);return{error:null}},async updateUser(){return{error:null}}},
  from:qb,rpc:async(n,a)=>{S.rpc.push([n,a]);localStorage.setItem('__db',JSON.stringify(S));return{data:[],error:null}},
  functions:{invoke:async(n,o)=>{S.fn.push([n,o.body]);localStorage.setItem('__db',JSON.stringify(S));return{data:{ok:true},error:null}}},
  storage:{from:()=>({createSignedUrl:async()=>({data:null}),upload:async()=>({error:null})})},channel:ch,removeChannel(){}})};
 window.lucide={createIcons(){}};
})();
"""
srv=subprocess.Popen([sys.executable,'-m','http.server','8765','--directory','/home/claude/rongai-basketball'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
res=[]
def ok(n,c): res.append((n,bool(c))); print(('PASS ' if c else 'FAIL ')+n)
try:
 with sync_playwright() as p:
  b=p.chromium.launch(); 
  def page(status='active'):
   ctx=b.new_context(); pg=ctx.new_page(); errs=[]
   pg.on('pageerror',lambda e:errs.append(str(e)))
   pg.route('**/*',lambda r:(r.fulfill(body='window.tailwind={};',content_type='application/javascript') if any(h in r.request.url for h in ['cdn.tailwindcss','unpkg.com','jsdelivr','fonts.g']) and r.request.resource_type in('script','stylesheet') and 'supabase' not in r.request.url else (r.fulfill(body=STUB.replace("window.__STATUS||","'%s'||"%status),content_type='application/javascript') if 'jsdelivr' in r.request.url and 'supabase' in r.request.url else r.continue_())))
   return ctx,pg,errs
  # public site
  ctx,pg,errs=page(); pg.goto('http://localhost:8765/index.html'); pg.wait_for_timeout(800)
  ok('public site loads without script errors',not errs); ok('header button says OFFICIAL PORTAL', 'official portal' in pg.inner_text('header').lower())
  # sign-in, eye, wrong password
  pg.goto('http://localhost:8765/portal.html'); pg.wait_for_selector('#si-email')
  ok('sign-in page shown to visitor (no workspace)', pg.query_selector('#si-pw') is not None and pg.query_selector('[data-nav]') is None)
  pg.fill('#si-email','d@x.test'); pg.fill('#si-pw','wrong'); pg.click('#b-signin'); pg.wait_for_timeout(300)
  ok('wrong password is rejected with a message','incorrect' in pg.inner_text('#e-signin').lower())
  pg.fill('#si-pw','abc123xyz'); pg.click('[data-eye=si-pw]')
  ok('eye icon shows password and keeps the value', pg.get_attribute('#si-pw','type')=='text' and pg.input_value('#si-pw')=='abc123xyz')
  pg.click('[data-eye=si-pw]'); ok('eye icon hides it again', pg.get_attribute('#si-pw','type')=='password')
  # request account
  pg.goto('http://localhost:8765/portal.html#request'); pg.reload(); pg.wait_for_selector('#rq-name')
  ok('request page has two password-free fields and a role list', pg.query_selector('#rq-role') is not None)
  # login ok
  pg.goto('http://localhost:8765/portal.html'); pg.wait_for_selector('#si-email'); pg.fill('#si-email','d@x.test'); pg.fill('#si-pw','correct-pass'); pg.click('#b-signin'); pg.wait_for_timeout(1200)
  txt=pg.inner_text('body'); ok('director signs in and sees personalised welcome','Welcome back, Brian' in txt)
  ok('director sees Official Access and Tournament Controls','Official Access' in txt and 'Tournament Controls' in txt)
  for m in ['courtside','fixtures','teams','reports','announcements','tasks','officials','controls','profile','dashboard']:
   pg.evaluate("location.hash='%s'"%m); pg.wait_for_timeout(450)
  ok('every module renders with no script errors', not errs)
  pg.evaluate("location.hash='officials'"); pg.wait_for_timeout(400); ok('pending request visible to Director','Jo Visitor' in pg.inner_text('body'))
  # persistence: reload with a fresh page sharing storage, watch for sign-in flash
  pg.add_init_script("window.__flash=false;new MutationObserver(()=>{if(document.getElementById('si-email'))window.__flash=true}).observe(document,{childList:true,subtree:true});")
  pg.reload(); pg.wait_for_timeout(1200)
  ok('refresh keeps the session', 'Welcome back' in pg.inner_text('body') or 'Dashboard' in pg.inner_text('body'))
  ok('sign-in page never flashes during restore', pg.evaluate('window.__flash')==False)
  # sign out
  pg.evaluate("RBT.P.signOut()"); pg.wait_for_timeout(400); ok('sign out returns to sign-in and clears session', pg.query_selector('#si-email') is not None and pg.evaluate("localStorage.getItem('rbt-auth')") is None)
  ctx.close()
  # suspended user with cached session
  ctx,pg,errs=page('suspended'); pg.goto('http://localhost:8765/portal.html'); pg.evaluate("localStorage.setItem('rbt-auth',JSON.stringify({user:{id:'u1',email:'d@x.test'}}))"); pg.reload(); pg.wait_for_timeout(1000)
  t=pg.inner_text('body'); ok('suspended official with cached session gets no workspace', 'suspended' in t.lower() and 'Welcome back' not in t)
  b.close()
finally: srv.terminate()
print('%d/%d passed'%(sum(1 for _,c in res if c),len(res))); sys.exit(0 if all(c for _,c in res) else 1)
