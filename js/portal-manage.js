// Standings & Results: every approved team, editable standings (labelled overrides) and previous games.
(function () {
  'use strict';
  const RB = window.RBT, sb = RB.sb, P = RB.P;
  const { $, $$, esc, icons, fmtTime, can, q, toast, chip, card, empty, btn } = P;
  const SEL = '*, home:teams!matches_home_team_id_fkey(name), away:teams!matches_away_team_id_fkey(name)';
  const rpc = async (n, a) => { const r = await sb.rpc(n, a); if (r.error) throw r.error; return r.data; };
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { P.fail(e); } };
  const logo = (t) => t.logo_path ? `<img src="${esc(sb.storage.from('team-logos').getPublicUrl(t.logo_path).data.publicUrl)}" alt="" class="w-6 h-6 rounded-full object-cover inline-block mr-2 align-middle">` : '';
  const nm = (t, fb) => esc((t && t.name) || fb);

  async function standingsRender(main) {
    const mayAdjust = can('standings.adjust'), mayEdit = can('standings.manage'), mayResult = can('results.record') || can('matches.correct');
    const [rows, raw, teams] = await Promise.all([
      rpc('get_standings_admin'),
      q(sb.from('matches').select(SEL).is('archived_at', null).order('scheduled_at', { ascending: false }).limit(300)),
      q(sb.from('teams').select('id,name'))
    ]);
    const byId = new Map(teams.map((t) => [String(t.id), t]));
    const ms = raw.map((m) => ({ ...m, home: m.home || byId.get(String(m.home_team_id)), away: m.away || byId.get(String(m.away_team_id)) }));
    const finals = ms.filter((m) => ['final', 'under_review'].includes(m.status));
    const waiting = ms.filter((m) => ['scheduled', 'ready', 'postponed'].includes(m.status));
    const game = (m, actions) => `<div class="py-2 flex flex-wrap items-center justify-between gap-2 border-b border-rbtBorder/50 last:border-0 text-sm"><span class="text-white font-semibold">${nm(m.home, 'Home team')} vs ${nm(m.away, 'Away team')}</span><span class="font-mono text-rbtGold">${['final', 'under_review'].includes(m.status) ? m.home_score + ' - ' + m.away_score : '-'}</span><span class="text-xs text-gray-400">${esc(fmtTime(m.scheduled_at))} · ${esc(m.court || '')} ${chip(m.status)}</span><span class="flex gap-2">${actions}</span></div>`;
    main.innerHTML = `<div class="max-w-6xl mx-auto space-y-4">
      ${card('Team standings', rows.length ? `<div class="overflow-x-auto"><table class="w-full text-xs text-left min-w-[760px]"><thead><tr class="text-gray-400 border-b border-rbtBorder"><th class="pb-2">#</th><th class="pb-2">Team</th><th class="pb-2 text-center">P</th><th class="pb-2 text-center">W</th><th class="pb-2 text-center">L</th><th class="pb-2 text-center">D</th><th class="pb-2 text-center">PF</th><th class="pb-2 text-center">PA</th><th class="pb-2 text-center">Diff</th><th class="pb-2 text-center">Match pts</th><th class="pb-2 text-center">Adjust</th><th class="pb-2 text-center">Final pts</th><th class="pb-2"></th></tr></thead><tbody class="divide-y divide-rbtBorder/50 text-gray-200">
        ${rows.map((t) => `<tr><td class="py-2.5">${t.rank}</td><td class="text-white font-semibold">${logo(t)}${esc(t.team_name)} ${t.is_override ? '<span class="text-[10px] text-amber-300 uppercase">manual override</span>' : ''}${t.is_active ? '' : ' <span class="text-[10px] text-gray-500 uppercase">inactive</span>'}</td><td class="text-center">${t.played}</td><td class="text-center">${t.wins}</td><td class="text-center">${t.losses}</td><td class="text-center">${t.draws}</td><td class="text-center">${t.points_for}</td><td class="text-center">${t.points_against}</td><td class="text-center">${t.diff}</td><td class="text-center">${t.match_points}</td><td class="text-center font-bold ${t.adjustment > 0 ? 'text-emerald-300' : t.adjustment < 0 ? 'text-red-300' : 'text-gray-500'}">${t.adjustment > 0 ? '+' + t.adjustment : t.adjustment}</td><td class="text-center font-bold text-rbtOrange">${t.points}</td>
        <td class="text-right whitespace-nowrap">${mayAdjust ? btn('Adjust points', `data-ap="${t.team_id}"`, 'primary') + ' ' : ''}${btn('History', `data-ah="${t.team_id}"`)} ${mayEdit ? btn('Edit standings', `data-es="${t.team_id}"`) : ''}${mayEdit && t.is_override ? ' ' + btn('Clear override', `data-co="${t.team_id}"`) : ''}</td></tr>`).join('')}</tbody></table></div><p class="text-[11px] text-gray-500 mt-2">Final points = match points (win 2, draw 1, loss 1) + points adjustments. Adjustments can be positive or negative, and every one is recorded with a reason, a date and who made it. A manual override is labelled and recorded with who set it and why.</p>` : empty('No approved teams yet.'))}
      ${card('Previous games', finals.length ? finals.map((m) => game(m, mayResult ? btn('Edit result', `data-er="${m.id}"`, 'primary') : '')).join('') : empty(`No game has a final result yet. ${waiting.length} game${waiting.length === 1 ? ' is' : 's are'} still scheduled. Record the score of a played game below.`))}
      ${card('Record a result for a played game', waiting.length ? waiting.map((m) => game(m, mayResult ? btn('Record result', `data-rr="${m.id}"`, 'good') : '')).join('') : empty('No scheduled games.'))}</div>`;
    const again = () => standingsRender(main).then(icons);
    const num = (n, l, v) => ({ name: n, label: l, type: 'number', value: v == null ? '' : v });
    const int = (v) => (v === '' || v == null ? null : parseInt(v, 10));
    $$('[data-es]', main).forEach((b) => b.onclick = guard(async () => {
      const t = rows.find((x) => x.team_id === b.dataset.es);
      const v = await P.dialog({ title: 'Edit standings: ' + t.team_name, intro: 'This saves a labelled manual override of the MATCH numbers for this team until you clear it. To award or deduct points (for example -2), use Adjust points instead.', submit: 'Save override',
        fields: [num('w', 'Wins', t.wins), num('l', 'Losses', t.losses), num('d', 'Draws', t.draws), num('pf', 'Points scored', t.points_for), num('pa', 'Points conceded', t.points_against), num('pt', 'Table points', t.points), { name: 'r', label: 'Reason', type: 'textarea', required: true, min: 5 }] });
      if (!v) return;
      await rpc('set_standings_override', { p_team: t.team_id, p_wins: int(v.w), p_losses: int(v.l), p_draws: int(v.d), p_for: int(v.pf), p_against: int(v.pa), p_points: int(v.pt), p_reason: v.r });
      toast('Standings saved as a manual override.'); again();
    }));
    const dateToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
    const whole = (v) => { const n = Number(String(v).trim()); return Number.isInteger(n) ? n : NaN; };
    $$('[data-ap]', main).forEach((b) => b.onclick = guard(async () => {
      const t = rows.find((x) => x.team_id === b.dataset.ap);
      const v = await P.dialog({ title: 'Adjust points: ' + t.team_name, intro: `Match points ${t.match_points}, current adjustment ${t.adjustment > 0 ? '+' : ''}${t.adjustment}. Enter a positive number to award points (2) or a negative number to deduct them (-2).`, submit: 'Save adjustment',
        fields: [{ name: 'p', label: 'Points (+ or -)', type: 'number', required: true, hint: 'Whole numbers only, for example 2, 3, -1, -2, -5.' }, { name: 'd', label: 'Date of adjustment', type: 'date', value: dateToday(), required: true }, { name: 'r', label: 'Reason', type: 'textarea', required: true, min: 5 }] });
      if (!v) return;
      const n = whole(v.p); if (!Number.isInteger(n) || n === 0) throw new Error('Enter a whole number that is not zero, for example 2 or -2.');
      await rpc('add_standings_adjustment', { p_team: t.team_id, p_points: n, p_reason: v.r, p_date: v.d || null });
      toast((n > 0 ? 'Awarded +' : 'Deducted ') + n + ' points. Standings updated.'); again();
    }));
    $$('[data-ah]', main).forEach((b) => b.onclick = guard(async () => {
      const t = rows.find((x) => x.team_id === b.dataset.ah);
      const hist = await rpc('list_standings_adjustments', { p_team: t.team_id });
      const w = document.createElement('div'); w.className = 'fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/70 p-4';
      const sign = (n) => (n > 0 ? '+' + n : String(n));
      w.innerHTML = `<div class="bg-rbtCard border border-rbtBorder rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 space-y-3" role="dialog" aria-modal="true" aria-label="Adjustment history">
        <div class="flex items-center justify-between gap-3"><h3 class="font-heading font-bold text-lg text-white">Adjustment history: ${esc(t.team_name)}</h3><button data-x class="text-gray-400 hover:text-white text-xl leading-none" aria-label="Close">&times;</button></div>
        ${hist.length ? hist.map((a) => `<div class="border border-rbtBorder/60 rounded-lg p-3 text-sm ${a.reversed_at ? 'opacity-60' : ''}"><div class="flex flex-wrap items-center justify-between gap-2"><span class="font-heading font-black text-xl ${a.points > 0 ? 'text-emerald-300' : 'text-red-300'}">${sign(a.points)}</span><span class="text-xs text-gray-400">${esc(a.adjusted_on)} · by ${esc(a.created_by_name || 'Administrator')}${a.reversed_at ? ' · <b class="text-amber-300">reversed</b>' : ''}</span></div><p class="text-gray-200 mt-1">${esc(a.reason)}</p>${a.reversed_at ? `<p class="text-xs text-gray-400 mt-1">Reversed by ${esc(a.reversed_by_name || 'Administrator')}: ${esc(a.reversal_reason || '')}</p>` : (mayAdjust ? `<div class="mt-2 flex gap-2">${btn('Correct', `data-cx="${a.id}" data-pt="${a.points}"`, 'primary')} ${btn('Reverse', `data-rv="${a.id}"`)}</div>` : '')}</div>`).join('') : '<p class="text-sm text-gray-400">No adjustments have been made for this team.</p>'}</div>`;
      document.body.appendChild(w); icons();
      const close = () => w.remove(); w.addEventListener('click', (e) => { if (e.target === w || e.target.closest('[data-x]')) close(); });
      $$('[data-rv]', w).forEach((x) => x.onclick = guard(async () => { const r = await P.askReason('Reverse adjustment', 'The entry stays in the history but no longer counts.', 5, 'Reverse'); if (!r) return; await rpc('reverse_standings_adjustment', { p_id: x.dataset.rv, p_reason: r }); close(); toast('Adjustment reversed. Standings updated.'); again(); }));
      $$('[data-cx]', w).forEach((x) => x.onclick = guard(async () => {
        const v = await P.dialog({ title: 'Correct adjustment', intro: 'The old entry is reversed and the new value is recorded.', submit: 'Save correction', fields: [{ name: 'p', label: 'Correct points (+ or -)', type: 'number', required: true, value: x.dataset.pt }, { name: 'r', label: 'Reason', type: 'textarea', required: true, min: 5 }] });
        if (!v) return; const n = whole(v.p); if (!Number.isInteger(n) || n === 0) throw new Error('Enter a whole number that is not zero.');
        await rpc('correct_standings_adjustment', { p_id: x.dataset.cx, p_points: n, p_reason: v.r }); close(); toast('Adjustment corrected. Standings updated.'); again();
      }));
    }));
    $$('[data-co]', main).forEach((b) => b.onclick = guard(async () => {
      const r = await P.askReason('Clear override', 'The team goes back to the calculated numbers.', 5, 'Clear'); if (!r) return;
      await rpc('clear_standings_override', { p_team: b.dataset.co, p_reason: r }); toast('Override cleared.'); again();
    }));
    const score = (fn, title, label) => (b) => guard(async () => {
      const m = ms.find((x) => x.id === b.dataset[label]);
      const v = await P.dialog({ title, intro: nm(m.home, 'Home') + ' vs ' + nm(m.away, 'Away'), submit: 'Save', fields: [num('h', 'Home score', m.status === 'final' || m.status === 'under_review' ? m.home_score : ''), num('a', 'Away score', m.status === 'final' || m.status === 'under_review' ? m.away_score : ''), { name: 'r', label: label === 'rr' ? 'Source of result (e.g. signed score sheet)' : 'Reason for the correction', type: 'textarea', required: true, min: 5 }] });
      if (!v) return;
      await rpc(fn, { p_match_id: m.id, p_home: int(v.h), p_away: int(v.a), p_reason: v.r }); toast('Result saved. Standings updated.'); again();
    })();
    $$('[data-er]', main).forEach((b) => b.onclick = () => score('correct_final_result', 'Edit result', 'er')(b));
    $$('[data-rr]', main).forEach((b) => b.onclick = () => score('record_past_result', 'Record result', 'rr')(b));
  }
  P.modules.standings = { render: standingsRender, watch: ['matches'] };
})();
