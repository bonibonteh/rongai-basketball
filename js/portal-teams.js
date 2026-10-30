// Team management: add/edit teams, logo upload, activate/deactivate, registrations, and a profile page per team.
(function () {
  'use strict';
  const RB = window.RBT, sb = RB.sb, P = RB.P;
  const { $, $$, esc, icons, fmtTime, can, q, toast, chip, card, empty, btn } = P;
  const rpc = async (n, a) => { const r = await sb.rpc(n, a); if (r.error) throw r.error; return r.data; };
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { P.fail(e); } };
  const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const url = (p) => (p ? sb.storage.from('team-logos').getPublicUrl(p).data.publicUrl : '');
  const logoImg = (t, c) => t.logo_path ? `<img src="${esc(url(t.logo_path))}" alt="${esc(t.name)} logo" class="${c || 'w-10 h-10'} rounded-full object-cover border border-rbtBorder bg-black/40">`
    : `<span class="${c || 'w-10 h-10'} rounded-full bg-rbtBorder flex items-center justify-center text-xs font-heading font-bold text-rbtOrange">${esc(P.initials(t.name))}</span>`;
  const T = { open: null }; // team id whose profile is open

  function form(t) {
    t = t || {};
    return new Promise((resolve) => {
      const w = document.createElement('div');
      w.className = 'fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/70 p-4';
      const L = P.label, I = P.input;
      w.innerHTML = `<form class="bg-rbtCard border border-rbtBorder rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-3" role="dialog" aria-modal="true" aria-label="${t.id ? 'Edit team' : 'Add team'}">
        <h3 class="font-heading font-bold text-lg text-white">${t.id ? 'Edit ' + esc(t.name) : 'Add a team'}</h3>
        <div><label class="${L}" for="tf-n">Team name</label><input id="tf-n" required minlength="2" maxlength="80" value="${esc(t.name || '')}" class="${I}"></div>
        <div><label class="${L}" for="tf-p">Pool</label><input id="tf-p" maxlength="20" value="${esc(t.pool || '')}" class="${I}"></div>
        <div><label class="${L}" for="tf-d">Description</label><textarea id="tf-d" rows="3" maxlength="1000" class="${I}">${esc(t.description || '')}</textarea></div>
        <div class="grid grid-cols-2 gap-3"><div><label class="${L}" for="tf-c">Coach</label><input id="tf-c" maxlength="120" value="${esc(t.coach_name || '')}" class="${I}"></div><div><label class="${L}" for="tf-m">Manager</label><input id="tf-m" maxlength="120" value="${esc(t.manager_name || '')}" class="${I}"></div></div>
        <div><label class="${L}" for="tf-l">Team logo (JPG, PNG or WebP, up to 2 MB)</label><input id="tf-l" type="file" accept="image/jpeg,image/png,image/webp" class="${I}"><img id="tf-pv" alt="Logo preview" class="hidden mt-2 w-16 h-16 rounded-full object-cover border border-rbtBorder"></div>
        <p id="tf-e" class="hidden text-xs text-red-300" role="alert"></p>
        <div class="flex gap-2 justify-end"><button type="button" id="tf-x" class="px-4 py-2 rounded-lg border border-rbtBorder text-gray-300 text-xs font-heading font-bold uppercase">Cancel</button><button class="px-4 py-2 rounded-lg bg-rbtOrange text-black text-xs font-heading font-bold uppercase">${t.id ? 'Save team' : 'Add team'}</button></div></form>`;
      document.body.appendChild(w);
      const err = (m) => { const e = $('#tf-e', w); e.textContent = m; e.classList.remove('hidden'); };
      $('#tf-l', w).onchange = (e) => { const f = e.target.files[0], pv = $('#tf-pv', w); if (f && TYPES[f.type]) { pv.src = URL.createObjectURL(f); pv.classList.remove('hidden'); } };
      $('#tf-x', w).onclick = () => { w.remove(); resolve(null); };
      $('form', w).onsubmit = (e) => {
        e.preventDefault();
        const f = $('#tf-l', w).files[0];
        if (f && !TYPES[f.type]) return err('The logo must be a JPG, PNG or WebP image.');
        if (f && f.size > 2097152) return err('The logo is larger than 2 MB. Choose a smaller image.');
        w.remove();
        resolve({ file: f || null, v: { name: $('#tf-n', w).value.trim(), pool: $('#tf-p', w).value.trim() || null, description: $('#tf-d', w).value.trim() || null, coach_name: $('#tf-c', w).value.trim() || null, manager_name: $('#tf-m', w).value.trim() || null } });
      };
      $('#tf-n', w).focus();
    });
  }
  async function upload(teamId, file) {
    const path = teamId + '/' + Date.now() + '.' + TYPES[file.type];
    const { error } = await sb.storage.from('team-logos').upload(path, file, { contentType: file.type, upsert: true });
    if (error) throw error;
    return path;
  }

  async function profile(main, id) {
    const [teams, st, matches] = await Promise.all([q(sb.from('teams').select('*')), rpc('get_standings_admin').catch(() => []),
      q(sb.from('matches').select('*').or(`home_team_id.eq.${id},away_team_id.eq.${id}`).order('scheduled_at', { ascending: false }).limit(100))]);
    const t = teams.find((x) => x.id === id); if (!t) { T.open = null; return list(main); }
    const names = new Map(teams.map((x) => [x.id, x.name])), s = st.find((x) => x.team_id === id);
    const row = (m) => { const home = m.home_team_id === id, opp = names.get(home ? m.away_team_id : m.home_team_id) || 'Opponent', done = ['final', 'under_review'].includes(m.status);
      return `<li class="py-2 flex flex-wrap items-center justify-between gap-2 text-sm"><span class="text-white">${home ? 'vs' : '@'} ${esc(opp)}</span><span class="font-mono text-rbtGold">${done ? (home ? m.home_score + ' - ' + m.away_score : m.away_score + ' - ' + m.home_score) : '-'}</span><span class="text-xs text-gray-400">${esc(fmtTime(m.scheduled_at))} ${chip(m.status)}</span></li>`; };
    const played = matches.filter((m) => m.status === 'final'), upcoming = matches.filter((m) => !['final', 'under_review', 'cancelled'].includes(m.status));
    main.innerHTML = `<div class="max-w-4xl mx-auto space-y-4">
      <button id="tp-back" class="text-xs text-gray-300 hover:text-rbtOrange">&larr; All teams</button>
      ${card('', `<div class="flex flex-wrap items-center gap-4">${logoImg(t, 'w-20 h-20')}<div class="min-w-0 flex-1"><h2 class="font-heading font-extrabold text-2xl text-white">${esc(t.name)}</h2><p class="text-xs text-gray-400">${t.pool ? 'Pool ' + esc(t.pool) + ' · ' : ''}${chip(t.registration_status)} ${t.is_active ? '' : chip('inactive')}</p><p class="text-sm text-gray-300 mt-2 break-words">${esc(t.description || 'No description yet.')}</p><p class="text-xs text-gray-400 mt-2">Coach: ${esc(t.coach_name || '-')} · Manager: ${esc(t.manager_name || '-')} · Captain: ${esc(t.captain_name || '-')}</p></div>${btn('Edit team', 'id="tp-edit"', 'primary')}</div>`)}
      ${card('Standing', s ? `<p class="text-sm text-gray-200">Position <b class="text-white">${s.rank}</b> · played ${s.played} · won ${s.wins} · lost ${s.losses} · drawn ${s.draws} · for ${s.points_for} · against ${s.points_against} · difference ${s.diff} · table points <b class="text-rbtOrange">${s.points}</b>${s.is_override ? ' <span class="text-[10px] text-amber-300 uppercase">manual override</span>' : ''}</p>` : empty('This team is not on the standings table yet. It must be approved.'))}
      ${card('Previous results', played.length ? `<ul class="divide-y divide-rbtBorder/50">${played.map(row).join('')}</ul>` : empty('No final results for this team yet.'))}
      ${card('Upcoming and other games', upcoming.length ? `<ul class="divide-y divide-rbtBorder/50">${upcoming.map(row).join('')}</ul>` : empty('No upcoming games.'))}</div>`;
    $('#tp-back', main).onclick = () => { T.open = null; list(main).then(icons); };
    $('#tp-edit', main).onclick = guard(async () => { if (await edit(t)) profile(main, id).then(icons); });
  }
  async function edit(t) {
    const r = await form(t); if (!r) return false;
    const patch = { ...r.v };
    if (r.file) patch.logo_path = await upload(t.id, r.file);
    const { error } = await sb.from('teams').update(patch).eq('id', t.id); if (error) throw error;
    toast('Team saved. The public site updates automatically.'); return true;
  }

  async function list(main) {
    if (T.open) return profile(main, T.open);
    const teams = await q(sb.from('teams').select('*').order('created_at', { ascending: false }));
    const pending = teams.filter((t) => t.registration_status === 'pending'), rest = teams.filter((t) => t.registration_status !== 'pending');
    main.innerHTML = `<div class="max-w-5xl mx-auto space-y-4">
      ${card('Pending registrations', pending.length ? pending.map((t) => `<div class="py-3 border-b border-rbtBorder/50 last:border-0 flex flex-col md:flex-row md:items-start justify-between gap-3"><div class="min-w-0 text-sm"><p class="text-white font-semibold">${esc(t.name)}</p><p class="text-xs text-gray-400">Captain ${esc(t.captain_name || '-')} · ${esc(t.contact_phone || '-')} · ${esc(t.contact_email || '-')}</p><p class="text-xs text-gray-300 mt-1 break-words">${esc(t.roster_notes || '')}</p></div><div class="flex gap-2 shrink-0">${btn('Approve', `data-rv="${t.id}" data-d="approved"`, 'good')}${btn('Reject', `data-rv="${t.id}" data-d="rejected"`, 'danger')}</div></div>`).join('') : empty('No registrations are waiting.'))}
      ${card(`Teams <span class="ml-2">${btn('Add team', 'id="tm-add"', 'primary')}</span>`, rest.length ? `<ul class="divide-y divide-rbtBorder/50">${rest.map((t) => `<li class="py-3 flex flex-wrap items-center justify-between gap-3">${logoImg(t)}<div class="min-w-0 flex-1"><p class="text-white font-semibold text-sm">${esc(t.name)}${t.pool ? ' · Pool ' + esc(t.pool) : ''}</p><p class="text-[11px] text-gray-400">${esc(t.coach_name ? 'Coach ' + t.coach_name : 'No coach set')}</p></div>${chip(t.registration_status)}${t.is_active ? '' : chip('inactive')}<span class="flex gap-2">${btn('Profile', `data-pf="${t.id}"`)}${btn('Edit', `data-ed="${t.id}"`, 'primary')}${t.registration_status === 'approved' ? btn(t.is_active ? 'Deactivate' : 'Activate', `data-ac="${t.id}"`, t.is_active ? 'danger' : 'good') : ''}</span></li>`).join('')}</ul>` : empty('No teams yet.'))}</div>`;
    const again = () => list(main).then(icons);
    $$('[data-rv]', main).forEach((b) => b.onclick = guard(async () => { const r = await P.dialog({ title: b.dataset.d === 'approved' ? 'Approve team' : 'Reject team', submit: b.dataset.d === 'approved' ? 'Approve' : 'Reject', danger: b.dataset.d === 'rejected', fields: [{ name: 'n', label: 'Notes (optional)', type: 'textarea' }] }); if (!r) return; await rpc('review_team', { p_team: b.dataset.rv, p_decision: b.dataset.d, p_notes: r.n || null }); toast('Team ' + b.dataset.d + '.'); again(); P.refreshBadges(); }));
    $('#tm-add', main).onclick = guard(async () => {
      const r = await form(); if (!r) return;
      const { data, error } = await sb.from('teams').insert({ ...r.v, registration_status: 'approved', is_published: true, is_active: true }).select('id').single(); if (error) throw error;
      if (r.file) { const { error: e2 } = await sb.from('teams').update({ logo_path: await upload(data.id, r.file) }).eq('id', data.id); if (e2) throw e2; }
      toast('Team added.'); again();
    });
    $$('[data-pf]', main).forEach((b) => b.onclick = () => { T.open = b.dataset.pf; list(main).then(icons); });
    $$('[data-ed]', main).forEach((b) => b.onclick = guard(async () => { if (await edit(teams.find((x) => x.id === b.dataset.ed))) again(); }));
    $$('[data-ac]', main).forEach((b) => b.onclick = guard(async () => { const t = teams.find((x) => x.id === b.dataset.ac); const { error } = await sb.from('teams').update({ is_active: !t.is_active }).eq('id', t.id); if (error) throw error; toast(t.is_active ? 'Team deactivated and hidden from the public site.' : 'Team activated.'); again(); }));
  }
  P.modules.teams = { render: (main) => { T.open = null; return list(main); }, watch: [] };
})();
