// Initialize Lucide icons
        lucide.createIcons();

        // Global State Object
        let rbtState = {
            mode: 'public', // 'public' or 'admin'
            activePublicTab: 'overview',
            activeAdminTab: 'courtside',
            homeScore: 78,
            awayScore: 72,
            homeFouls: 3,
            awayFouls: 4,
            homeTimeouts: 2,
            awayTimeouts: 1,
            gameClockRunning: false,
            gameClockSeconds: 134, // 02:14
            shotClockSeconds: 14
        };

        // Mode Switcher Toggle
        function togglePortalMode() {
            rbtState.mode = rbtState.mode === 'public' ? 'admin' : 'public';
            const pubView = document.getElementById('public-portal-view');
            const adminView = document.getElementById('admin-portal-view');
            const modeInd = document.getElementById('mode-indicator');
            const modeBtnText = document.getElementById('mode-btn-text');

            if (rbtState.mode === 'admin') {
                pubView.classList.add('hidden');
                adminView.classList.remove('hidden');
                modeInd.textContent = 'Organizer Portal';
                modeInd.className = 'text-xs px-2 py-0.5 rounded bg-rbtGold/20 text-rbtGold font-sans font-semibold';
                modeBtnText.textContent = 'Switch to Public Fan Portal';
            } else {
                adminView.classList.add('hidden');
                pubView.classList.remove('hidden');
                modeInd.textContent = 'Public Portal';
                modeInd.className = 'text-xs px-2 py-0.5 rounded bg-rbtOrange/20 text-rbtOrange font-sans font-semibold';
                modeBtnText.textContent = 'Switch to Organizer Portal';
            }
        }

        // Public Tab Switcher
        function switchPublicTab(tabId) {
            rbtState.activePublicTab = tabId;
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

        // Admin Tab Switcher
        function switchAdminTab(tabId) {
            rbtState.activeAdminTab = tabId;
            document.querySelectorAll('.admin-tab-content').forEach(el => el.classList.add('hidden'));
            document.getElementById(`atab-${tabId}`).classList.remove('hidden');

            document.querySelectorAll('.admin-tab-btn').forEach(btn => {
                if (btn.getAttribute('data-tab') === tabId) {
                    btn.className = 'admin-tab-btn px-3.5 py-2 rounded font-heading font-bold uppercase transition bg-rbtOrange text-black shadow';
                } else {
                    btn.className = 'admin-tab-btn px-3.5 py-2 rounded font-heading font-bold uppercase transition text-gray-400 hover:text-white';
                }
            });
        }

        function switchAdminRole(role) {
            console.log("Admin role switched to:", role);
        }

        // Real-Time Scoring & State Synchronizer
        function updateAllDisplays() {
            // Admin Display
            document.getElementById('admin-home-score').textContent = rbtState.homeScore;
            document.getElementById('admin-away-score').textContent = rbtState.awayScore;
            document.getElementById('admin-home-fouls').textContent = rbtState.homeFouls;
            document.getElementById('admin-away-fouls').textContent = rbtState.awayFouls;
            document.getElementById('admin-home-to').textContent = rbtState.homeTimeouts;
            document.getElementById('admin-away-to').textContent = rbtState.awayTimeouts;

            // Public Display & Ticker
            document.getElementById('public-live-home-score').textContent = rbtState.homeScore;
            document.getElementById('public-live-away-score').textContent = rbtState.awayScore;
            document.getElementById('public-live-home-fouls').textContent = rbtState.homeFouls;
            document.getElementById('public-live-away-fouls').textContent = rbtState.awayFouls;
            document.getElementById('public-live-home-to').textContent = rbtState.homeTimeouts;
            document.getElementById('public-live-away-to').textContent = rbtState.awayTimeouts;
            document.getElementById('ticker-home-score').textContent = rbtState.homeScore;
            document.getElementById('ticker-away-score').textContent = rbtState.awayScore;
        }

        function modifyScore(team, points) {
            if (team === 'home') rbtState.homeScore += points;
            else rbtState.awayScore += points;
            updateAllDisplays();
        }

        function modifyFouls(team, delta) {
            if (team === 'home') rbtState.homeFouls = Math.max(0, rbtState.homeFouls + delta);
            else rbtState.awayFouls = Math.max(0, rbtState.awayFouls + delta);
            updateAllDisplays();
        }

        function modifyTimeout(team) {
            if (team === 'home') rbtState.homeTimeouts = Math.max(0, rbtState.homeTimeouts - 1);
            else rbtState.awayTimeouts = Math.max(0, rbtState.awayTimeouts - 1);
            updateAllDisplays();
        }

        function resetShotClock(seconds) {
            rbtState.shotClockSeconds = seconds;
            document.getElementById('admin-shot-clock').textContent = seconds + 's';
        }

        function toggleGameClock() {
            rbtState.gameClockRunning = !rbtState.gameClockRunning;
            const btn = document.getElementById('clock-toggle-btn');
            if (rbtState.gameClockRunning) {
                btn.textContent = 'Pause Clock';
                btn.className = 'bg-amber-600 hover:bg-amber-500 text-white font-heading font-bold text-xs uppercase px-4 py-2 rounded';
            } else {
                btn.textContent = 'Start Clock';
                btn.className = 'bg-emerald-600 hover:bg-emerald-500 text-white font-heading font-bold text-xs uppercase px-4 py-2 rounded';
            }
        }

        function resetGameClock() {
            rbtState.gameClockSeconds = 600; // 10 mins
            updateClockDisplay();
        }

        function updateClockDisplay() {
            let mins = Math.floor(rbtState.gameClockSeconds / 60);
            let secs = rbtState.gameClockSeconds % 60;
            let timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            document.getElementById('admin-game-clock').textContent = timeStr;
            document.getElementById('public-live-game-clock').textContent = timeStr;
            document.getElementById('ticker-clock').textContent = timeStr;
        }

        // Clock Tick Interval
        setInterval(() => {
            if (rbtState.gameClockRunning && rbtState.gameClockSeconds > 0) {
                rbtState.gameClockSeconds--;
                if (rbtState.shotClockSeconds > 0) rbtState.shotClockSeconds--;
                document.getElementById('admin-shot-clock').textContent = rbtState.shotClockSeconds + 's';
                document.getElementById('public-live-shot-clock').textContent = rbtState.shotClockSeconds + 's';
                updateClockDisplay();
            }
        }, 1000);

        // Form Handlers
        function castMvpVote(playerName) {
            document.getElementById('mvp-poll-options').classList.add('opacity-50');
            document.getElementById('mvp-vote-msg').classList.remove('hidden');
        }

        function handleHalftimeReg(e) {
            e.preventDefault();
            document.getElementById('ht-success-msg').classList.remove('hidden');
            e.target.reset();
        }

        function handleTeamRegistration(e) {
            e.preventDefault();
            document.getElementById('reg-success-box').classList.remove('hidden');
            e.target.reset();
        }

        function approveTeam(btn) {
            const row = btn.closest('tr');
            row.querySelector('td:nth-child(5)').innerHTML = '<span class="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded font-bold">APPROVED</span>';
            btn.parentElement.innerHTML = '<span class="text-xs text-emerald-400 font-bold">Verified</span>';
        }

        function rejectTeam(btn) {
            const row = btn.closest('tr');
            row.querySelector('td:nth-child(5)').innerHTML = '<span class="bg-red-500/10 text-red-400 px-2 py-0.5 rounded font-bold">REJECTED</span>';
            btn.parentElement.innerHTML = '<span class="text-xs text-red-400 font-bold">Rejected</span>';
        }

        let hypeTimer;
        function triggerHypeAlert(msg) {
            const b = document.getElementById('hype-banner');
            b.textContent = msg;
            b.classList.remove('hidden');
            clearTimeout(hypeTimer);
            hypeTimer = setTimeout(() => b.classList.add('hidden'), 6000);
            toast('Hype alert sent to the fan site');
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
            event.target.className = 'match-filter-btn px-3 py-1.5 rounded text-xs font-heading font-bold uppercase bg-rbtOrange text-black';
        }
