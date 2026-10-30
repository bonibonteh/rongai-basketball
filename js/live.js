// Public live data. Everything shown here is read from Supabase; the browser never writes scores.
// Realtime pushes confirmed changes. After any disconnect the full snapshot is fetched again.
(function () {
  'use strict';
  const RB = window.RBT || {};
  const L = (RB.live = {});
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtClock = (s) => { s = Math.max(0, Math.floor(s || 0)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const period = (p) => (p <= 4 ? 'Q' + p : 'OT' + (p - 4));
  const when = (t) => new Date(t).toLocaleString('en-KE', { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
  const SEL = '*, home:teams!matches_home_team_id_fkey(name), away:teams!matches_away_team_id_fkey(name)';

  const st = { matches: [], standings: [], news: [], filter: 'all', conn: 'SYNCING', lastSync: null, recv: {}, fetchedOnce: false };
  L.state = st;

  // ----- connection indicator -----
  function setConn(c) {
    const was = st.conn; st.conn = c;
    if (c === 'LIVE') st.lastSync = new Date();
    const el = $('sync-indicator'); if (el) {
      const col = { LIVE: 'bg-emerald-500 animate-pulse', SYNCING: 'bg-amber-400', RECONNECTING: 'bg-amber-400', OFFLINE: 'bg-red-500' }[c];
      el.innerHTML = '<span class="w-2 h-2 rounded-full ' + col + '"></span><span>' + c + (st.lastSync ? ' · ' + st.lastSync.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '') + '</span>';
    }
    if (c === 'LIVE' && was !== 'LIVE' && st.fetchedOnce) fetchAll(); // fresh snapshot after any gap
    if (was !== c) renderAll();
  }

  // ----- data -----
  async function fetchAll() {
    if (!RB.sb) return setConn('OFFLINE');
    try {
      const [m, s, n] = await Promise.all([
        RB.sb.from('matches').select(SEL).order('scheduled_at', { ascending: true }),
        RB.sb.rpc('get_standings'),
        RB.sb.from('announcements').select('*').eq('status', 'published').order('published_at', { ascending: false }).limit(10)
      ]);
      if (m.error) throw m.error;
      st.matches = m.data || []; st.matches.forEach((x) => (st.recv[x.id] = Date.now()));
      st.standings = s.error ? [] : (s.data || []); st.news = n.error ? [] : (n.data || []);
      st.fetchedOnce = true; st.lastSync = new Date(); st.loadError = null;
      refreshCulture();
      // REST snapshots are the reliable fallback transport. Keep the public
      // scoreboard usable even if a browser/network blocks the Realtime channel.
      if (st.conn !== 'LIVE') setConn('LIVE');
      const indicator = $('sync-indicator');
      if (indicator) indicator.title = 'Connected to Supabase. Instant updates use Realtime; automatic score refresh runs every 5 seconds as backup.';
      renderAll();
    } catch (e) {
      st.loadError = e && e.message ? e.message : String(e);
      console.error('[RBT] Live score snapshot failed:', e);
      if (st.conn === 'LIVE') setConn('RECONNECTING'); else setConn('OFFLINE');
      renderAll();
    }
  }

  function subscribe() {
    const ch = RB.sb.channel('rbt-public')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, (p) => {
        st.lastSync = new Date();
        if (p.eventType === 'DELETE') { st.matches = st.matches.filter((x) => x.id !== p.old.id); renderAll(); return; }
        const row = p.new, i = st.matches.findIndex((x) => x.id === row.id);
        if (!row.is_published || row.archived_at) { if (i >= 0) st.matches.splice(i, 1); renderAll(); refreshStandings(); return; }
        if (i >= 0) { st.matches[i] = Object.assign({}, st.matches[i], row); st.recv[row.id] = Date.now(); renderAll(); if (row.status !== 'live') refreshStandings(); }
        else fetchAll(); // a game appeared: reload to get team names
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => refreshNews())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => refreshCulture())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'baller_trading_cards' }, () => refreshCulture())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merch_products' }, () => refreshCulture())
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') setConn('LIVE');
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') setConn('RECONNECTING');
        else if (s === 'CLOSED') setConn(navigator.onLine ? 'RECONNECTING' : 'OFFLINE');
      });
    return ch;
  }
  async function refreshStandings() { const r = await RB.sb.rpc('get_standings'); if (!r.error) { st.standings = r.data || []; renderStandings(); } }
  async function refreshNews() {
    const r = await RB.sb.from('announcements').select('*').eq('status', 'published').order('published_at', { ascending: false }).limit(10);
    if (!r.error) { st.news = r.data || []; renderNews(); }
  }

  // ----- rendering -----
  const clockNow = (m) => (m.clock_running ? Math.max(0, m.clock_seconds - Math.floor((Date.now() - (st.recv[m.id] || Date.now())) / 1000)) : m.clock_seconds);
  const shotNow = (m) => (m.clock_running ? Math.max(0, m.shot_clock_seconds - Math.floor((Date.now() - (st.recv[m.id] || Date.now())) / 1000)) : m.shot_clock_seconds);
  const label = { scheduled: 'UPCOMING', ready: 'UPCOMING', live: 'LIVE', final: 'FINAL', postponed: 'POSTPONED', cancelled: 'CANCELLED', under_review: 'UNDER REVIEW' };
  const badge = (m) => {
    const c = { live: 'bg-red-600 text-white', final: 'text-emerald-400 bg-emerald-500/10', postponed: 'text-amber-300 bg-amber-500/10', cancelled: 'text-gray-300 bg-gray-500/20', under_review: 'text-purple-300 bg-purple-500/20' }[m.status] || 'text-rbtGold bg-rbtGold/10';
    return '<span class="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ' + c + '">' + label[m.status] + '</span>';
  };
  const staleNote = () => (st.conn === 'LIVE' ? '' : '<p class="text-[11px] text-amber-300 mt-2">Not confirmed live. Showing the last update' + (st.lastSync ? ' from ' + st.lastSync.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '') + '.</p>');

  function renderTicker() {
    const el = $('ticker-content'); if (!el) return;
    if (!RB.configured) { el.innerHTML = '<span class="text-gray-400">Live scores are unavailable.</span>'; return; }
    const live = st.matches.find((m) => m.status === 'live');
    const next = st.matches.filter((m) => ['scheduled', 'ready'].includes(m.status) && new Date(m.scheduled_at) > Date.now() - 36e5)[0];
    const parts = [];
    if (live) parts.push('<span class="flex items-center gap-2"><span class="bg-red-600 text-white font-bold px-1.5 py-0.5 rounded text-[10px] uppercase">LIVE</span><span class="font-bold text-white">' + esc(live.home.name) + ' <span class="text-rbtOrange" data-tk="h">' + live.home_score + '</span> - <span class="text-gray-300" data-tk="a">' + live.away_score + '</span> ' + esc(live.away.name) + '</span><span class="text-gray-400 text-[11px]">(' + period(live.period) + ' - <span id="ticker-clock">' + fmtClock(clockNow(live)) + '</span>)</span></span>');
    else if (st.fetchedOnce) parts.push('<span class="text-gray-400">No game is live right now.</span>');
    if (next) parts.push('<span class="text-gray-400">Next: ' + esc(next.home.name) + ' vs ' + esc(next.away.name) + ' (' + esc(when(next.scheduled_at)) + ')</span>');
    if (st.conn !== 'LIVE' && st.fetchedOnce) parts.push('<span class="text-amber-300">' + st.conn + ': showing last update</span>');
    el.innerHTML = parts.join('<span class="text-rbtBorder">•</span>') || (st.fetchedOnce ? '<span class="text-gray-400">No published games yet. Live score connection will keep retrying.</span>' : st.conn === 'OFFLINE' ? '<span class="text-red-300">Could not load live scores. Check the database connection and reload.</span>' : '<span class="text-gray-400">Connecting to live scores…</span>');
  }

  function spotlight(m) {
    return '<div class="bg-gradient-to-br from-rbtCard to-[#1a212d] border-2 ' + (m.status === 'live' ? 'border-rbtOrange/60' : 'border-rbtBorder') + ' rounded-2xl p-6 shadow-2xl relative overflow-hidden">'
      + '<div class="flex items-center justify-end gap-2 mb-2">' + (m.status === 'live' ? '<span class="inline-flex items-center gap-1.5 bg-red-600 text-white text-[10px] font-bold px-2.5 py-1 rounded uppercase tracking-wider animate-pulse"><span class="w-2 h-2 rounded-full bg-white"></span> LIVE NOW</span>' : badge(m)) + '<span class="bg-black/60 border border-rbtBorder text-xs text-gray-300 px-2.5 py-1 rounded font-mono">' + esc(m.court) + '</span></div>'
      + '<div class="text-center mb-4"><span class="text-xs uppercase tracking-widest text-rbtOrange font-heading font-bold">' + esc(m.round) + '</span><h4 class="font-heading font-bold text-lg text-white">' + esc(m.home.name) + ' vs ' + esc(m.away.name) + '</h4></div>'
      + '<div class="grid grid-cols-3 items-center text-center my-4 gap-2"><div><span class="text-sm font-heading font-bold text-gray-300 uppercase block">' + esc(m.home.name) + '</span><div class="font-heading font-black text-5xl md:text-7xl text-white">' + m.home_score + '</div><span class="text-xs text-gray-400">Fouls: ' + m.home_fouls + ' | Timeouts: ' + m.home_timeouts + '</span></div>'
      + '<div class="flex flex-col items-center justify-center"><span class="text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">' + period(m.period) + '</span><div class="bg-black/50 border border-rbtBorder px-3 py-1 rounded text-rbtGold font-mono font-bold text-sm mb-2" id="spot-clock">' + fmtClock(clockNow(m)) + '</div><span class="text-[10px] uppercase text-gray-400">Shot Clock</span><div class="text-rbtOrange font-mono font-black text-xl" id="spot-shot">' + shotNow(m) + 's</div></div>'
      + '<div><span class="text-sm font-heading font-bold text-gray-300 uppercase block">' + esc(m.away.name) + '</span><div class="font-heading font-black text-5xl md:text-7xl text-gray-400">' + m.away_score + '</div><span class="text-xs text-gray-400">Fouls: ' + m.away_fouls + ' | Timeouts: ' + m.away_timeouts + '</span></div></div>'
      + (m.status === 'under_review' ? '<p class="text-xs text-purple-300 text-center">This result is being reviewed by the officials.</p>' : '') + staleNote() + '</div>';
  }

  function renderMatches() {
    const sp = $('live-spotlight'), fx = $('fixtures-container'); if (!sp || !fx) return;
    if (!RB.configured) { sp.innerHTML = '<p class="text-sm text-gray-400">Live scores are unavailable right now.</p>'; fx.innerHTML = ''; return; }
    const live = st.matches.filter((m) => m.status === 'live');
    const upcoming = st.matches.filter((m) => ['scheduled', 'ready'].includes(m.status));
    const feature = live[0] || upcoming[0] || st.matches.filter((m) => m.status === 'final').slice(-1)[0];
    sp.innerHTML = feature ? spotlight(feature) : '<div class="bg-rbtCard border border-rbtBorder rounded-2xl p-8 text-center text-sm text-gray-400">' + (st.fetchedOnce ? 'No games have been published yet. Check back soon.' : 'Loading games…') + '</div>';
    const f = st.filter;
    let list = st.matches.filter((m) => (f === 'all' ? true : f === 'live' ? m.status === 'live' : f === 'upcoming' ? ['scheduled', 'ready', 'postponed'].includes(m.status) : m.status === 'final'));
    list = list.filter((m) => !feature || m.id !== feature.id || f !== 'all');
    list.sort((a, b) => (b.status === 'live') - (a.status === 'live') || new Date(a.scheduled_at) - new Date(b.scheduled_at));
    fx.innerHTML = list.length ? list.map((m) => '<div class="bg-rbtCard border border-rbtBorder p-4 rounded-xl flex items-center justify-between gap-3"><div class="min-w-0">' + badge(m)
      + '<h4 class="font-heading font-bold text-white mt-1">' + esc(m.home.name) + (['final', 'live', 'under_review'].includes(m.status) ? ' ' + m.home_score + ' - ' + m.away_score + ' ' : ' vs ') + esc(m.away.name) + '</h4>'
      + '<p class="text-xs text-gray-400 mt-0.5">' + esc(m.court) + ' • ' + esc(when(m.scheduled_at)) + (m.status_reason && ['postponed', 'cancelled'].includes(m.status) ? ' • ' + esc(m.status_reason) : '') + '</p></div></div>').join('')
      : (st.fetchedOnce ? '<p class="text-sm text-gray-400">No games match this filter.</p>' : '');
  }

  function renderStandings() {
    const body = $('standings-body'); if (!body) return;
    body.innerHTML = st.standings.length ? st.standings.map((t) => '<tr class="' + (t.rank === 1 ? 'text-white' : 'text-gray-300') + '"><td class="py-2.5">' + t.rank + '. ' + esc(t.team_name) + '</td><td class="text-center">' + t.played + '</td><td class="text-center">' + t.wins + '</td><td class="text-center">' + t.losses + '</td><td class="text-right font-bold text-rbtOrange">' + t.points + '</td></tr>').join('')
      : '<tr><td colspan="5" class="py-4 text-gray-400">' + (st.fetchedOnce ? 'No teams registered yet.' : 'Loading…') + '</td></tr>';
  }

  function renderBracket() {
    const el = $('bracket-container'); if (!el) return;
    const order = ['Quarterfinal', 'Semifinal', 'Final'];
    const rounds = order.map((r) => ({ r, games: st.matches.filter((m) => m.round.toLowerCase().startsWith(r.toLowerCase()) && m.status !== 'cancelled') })).filter((x) => x.games.length);
    el.innerHTML = rounds.length ? '<div class="flex gap-6 min-w-max">' + rounds.map((x) => '<div class="space-y-3 w-52"><p class="text-[10px] uppercase font-bold text-rbtOrange">' + esc(x.r) + (x.games.length > 1 ? 's' : '') + '</p>' + x.games.map((m) => {
      const fin = m.status === 'final', hw = fin && m.home_score > m.away_score, aw = fin && m.away_score > m.home_score;
      return '<div class="bg-black/40 border border-rbtBorder p-2.5 rounded text-xs"><div class="flex justify-between ' + (hw ? 'font-bold text-white' : 'text-gray-300') + '"><span class="truncate pr-2">' + esc(m.home.name) + '</span><span>' + (['final', 'live'].includes(m.status) ? m.home_score : '--') + '</span></div><div class="flex justify-between ' + (aw ? 'font-bold text-white' : 'text-gray-300') + '"><span class="truncate pr-2">' + esc(m.away.name) + '</span><span>' + (['final', 'live'].includes(m.status) ? m.away_score : '--') + '</span></div></div>';
    }).join('') + '</div>').join('') + '</div>' : '<p class="text-sm text-gray-400">' + (st.fetchedOnce ? 'The bracket appears when playoff fixtures are published.' : 'Loading…') + '</p>';
  }

  function renderStage() {
    const n = $('stage-name'), c = $('stage-court'); if (!n) return;
    const cur = st.matches.find((m) => m.status === 'live') || st.matches.find((m) => ['scheduled', 'ready'].includes(m.status));
    n.textContent = cur ? cur.round : (st.fetchedOnce ? 'Coming soon' : '…'); if (c && cur) c.textContent = cur.court;
  }

  function renderNews() {
    const el = $('news-list'); if (el) el.innerHTML = st.news.filter((a) => !a.is_banner || true).slice(0, 3).map((a) => '<div class="bg-rbtCard border border-rbtBorder rounded-xl p-4"><p class="font-heading font-bold text-white">' + esc(a.title) + '</p><p class="text-sm text-gray-300 mt-1 break-words">' + esc(a.body) + '</p></div>').join('');
    const b = $('hype-banner'); if (b) { const ban = st.news.find((a) => a.is_banner); if (ban) { b.textContent = ban.title + (ban.body ? ' - ' + ban.body : ''); b.classList.remove('hidden'); } else b.classList.add('hidden'); }
  }

  function publicAsset(bucket,path){return path ? RB.sb.storage.from(bucket).getPublicUrl(path).data.publicUrl : '';}
  function renderCulture(roster,cards,products){
    const rosterEl=$('ballers-roster'), cardsEl=$('ballers-cards'), merchEl=$('merch-products');
    if(rosterEl){
      rosterEl.innerHTML=roster.length?roster.map(p=>'<article class="bg-rbtCard border border-rbtBorder rounded-2xl overflow-hidden hover:border-rbtOrange transition">'+
        (p.photo_path?'<img src="'+esc(publicAsset('player-photos',p.photo_path))+'" alt="'+esc(p.full_name)+'" class="w-full h-64 object-cover object-top">':'<div class="h-64 bg-black/40 flex items-center justify-center text-5xl font-heading font-bold text-rbtOrange">'+esc(String(p.full_name||'?').split(/\\s+/).map(x=>x[0]).slice(0,2).join(''))+'</div>')+
        '<div class="p-5"><div class="flex items-center justify-between gap-2"><span class="text-rbtGold text-xs font-bold uppercase">'+esc(p.position||'Player')+'</span><span class="text-xs text-gray-400">#'+esc(p.jersey_no??'—')+'</span></div><h4 class="font-heading font-bold text-xl text-white mt-2">'+esc(p.full_name)+'</h4><p class="text-xs text-gray-400">'+esc(p.team?.name||'Rongai Ballers')+'</p>'+(p.bio?'<p class="text-sm text-gray-300 mt-3">'+esc(p.bio)+'</p>':'')+'</div></article>').join(''):'<p class="text-sm text-gray-400">Player profiles will appear here when the roster is published.</p>';
      const search=$('ballers-search'); if(search&&!search.dataset.bound){search.dataset.bound='1';search.addEventListener('input',()=>{const term=search.value.toLowerCase();rosterEl.querySelectorAll('article').forEach((el)=>el.classList.toggle('hidden',!el.textContent.toLowerCase().includes(term)));});}
    }
    if(cardsEl){
      cardsEl.innerHTML=cards.length?cards.map(c=>{const p=c.player||{},stats=c.stats||{},photo=p.photo_path?publicAsset('player-photos',p.photo_path):'';return '<article class="relative overflow-hidden rounded-2xl border border-rbtGold/50 bg-gradient-to-br from-rbtCard via-black to-rbtCard p-4 min-h-64 shadow-xl"><div class="absolute inset-0 opacity-10 pointer-events-none" style="background:linear-gradient(135deg,#ff6a00,transparent 50%,#f7bd43)"></div><div class="relative flex justify-between text-[10px] uppercase tracking-widest font-bold text-rbtGold"><span>'+esc(c.collection_name)+'</span><span>'+esc(c.edition)+'</span></div>'+(photo?'<img src="'+esc(photo)+'" alt="" class="relative w-full h-36 object-cover object-top rounded-xl mt-3">':'<div class="relative h-36 flex items-center justify-center text-4xl font-heading font-black text-rbtOrange">'+esc(String(p.full_name||'RB').split(/\\s+/).map(x=>x[0]).slice(0,2).join(''))+'</div>')+'<div class="relative mt-3"><h4 class="font-heading font-black text-lg text-white">'+esc(p.full_name||'Rongai Baller')+'</h4><p class="text-[10px] text-gray-400 uppercase">#'+esc(p.jersey_no??'—')+' · '+esc(p.position||'Player')+' · '+esc(c.season)+'</p><div class="flex flex-wrap gap-2 mt-2">'+Object.entries(stats).slice(0,3).map(([k,v])=>'<span class="text-[10px] bg-white/10 rounded px-2 py-1 text-gray-200">'+esc(k)+': '+esc(v)+'</span>').join('')+'</div><p class="text-[10px] text-rbtGold uppercase font-bold mt-3">'+esc(c.rarity)+' edition</p></div></article>'}).join(''):'<p class="text-sm text-gray-400">New trading cards will be revealed here as they are published.</p>';
    }
    if(merchEl){
      merchEl.innerHTML=products.length?products.map(p=>{const path=(p.image_paths||[])[0],src=path&&/^https:\\/\\//.test(path)?path:publicAsset('merch-images',path);return '<article class="bg-rbtCard border border-rbtBorder rounded-2xl overflow-hidden hover:border-rbtOrange transition">'+(src?'<img src="'+esc(src)+'" alt="'+esc(p.name)+'" class="w-full h-64 object-cover">':'<div class="h-64 bg-black/40 flex items-center justify-center font-heading font-black text-2xl text-rbtOrange">STREET CULTURE</div>')+'<div class="p-5 space-y-2"><div class="flex items-center justify-between gap-2"><span class="text-[10px] text-rbtGold uppercase font-bold">'+esc(p.category)+'</span>'+(p.is_featured?'<span class="text-[10px] text-rbtOrange uppercase font-bold">Featured</span>':'')+'</div><h4 class="font-heading font-bold text-lg text-white">'+esc(p.name)+'</h4><p class="text-sm text-gray-400">'+esc(p.description||'')+'</p><div class="flex items-center justify-between pt-2"><b class="text-rbtGold text-lg">'+(Number(p.price_kes)>0?'KES '+Number(p.price_kes).toLocaleString('en-KE'):'Price on request')+'</b><span class="text-xs '+(p.availability==='available'?'text-emerald-400':'text-gray-400')+'">'+esc(String(p.availability||'available').replace('_',' '))+'</span></div>'+(p.sizes?.length?'<p class="text-[10px] text-gray-500">Sizes: '+esc(p.sizes.join(', '))+'</p>':'')+'</div></article>'}).join(''):'<p class="text-sm text-gray-400">Official merchandise will appear here when products are published.</p>';
    }
  }
  async function refreshCulture(){
    if(!RB.sb)return;
    const [pr,cr,mr]=await Promise.all([
      RB.sb.from('players').select('id,team_id,full_name,jersey_no,position,photo_path,bio,status,team:teams(name)').eq('is_published',true).is('archived_at',null).neq('status','archived').order('full_name'),
      RB.sb.from('baller_trading_cards').select('*,player:players(id,full_name,jersey_no,position,photo_path)').eq('status','published').order('season',{ascending:false}),
      RB.sb.from('merch_products').select('*').eq('status','published').order('display_order').order('created_at',{ascending:false})
    ]);
    renderCulture(pr.error?[]:(pr.data||[]),cr.error?[]:(cr.data||[]),mr.error?[]:(mr.data||[]));
  }
  function renderAll() { renderTicker(); renderMatches(); renderStandings(); renderBracket(); renderStage(); renderNews(); }
  L.setFilter = (f) => { st.filter = f; renderMatches(); };

  // Clocks tick locally between confirmed updates.
  setInterval(() => {
    const live = st.matches.find((m) => m.status === 'live'); if (!live) return;
    const a = $('spot-clock'), s = $('spot-shot'), t = $('ticker-clock');
    if (a) a.textContent = fmtClock(clockNow(live)); if (s) s.textContent = shotNow(live) + 's'; if (t) t.textContent = fmtClock(clockNow(live));
  }, 1000);

  // ----- start -----
  if (!RB.configured) { setConn('OFFLINE'); renderAll(); return; }
  renderAll();
  refreshCulture();

  // Start the WebSocket immediately. Do not make live-score subscriptions wait
  // for the initial REST snapshot: a slow/hung database read must not leave the
  // entire public site stuck forever on "SYNCING".
  try {
    subscribe();
  } catch (e) {
    console.error('[RBT] Could not start realtime subscription:', e);
    setConn('RECONNECTING');
  }
  // Bound the first snapshot so the UI can report a failure instead of waiting forever.
  const firstSnapshot = fetchAll();
  Promise.race([
    firstSnapshot,
    new Promise((_, reject) => window.setTimeout(() => reject(new Error('Live score request timed out after 12 seconds.')), 12000))
  ]).catch((e) => {
    st.loadError = e && e.message ? e.message : String(e);
    console.error('[RBT] Initial live score load timed out or failed:', e);
    if (st.conn !== 'LIVE') setConn('OFFLINE');
    renderAll();
  });
  window.addEventListener('online', () => { setConn('SYNCING'); fetchAll(); });
  window.addEventListener('offline', () => setConn('OFFLINE'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchAll(); });
  // Always poll as a backup. This guarantees score/standings updates even
  // when a proxy, browser extension or network blocks the Realtime channel.
  // Realtime remains the instant path; polling is the resilient fallback.
  let pollBusy = false;
  setInterval(async () => {
    if (document.hidden || pollBusy || !navigator.onLine) return;
    pollBusy = true;
    try { await fetchAll(); }
    finally { pollBusy = false; }
  }, 5000);
})();
