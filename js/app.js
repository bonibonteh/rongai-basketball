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

// Fan Zone demo controls (not connected to the league database)
function castMvpVote() {
    document.getElementById('mvp-poll-options').classList.add('opacity-50');
    document.getElementById('mvp-vote-msg').classList.remove('hidden');
}
function handleHalftimeReg(e) {
    e.preventDefault();
    document.getElementById('ht-success-msg').classList.remove('hidden');
    e.target.reset();
}

// Team registration lives in js/registration.js (roster with player profiles and photo upload).
