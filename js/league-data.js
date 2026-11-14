// Shared public data layer for the match page, team page and Match Centre.
// Reads published data only, with the public (anon) key and plain REST calls that time out instead of hanging.
(function () {
  'use strict';
  const CFG = window.RBT_CONFIG || {};
  const L = (window.RBL = {});
  L.ok = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  L.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const esc = L.esc;
  L.rest = async function (path, body) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(CFG.SUPABASE_URL + '/rest/v1/' + path, {
        method: body ? 'POST' : 'GET', signal: ctl.signal,
        headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return await r.json();
    } finally { clearTimeout(t); }
  };
  const pub = (bucket, p) => (p ? CFG.SUPABASE_URL + '/storage/v1/object/public/' + bucket + '/' + String(p).split('/').map(encodeURIComponent).join('/') : '');
  L.logoUrl = (t) => pub('team-logos', t && t.logo_path);
  L.teamPhotoUrl = (t) => pub('team-logos', t && t.photo_path);
  L.playerPhotoUrl = (p) => pub('player-photos', p && p.photo_path);
  L.initials = (n) => String(n || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  L.hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  // team badge: logo if there is one, otherwise coloured initials
  L.badge = (t, size, cls) => {
    t = t || { name: 'TBC' }; size = size || 56;
    const st = 'width:' + size + 'px;height:' + size + 'px';
    return t.logo_path
      ? '<img src="' + esc(L.logoUrl(t)) + '" alt="' + esc(t.name) + ' logo" loading="lazy" style="' + st + '" class="rbl-logo ' + (cls || '') + '">'
      : '<span style="' + st + ';background:hsl(' + L.hue(t.name) + ' 55% 30%);font-size:' + Math.round(size / 3) + 'px" class="rbl-logo rbl-initials ' + (cls || '') + '">' + esc(L.initials(t.short_name || t.name)) + '</span>';
  };
  L.avatar = (p, size) => {
    size = size || 96; const st = 'width:' + size + 'px;height:' + size + 'px';
    const url = L.playerPhotoUrl(p);
    return url ? '<img src="' + esc(url) + '" alt="' + esc(p.player_name || p.full_name) + '" loading="lazy" style="' + st + '" class="rbl-avatar">'
      : '<span style="' + st + ';font-size:' + Math.round(size / 3) + 'px" class="rbl-avatar rbl-avatar-empty">' + esc(L.initials(p.player_name || p.full_name)) + '</span>';
  };
  L.TEAM_SEL = 'id,name,short_name,pool,logo_path,photo_path,description,coach_name,manager_name';
  L.MATCH_SEL = '*,home:teams!matches_home_team_id_fkey(' + L.TEAM_SEL + '),away:teams!matches_away_team_id_fkey(' + L.TEAM_SEL + ')';
  L.fixTeams = (m) => { m.home = m.home || { name: 'To be confirmed' }; m.away = m.away || { name: 'To be confirmed' }; return m; };
  L.STATUS = { scheduled: 'Upcoming', ready: 'Upcoming', live: 'Live', final: 'Final', postponed: 'Postponed', cancelled: 'Cancelled', under_review: 'Under review' };
  L.when = (t, opts) => new Date(t).toLocaleString('en-KE', Object.assign({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }, opts || {}));
  L.period = (p) => (p <= 4 ? 'Q' + p : 'OT' + (p - 4));
  L.clock = (s) => { s = Math.max(0, Math.floor(s || 0)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  L.countdown = (t) => {
    let d = Math.floor((new Date(t) - Date.now()) / 1000); if (d <= 0) return 'Starting soon';
    const days = Math.floor(d / 86400), h = Math.floor(d % 86400 / 3600), m = Math.floor(d % 3600 / 60);
    return days ? days + 'd ' + h + 'h ' + m + 'm' : h ? h + 'h ' + m + 'm' : m + ' min ' + (d % 60) + 's';
  };
  // the lineup that applies: a published match-specific one, otherwise the team default
  L.lineupFor = (lineups, teamId, matchId) => {
    const own = lineups.find((x) => x.team_id === teamId && x.match_id === matchId);
    if (own) return own;
    return lineups.find((x) => x.team_id === teamId && !x.match_id) || null;
  };
  L.loadLineups = async (filter) => {
    try { return await L.rest('lineups?select=*,players:lineup_players(*)&status=eq.published&' + filter); } catch (e) { return []; }
  };
  // quarter-by-quarter scores from the scoring log
  L.quarters = (events, m) => {
    const last = {}; (events || []).forEach((e) => { if (e.home_score_after != null) last[e.period] = e; });
    const per = Object.keys(last).map(Number).sort((a, b) => a - b); const out = []; let ph = 0, pa = 0;
    per.forEach((p) => { out.push({ p, h: last[p].home_score_after - ph, a: last[p].away_score_after - pa }); ph = last[p].home_score_after; pa = last[p].away_score_after; });
    return out;
  };
})();
