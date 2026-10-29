// Public site behaviour: tabs, notices, forms. Live scores, standings and news come from js/live.js.
lucide.createIcons();

function switchPublicTab(tabId) {
    document.querySelectorAll('.public-tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(`ptab-${tabId}`).classList.remove('hidden');
    document.querySelectorAll('.public-tab-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.className = 'public-tab-btn px-4 py-2 rounded text-xs font-heading font-bold uppercase transition flex items-center gap-2 bg-rbtOrange text-black shadow';
        } else {
            btn.className = 'public-tab-btn px-4 py-2 rounded text-xs font-heading font-bold uppercase transition flex items-center gap-2 text-gray-400 hover:text-white hover:bg-rbtBorder/50';
        }
    });
    lucide.createIcons();
}

let toastTimer;
function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

function filterMatches(filter) {
    document.querySelectorAll('.match-filter-btn').forEach(b => b.className = 'match-filter-btn px-3 py-1.5 rounded text-xs font-heading font-bold uppercase bg-rbtCard border border-rbtBorder text-gray-300 hover:text-white');
    if (window.event && window.event.target) window.event.target.className = 'match-filter-btn px-3 py-1.5 rounded text-xs font-heading font-bold uppercase bg-rbtOrange text-black';
    if (window.RBT && RBT.live) RBT.live.setFilter(filter);
}

// Fan Zone demo controls (not connected to the tournament database)
function castMvpVote() {
    document.getElementById('mvp-poll-options').classList.add('opacity-50');
    document.getElementById('mvp-vote-msg').classList.remove('hidden');
}
function handleHalftimeReg(e) {
    e.preventDefault();
    document.getElementById('ht-success-msg').classList.remove('hidden');
    e.target.reset();
}

// Team registration: stored in the database as a pending application for the officials to review.
async function handleTeamRegistration(e) {
    e.preventDefault();
    const err = document.getElementById('reg-error'), ok = document.getElementById('reg-success-box'), btn = document.getElementById('reg-submit');
    err.classList.add('hidden'); ok.classList.add('hidden');
    if (!window.RBT || !RBT.sb) { err.textContent = 'Registration is unavailable right now. Try again later.'; err.classList.remove('hidden'); return; }
    const mpesa = document.getElementById('reg-mpesa').value.trim();
    const roster = document.getElementById('reg-roster').value.trim() + (mpesa ? '\nM-Pesa transaction: ' + mpesa : '');
    btn.disabled = true;
    const { error } = await RBT.sb.rpc('submit_team_registration', {
        p_team_name: document.getElementById('reg-team-name').value,
        p_captain: document.getElementById('reg-captain').value,
        p_phone: document.getElementById('reg-phone').value,
        p_email: null,
        p_roster: roster
    });
    btn.disabled = false;
    if (error) { err.textContent = RBT.friendly(error); err.classList.remove('hidden'); return; }
    ok.classList.remove('hidden');
    e.target.reset();
}
