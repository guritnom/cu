// CU100 Cloud Dashboard User Portal Application Logic
(function () {
    // Configuration Defaults
    const DEFAULT_BROKER_HOST = 'messages.currentusage.com';
    const MAX_CHART_POINTS = 30;

    // Application State
    // SECURITY FIX #7: No token stored in localStorage — auth handled by HttpOnly cookie.
    // Only non-sensitive display info (user profile) is kept in localStorage.
    let currentUser = JSON.parse(localStorage.getItem('cu100_user') || 'null');
    let userDevices = [];

    let currentSerial = '';
    let currentDeviceObj = null;
    let mqttClient = null;
    let powerChart = null;
    let monthlyChart = null;
    let currentViewMode = 'realtime'; // 'realtime' | 'historical'

    let chartData = {
        labels: [],
        ch1: [],
        ch2: [],
        ch3: [],
        ch4: []
    };

    let lastTelemetryTime = 0;
    let lastTelemetryData = null;
    let inactivityTimer = null;

    // DOM Elements - Navigation & Auth
    const tabDashboard = document.getElementById('tab-dashboard');
    const tabDevices = document.getElementById('tab-devices');
    const tabSettings = document.getElementById('tab-settings');
    const navLinks = document.getElementById('nav-links');

    const viewDashboard = document.getElementById('view-dashboard');
    const viewDevices = document.getElementById('view-devices');
    const viewSettings = document.getElementById('view-settings');

    const userBadge = document.getElementById('user-badge');
    const userNameDisplay = document.getElementById('user-name-display');
    const userRoleDisplay = document.getElementById('user-role-display');
    const btnOpenLogin = document.getElementById('btn-open-login');
    const btnLogout = document.getElementById('btn-logout');
    const deviceSwitcherSelect = document.getElementById('device-switcher-select');
    const deviceSelectorWrapper = document.getElementById('device-selector-wrapper');

    // DOM Elements - Dashboard View
    const currentDeviceName = document.getElementById('current-device-name');
    const currentDeviceLocation = document.getElementById('current-device-location');
    const privacyBadge = document.getElementById('privacy-badge');
    const privacyIcon = document.getElementById('privacy-icon');
    const privacyText = document.getElementById('privacy-text');
    const btnTogglePrivacy = document.getElementById('btn-toggle-privacy');
    const rateBadge = document.getElementById('rate-badge');
    const rateBadgeText = document.getElementById('rate-badge-text');
    const btnQuickEditRate = document.getElementById('btn-quick-edit-rate');
    const rateSummarySub = document.getElementById('rate-summary-sub');
    const summaryVoltageTag = document.getElementById('summary-voltage-tag');
    const totalCostVal = document.getElementById('total-cost-val');
    const deviceSnDisplay = document.getElementById('device-sn-display');
    const btnChangeSerial = document.getElementById('btn-change-serial');

    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');

    const dashboardContentWrapper = document.getElementById('dashboard-content-wrapper');
    const unauthorizedOverlay = document.getElementById('unauthorized-overlay');
    const btnOverlayLogin = document.getElementById('btn-overlay-login');

    const totalPowerVal = document.getElementById('total-power-val');
    const totalKwhVal = document.getElementById('total-kwh-val');
    const tempSummaryVal = document.getElementById('temp-summary-val');
    const tempSummaryFVal = document.getElementById('temp-summary-f-val');
    const deviceStatusTag = document.getElementById('device-status-tag');
    const deviceLastSeen = document.getElementById('device-last-seen');

    // DOM Elements - Auth Modal & Forms
    const authModal = document.getElementById('auth-modal');
    const authModalTitle = document.getElementById('auth-modal-title');
    const authModalSubtitle = document.getElementById('auth-modal-subtitle');
    const loginForm = document.getElementById('login-form');
    const loginErrorMsg = document.getElementById('login-error-msg');
    const linkShowForgotPassword = document.getElementById('link-show-forgot-password');
    const forgotPasswordForm = document.getElementById('forgot-password-form');
    const forgotErrorMsg = document.getElementById('forgot-error-msg');
    const forgotSuccessMsg = document.getElementById('forgot-success-msg');
    const forgotIdentifier = document.getElementById('forgot-identifier');
    const btnBackToLogin = document.getElementById('btn-back-to-login');
    const btnForgotSubmit = document.getElementById('btn-forgot-submit');
    const btnCloseAuthModal = document.getElementById('btn-close-auth-modal');
    const userRecaptchaContainer = document.getElementById('user-recaptcha-container');
    const userForgotRecaptchaContainer = document.getElementById('user-forgot-recaptcha-container');

    // reCAPTCHA State
    let userRecaptchaWidgetId = null;
    let userForgotRecaptchaWidgetId = null;
    let recaptchaSiteKey = null;

    // DOM Elements - Device Modal
    const deviceModal = document.getElementById('device-modal');
    const deviceForm = document.getElementById('device-form');
    const deviceModalTitle = document.getElementById('device-modal-title');
    const deviceEditId = document.getElementById('device-edit-id');
    const deviceNameInput = document.getElementById('device-name-input');
    const deviceIdInput = document.getElementById('device-id-input');
    const deviceLocationInput = document.getElementById('device-location-input');
    const deviceVoltageInput = document.getElementById('device-voltage-input');
    const deviceRateInput = document.getElementById('device-rate-input');
    const deviceCurrencySelect = document.getElementById('device-currency-select');
    const deviceVisibilitySelect = document.getElementById('device-visibility-select');
    const deviceCh1LabelInput = document.getElementById('device-ch1-label-input');
    const deviceCh2LabelInput = document.getElementById('device-ch2-label-input');
    const deviceCh3LabelInput = document.getElementById('device-ch3-label-input');
    const deviceCh4LabelInput = document.getElementById('device-ch4-label-input');
    const deviceErrorMsg = document.getElementById('device-error-msg');
    const btnCloseDeviceModal = document.getElementById('btn-close-device-modal');
    const btnOpenAddDevice = document.getElementById('btn-open-add-device');

    // DOM Elements - Monthly Energy History
    const btnRefreshMonthly = document.getElementById('btn-refresh-monthly');
    const monthlyRangeSelect = document.getElementById('monthly-range-select');
    const chipCurrMonth = document.getElementById('chip-curr-month');
    const chipCurrKwh = document.getElementById('chip-curr-kwh');
    const chipCurrCost = document.getElementById('chip-curr-cost');
    const chipCurrVoltage = document.getElementById('chip-curr-voltage');
    const chipCurrRate = document.getElementById('chip-curr-rate');
    const monthlyHistoryTbody = document.getElementById('monthly-history-tbody');

    let cachedMonthlyHistory = [];
    let cachedMonthlyCurrency = 'IDR';

    // DOM Elements - Serial Change Modal
    const serialModal = document.getElementById('serial-modal');
    const serialForm = document.getElementById('serial-form');
    const serialInput = document.getElementById('serial-input');
    const btnCloseSerialModal = document.getElementById('btn-close-serial-modal');

    // DOM Elements - API Token Modals
    const tokenCreateModal = document.getElementById('token-create-modal');
    const tokenCreateForm = document.getElementById('token-create-form');
    const tokenNameInput = document.getElementById('token-name-input');
    const tokenErrorMsg = document.getElementById('token-error-msg');
    const btnCloseTokenCreateModal = document.getElementById('btn-close-token-create-modal');
    const btnOpenCreateToken = document.getElementById('btn-open-create-token');

    const tokenDisplayModal = document.getElementById('token-display-modal');
    const newTokenSecretDisplay = document.getElementById('new-token-secret-display');
    const btnCopyNewToken = document.getElementById('btn-copy-new-token');
    const btnCloseTokenDisplayModal = document.getElementById('btn-close-token-display-modal');

    // DOM Elements - Device QR Code & Label Modals
    const deviceQrModal = document.getElementById('device-qr-modal');
    const btnCloseQrModal = document.getElementById('btn-close-qr-modal');
    const btnDismissQrModal = document.getElementById('btn-dismiss-qr-modal');
    const qrLabelImg = document.getElementById('qr-label-img');
    const qrLabelDeviceId = document.getElementById('qr-label-device-id');
    const qrLabelDeviceName = document.getElementById('qr-label-device-name');
    const qrLabelLocation = document.getElementById('qr-label-location');
    const qrLabelSpecs = document.getElementById('qr-label-specs');
    const qrLabelUrlText = document.getElementById('qr-label-url-text');
    const qrLabelVisibilityBadge = document.getElementById('qr-label-visibility-badge');
    const qrModalUrlDisplay = document.getElementById('qr-modal-url-display');
    const btnCopyQrUrl = document.getElementById('btn-copy-qr-url');
    const linkOpenQrUrl = document.getElementById('link-open-qr-url');
    const btnDownloadQrPng = document.getElementById('btn-download-qr-png');
    const btnDownloadQrSvg = document.getElementById('btn-download-qr-svg');
    const btnPrintSingleLabel = document.getElementById('btn-print-single-label');
    const deviceLabelSticker = document.getElementById('device-label-sticker');

    const batchLabelsModal = document.getElementById('batch-labels-modal');
    const btnOpenBatchLabels = document.getElementById('btn-open-batch-labels');
    const btnCloseBatchModal = document.getElementById('btn-close-batch-modal');
    const btnDismissBatchModal = document.getElementById('btn-dismiss-batch-modal');
    const btnPrintBatchSheet = document.getElementById('btn-print-batch-sheet');
    const batchLabelsGrid = document.getElementById('batch-labels-grid');
    const batchLabelCount = document.getElementById('batch-label-count');

    let currentQrData = null;
    let currentQrDeviceId = null;

    // DOM Elements - View Mode & Historical Controls
    const btnModeRealtime = document.getElementById('btn-mode-realtime');
    const btnModeHistorical = document.getElementById('btn-mode-historical');
    const historicalControlsBar = document.getElementById('historical-controls-bar');
    const historyRangeSelect = document.getElementById('history-range-select');
    const historyResSelect = document.getElementById('history-res-select');
    const historyAggSelect = document.getElementById('history-agg-select');
    const btnFetchHistory = document.getElementById('btn-fetch-history');
    const chartMainHeading = document.getElementById('chart-main-heading');
    const chartSubHeading = document.getElementById('chart-sub-heading');
    const chartOverlayMsg = document.getElementById('chart-overlay-message');
    const chartOverlayIcon = document.getElementById('chart-overlay-icon');
    const chartOverlayText = document.getElementById('chart-overlay-text');
    const chartOverlayBtn = document.getElementById('chart-overlay-btn');

    function showChartOverlay(icon, text, btnText = null, onBtnClick = null) {
        if (!chartOverlayMsg) return;
        if (chartOverlayIcon) chartOverlayIcon.textContent = icon;
        if (chartOverlayText) chartOverlayText.innerHTML = text;
        if (chartOverlayBtn) {
            if (btnText && onBtnClick) {
                chartOverlayBtn.textContent = btnText;
                chartOverlayBtn.style.display = 'inline-block';
                chartOverlayBtn.onclick = onBtnClick;
            } else {
                chartOverlayBtn.style.display = 'none';
                chartOverlayBtn.onclick = null;
            }
        }
        chartOverlayMsg.style.display = 'block';
    }

    function hideChartOverlay() {
        if (chartOverlayMsg) chartOverlayMsg.style.display = 'none';
    }

    // -------------------------------------------------------------------
    // 1. INITIALIZATION & ROUTING
    // -------------------------------------------------------------------
    async function init() {
        initChart();
        startInactivityCheck();
        setupEventListeners();
        initUserRecaptcha();

        // Verify session via cookie (no token in localStorage needed)
        await verifyAuthToken();

        updateAuthUI();
        await refreshUserDevices();

        const rawSerial = getQueryParam('device');
        const clean = sanitizeSerial(rawSerial);

        if (clean) {
            await loadDashboardForDevice(clean);
        } else {
            resetDeviceSession();
            currentSerial = '';
            deviceSnDisplay.textContent = '--';
            currentDeviceName.textContent = 'No Device Selected';
            currentDeviceLocation.textContent = 'Please enter or select a Device ID';
            if (privacyBadge) privacyBadge.style.display = 'none';
            setStatus('connecting', 'Waiting for Device ID...');
            showModal(serialModal);
        }
    }

    function setupEventListeners() {
        tabDashboard.addEventListener('click', () => switchView('view-dashboard'));
        tabDevices.addEventListener('click', () => {
            switchView('view-devices');
            loadDevicesTable();
        });
        if (tabSettings) {
            tabSettings.addEventListener('click', () => {
                switchView('view-settings');
                loadTokensTable();
            });
        }

        deviceSwitcherSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val) {
                updateUrlSerial(val);
                loadDashboardForDevice(val);
            }
        });

        // Auth Tabs & Modals
        btnOpenLogin.addEventListener('click', () => {
            showLoginForm();
            showModal(authModal);
        });
        btnOverlayLogin.addEventListener('click', () => {
            showLoginForm();
            showModal(authModal);
        });
        if (btnCloseAuthModal) {
            btnCloseAuthModal.addEventListener('click', () => {
                hideModal(authModal);
                showLoginForm();
            });
        }
        btnLogout.addEventListener('click', handleLogout);

        loginForm.addEventListener('submit', handleLogin);

        if (linkShowForgotPassword) {
            linkShowForgotPassword.addEventListener('click', showForgotPasswordForm);
        }
        if (btnBackToLogin) {
            btnBackToLogin.addEventListener('click', showLoginForm);
        }
        if (forgotPasswordForm) {
            forgotPasswordForm.addEventListener('submit', handleForgotPassword);
        }

        // Device Management
        if (btnOpenAddDevice) {
            btnOpenAddDevice.addEventListener('click', () => openDeviceModal());
        }
        if (btnQuickEditRate) {
            btnQuickEditRate.addEventListener('click', () => {
                if (currentDeviceObj) {
                    openDeviceModal(currentDeviceObj);
                }
            });
        }
        btnCloseDeviceModal.addEventListener('click', () => hideModal(deviceModal));
        deviceForm.addEventListener('submit', handleSaveDevice);

        // Serial Change Modal
        btnChangeSerial.addEventListener('click', () => {
            serialInput.value = currentSerial.toUpperCase();
            showModal(serialModal);
        });
        if (btnCloseSerialModal) btnCloseSerialModal.addEventListener('click', () => hideModal(serialModal));
        serialForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const clean = sanitizeSerial(serialInput.value);
            if (clean) {
                updateUrlSerial(clean);
                hideModal(serialModal);
                loadDashboardForDevice(clean);
            }
        });

        btnTogglePrivacy.addEventListener('click', handleToggleDashboardPrivacy);

        // MQTT Credentials Event Listeners
        const btnTogglePass = document.getElementById('btn-toggle-mqtt-pass');
        const btnCopyUser = document.getElementById('btn-copy-mqtt-user');
        const btnCopyPass = document.getElementById('btn-copy-mqtt-pass');
        const btnRegenMqtt = document.getElementById('btn-regen-mqtt');

        if (btnTogglePass) {
            btnTogglePass.addEventListener('click', () => {
                userMqttCreds.masked = !userMqttCreds.masked;
                renderUserMqttCredentials();
            });
        }
        if (btnCopyUser) {
            btnCopyUser.addEventListener('click', () => {
                navigator.clipboard.writeText(userMqttCreds.user || '');
                btnCopyUser.textContent = 'Copied!';
                setTimeout(() => btnCopyUser.textContent = 'Copy', 1500);
            });
        }
        if (btnCopyPass) {
            btnCopyPass.addEventListener('click', () => {
                navigator.clipboard.writeText(userMqttCreds.pass || '');
                btnCopyPass.textContent = 'Copied!';
                setTimeout(() => btnCopyPass.textContent = 'Copy', 1500);
            });
        }
        if (btnRegenMqtt) {
            btnRegenMqtt.addEventListener('click', handleRegenMqttCredentials);
        }

        // API Token Management Listeners
        if (btnOpenCreateToken) {
            btnOpenCreateToken.addEventListener('click', openTokenCreateModal);
        }
        if (btnCloseTokenCreateModal) {
            btnCloseTokenCreateModal.addEventListener('click', () => hideModal(tokenCreateModal));
        }
        if (tokenCreateForm) {
            tokenCreateForm.addEventListener('submit', handleCreateToken);
        }
        if (btnCopyNewToken) {
            btnCopyNewToken.addEventListener('click', () => {
                const text = newTokenSecretDisplay.textContent || '';
                navigator.clipboard.writeText(text);
                btnCopyNewToken.textContent = 'Copied!';
                setTimeout(() => btnCopyNewToken.textContent = 'Copy', 1500);
            });
        }
        if (btnCloseTokenDisplayModal) {
            btnCloseTokenDisplayModal.addEventListener('click', () => hideModal(tokenDisplayModal));
        }

        // QR Code & Label Listeners
        if (btnCloseQrModal) btnCloseQrModal.addEventListener('click', () => hideModal(deviceQrModal));
        if (btnDismissQrModal) btnDismissQrModal.addEventListener('click', () => hideModal(deviceQrModal));
        if (btnCopyQrUrl) {
            btnCopyQrUrl.addEventListener('click', () => {
                if (currentQrData && currentQrData.url) {
                    navigator.clipboard.writeText(currentQrData.url);
                    btnCopyQrUrl.textContent = 'Copied!';
                    setTimeout(() => btnCopyQrUrl.textContent = 'Copy', 1500);
                }
            });
        }
        if (btnDownloadQrPng) {
            btnDownloadQrPng.addEventListener('click', () => {
                if (currentQrDeviceId) {
                    window.location.href = `/api/devices/${currentQrDeviceId}/qrcode?format=png&download=1`;
                }
            });
        }
        if (btnDownloadQrSvg) {
            btnDownloadQrSvg.addEventListener('click', () => {
                if (currentQrDeviceId) {
                    window.location.href = `/api/devices/${currentQrDeviceId}/qrcode?format=svg&download=1`;
                }
            });
        }
        if (btnPrintSingleLabel) {
            btnPrintSingleLabel.addEventListener('click', printSingleLabel);
        }

        // Batch Labels Listeners
        if (btnOpenBatchLabels) {
            btnOpenBatchLabels.addEventListener('click', openBatchLabelsModal);
        }
        if (btnCloseBatchModal) btnCloseBatchModal.addEventListener('click', () => hideModal(batchLabelsModal));
        if (btnDismissBatchModal) btnDismissBatchModal.addEventListener('click', () => hideModal(batchLabelsModal));
        if (btnPrintBatchSheet) {
            btnPrintBatchSheet.addEventListener('click', printBatchSheet);
        }

        // QR Label Style Tabs
        document.querySelectorAll('.qr-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.qr-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const style = btn.getAttribute('data-style');
                if (deviceLabelSticker) {
                    deviceLabelSticker.className = `device-label-sticker style-${style}`;
                }
            });
        });

        // View Mode Switcher Listeners
        if (btnModeRealtime) {
            btnModeRealtime.addEventListener('click', () => setChartMode('realtime'));
        }
        if (btnModeHistorical) {
            btnModeHistorical.addEventListener('click', () => setChartMode('historical'));
        }
        if (btnFetchHistory) {
            btnFetchHistory.addEventListener('click', () => fetchHistoricalData());
        }
        if (historyRangeSelect) {
            historyRangeSelect.addEventListener('change', () => {
                const range = historyRangeSelect.value;
                if (historyResSelect) {
                    if (range === '1h') historyResSelect.value = '1m';
                    else if (range === '24h') historyResSelect.value = '5m';
                    else if (range === '7d') historyResSelect.value = '1h';
                    else if (range === '30d') historyResSelect.value = '1d';
                    else if (range === 'all') historyResSelect.value = '1h';
                }
                fetchHistoricalData();
            });
        }
        if (historyResSelect) {
            historyResSelect.addEventListener('change', () => fetchHistoricalData());
        }
        if (historyAggSelect) {
            historyAggSelect.addEventListener('change', () => fetchHistoricalData());
        }
        if (btnRefreshMonthly) {
            btnRefreshMonthly.addEventListener('click', () => {
                if (currentSerial) loadMonthlyEnergyHistory(currentSerial);
            });
        }
        if (monthlyRangeSelect) {
            monthlyRangeSelect.addEventListener('change', () => {
                renderFilteredMonthlyView();
            });
        }

        const btnThemeToggle = document.getElementById('btn-theme-toggle');
        if (btnThemeToggle) {
            btnThemeToggle.addEventListener('click', () => {
                const active = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
                const nextTheme = active === 'light' ? 'dark' : 'light';
                document.documentElement.setAttribute('data-theme', nextTheme);
                try {
                    localStorage.setItem('cu100_theme', nextTheme);
                } catch (e) {}
                updateChartsTheme(nextTheme);
            });
        }
    }

    // -------------------------------------------------------------------
    // 2. VIEW NAVIGATION & AUTH HELPERS
    // -------------------------------------------------------------------
    function switchView(viewId) {
        [viewDashboard, viewDevices, viewSettings].forEach(v => {
            if (v) v.style.display = (v.id === viewId) ? 'block' : 'none';
        });

        [tabDashboard, tabDevices, tabSettings].forEach(t => {
            if (t) t.classList.toggle('active', t.dataset.target === viewId);
        });
    }

    function updateAuthUI() {
        if (currentUser) {
            btnOpenLogin.style.display = 'none';
            userBadge.style.display = 'flex';
            userNameDisplay.textContent = currentUser.username;
            userRoleDisplay.textContent = currentUser.role.toUpperCase();
            userRoleDisplay.className = `user-role-tag ${currentUser.role}`;

            if (navLinks) navLinks.style.display = 'flex';
            tabDevices.style.display = 'inline-flex';
            if (tabSettings) tabSettings.style.display = 'inline-flex';
            if (deviceSelectorWrapper) deviceSelectorWrapper.style.display = 'block';
            loadUserMqttCredentials();
        } else {
            btnOpenLogin.style.display = 'inline-flex';
            userBadge.style.display = 'none';
            if (navLinks) navLinks.style.display = 'none';
            tabDevices.style.display = 'none';
            if (tabSettings) tabSettings.style.display = 'none';
            if (deviceSelectorWrapper) deviceSelectorWrapper.style.display = 'none';
        }
    }

    async function verifyAuthToken() {
        try {
            // Cookie is sent automatically — no Authorization header needed
            const res = await fetch('/api/auth/me');
            if (res.ok) {
                const data = await res.json();
                if (data.user && data.user.role === 'admin') {
                    // Admin accounts are restricted to /admin portal
                    handleLogout();
                    return;
                }
                currentUser = data.user;
                localStorage.setItem('cu100_user', JSON.stringify(currentUser));
            } else {
                handleLogout();
            }
        } catch (e) { }
    }

    // reCAPTCHA Helper Functions
    function loadRecaptchaScript(callback) {
        if (window.grecaptcha && window.grecaptcha.render) {
            if (callback) callback();
            return;
        }
        let script = document.getElementById('recaptcha-api-script');
        if (!script) {
            script = document.createElement('script');
            script.id = 'recaptcha-api-script';
            script.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
            script.async = true;
            script.defer = true;
            document.head.appendChild(script);
        }

        const checkInterval = setInterval(() => {
            if (window.grecaptcha && window.grecaptcha.render) {
                clearInterval(checkInterval);
                window.grecaptcha.ready(() => {
                    if (callback) callback();
                });
            }
        }, 100);
    }

    async function initUserRecaptcha() {
        try {
            const res = await fetch('/api/auth/config');
            if (!res.ok) return;
            const config = await res.json();
            if (config.recaptchaEnabled && config.recaptchaSiteKey) {
                recaptchaSiteKey = config.recaptchaSiteKey;
                if (userRecaptchaContainer) {
                    userRecaptchaContainer.style.display = 'flex';
                }
                loadRecaptchaScript(() => {
                    if (authModal && authModal.classList.contains('active')) {
                        renderUserRecaptcha();
                    }
                });
            }
        } catch (e) {
            console.warn('[reCAPTCHA Config fetch failed]:', e);
        }
    }

    function renderUserRecaptcha() {
        if (!recaptchaSiteKey || !userRecaptchaContainer || userRecaptchaWidgetId !== null) return;
        if (!window.grecaptcha || !window.grecaptcha.render) return;
        try {
            const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
            userRecaptchaWidgetId = grecaptcha.render('user-recaptcha-container', {
                sitekey: recaptchaSiteKey,
                theme: theme
            });
        } catch (e) {
            console.warn('[reCAPTCHA render failed]:', e);
        }
    }

    function renderUserForgotRecaptcha() {
        if (!recaptchaSiteKey || !userForgotRecaptchaContainer || userForgotRecaptchaWidgetId !== null) return;
        if (!window.grecaptcha || !window.grecaptcha.render) return;
        try {
            const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
            userForgotRecaptchaWidgetId = grecaptcha.render('user-forgot-recaptcha-container', {
                sitekey: recaptchaSiteKey,
                theme: theme
            });
        } catch (e) {
            console.warn('[Forgot reCAPTCHA render failed]:', e);
        }
    }

    function showLoginForm() {
        if (loginForm) loginForm.style.display = 'block';
        if (forgotPasswordForm) forgotPasswordForm.style.display = 'none';
        if (authModalTitle) authModalTitle.textContent = 'User Sign In';
        if (authModalSubtitle) authModalSubtitle.textContent = 'Sign in to your user account to access and manage your devices.';
        if (loginErrorMsg) loginErrorMsg.style.display = 'none';
        if (forgotErrorMsg) forgotErrorMsg.style.display = 'none';
        if (forgotSuccessMsg) forgotSuccessMsg.style.display = 'none';
    }

    function showForgotPasswordForm() {
        if (loginForm) loginForm.style.display = 'none';
        if (forgotPasswordForm) forgotPasswordForm.style.display = 'block';
        if (authModalTitle) authModalTitle.textContent = 'Reset Password';
        if (authModalSubtitle) authModalSubtitle.textContent = 'Enter your email or username to receive a password reset link.';
        if (forgotErrorMsg) forgotErrorMsg.style.display = 'none';
        if (forgotSuccessMsg) forgotSuccessMsg.style.display = 'none';

        if (recaptchaSiteKey && userForgotRecaptchaContainer) {
            userForgotRecaptchaContainer.style.display = 'flex';
            loadRecaptchaScript(() => {
                renderUserForgotRecaptcha();
            });
        }
    }

    async function handleForgotPassword(e) {
        e.preventDefault();
        if (forgotErrorMsg) forgotErrorMsg.style.display = 'none';
        if (forgotSuccessMsg) forgotSuccessMsg.style.display = 'none';

        const identifier = (forgotIdentifier?.value || '').trim();
        if (!identifier) {
            if (forgotErrorMsg) {
                forgotErrorMsg.textContent = 'Please enter your registered email address or username.';
                forgotErrorMsg.style.display = 'block';
            }
            return;
        }

        let recaptchaToken = null;
        if (recaptchaSiteKey && userForgotRecaptchaWidgetId !== null && window.grecaptcha) {
            recaptchaToken = grecaptcha.getResponse(userForgotRecaptchaWidgetId);
            if (!recaptchaToken) {
                if (forgotErrorMsg) {
                    forgotErrorMsg.textContent = 'Please complete the reCAPTCHA challenge';
                    forgotErrorMsg.style.display = 'block';
                }
                return;
            }
        }

        if (btnForgotSubmit) {
            btnForgotSubmit.disabled = true;
            btnForgotSubmit.textContent = 'Sending...';
        }

        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier, portal: 'user', recaptchaToken })
            });

            const data = await res.json();

            if (!res.ok) {
                if (forgotErrorMsg) {
                    forgotErrorMsg.textContent = data.error || 'Failed to request password reset.';
                    forgotErrorMsg.style.display = 'block';
                }
                if (userForgotRecaptchaWidgetId !== null && window.grecaptcha) {
                    grecaptcha.reset(userForgotRecaptchaWidgetId);
                }
                if (btnForgotSubmit) {
                    btnForgotSubmit.disabled = false;
                    btnForgotSubmit.textContent = 'Send Reset Link';
                }
                return;
            }

            // Success
            if (forgotSuccessMsg) {
                forgotSuccessMsg.textContent = data.message || 'If an account matches that email, a password reset link has been sent.';
                forgotSuccessMsg.style.display = 'block';
            }
            if (forgotIdentifier) forgotIdentifier.value = '';

            if (userForgotRecaptchaWidgetId !== null && window.grecaptcha) {
                grecaptcha.reset(userForgotRecaptchaWidgetId);
            }

            if (btnForgotSubmit) {
                btnForgotSubmit.disabled = false;
                btnForgotSubmit.textContent = 'Send Reset Link';
            }
        } catch (err) {
            if (forgotErrorMsg) {
                forgotErrorMsg.textContent = 'Server connection error. Please try again.';
                forgotErrorMsg.style.display = 'block';
            }
            if (userForgotRecaptchaWidgetId !== null && window.grecaptcha) {
                grecaptcha.reset(userForgotRecaptchaWidgetId);
            }
            if (btnForgotSubmit) {
                btnForgotSubmit.disabled = false;
                btnForgotSubmit.textContent = 'Send Reset Link';
            }
        }
    }

    async function handleLogin(e) {
        e.preventDefault();
        loginErrorMsg.style.display = 'none';

        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;

        let recaptchaToken = null;
        if (recaptchaSiteKey && userRecaptchaWidgetId !== null && window.grecaptcha) {
            recaptchaToken = grecaptcha.getResponse(userRecaptchaWidgetId);
            if (!recaptchaToken) {
                loginErrorMsg.textContent = 'Please complete the reCAPTCHA challenge';
                loginErrorMsg.style.display = 'block';
                return;
            }
        }

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, recaptchaToken })
            });
            const data = await res.json();

            if (!res.ok) {
                loginErrorMsg.textContent = data.error || 'Login failed';
                loginErrorMsg.style.display = 'block';
                if (userRecaptchaWidgetId !== null && window.grecaptcha) {
                    grecaptcha.reset(userRecaptchaWidgetId);
                }
                return;
            }

            if (data.user.role === 'admin') {
                loginErrorMsg.textContent = 'Admin accounts must sign in via the Admin Back-Office at /admin';
                loginErrorMsg.style.display = 'block';
                if (userRecaptchaWidgetId !== null && window.grecaptcha) {
                    grecaptcha.reset(userRecaptchaWidgetId);
                }
                return;
            }

            // SECURITY FIX #7: Server sets HttpOnly cookie — only store display info (no token)
            currentUser = data.user;
            localStorage.setItem('cu100_user', JSON.stringify(currentUser));

            if (userRecaptchaWidgetId !== null && window.grecaptcha) {
                grecaptcha.reset(userRecaptchaWidgetId);
            }

            hideModal(authModal);
            loginForm.reset();
            updateAuthUI();
            await refreshUserDevices();

            if (currentSerial) {
                loadDashboardForDevice(currentSerial);
            }
        } catch (err) {
            loginErrorMsg.textContent = 'Server connection error';
            loginErrorMsg.style.display = 'block';
            if (userRecaptchaWidgetId !== null && window.grecaptcha) {
                grecaptcha.reset(userRecaptchaWidgetId);
            }
        }
    }

    async function handleLogout() {
        try {
            // SECURITY FIX #7: Ask server to clear the HttpOnly cookie
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch (e) {}
        currentUser = null;
        localStorage.removeItem('cu100_user');
        updateAuthUI();
        switchView('view-dashboard');
        refreshUserDevices();
        if (currentSerial) {
            loadDashboardForDevice(currentSerial);
        }
    }

    // -------------------------------------------------------------------
    // 3. DEVICE LOADING & PRIVACY CHECK
    // -------------------------------------------------------------------
    function disconnectMQTT() {
        if (mqttClient) {
            try {
                mqttClient.onopen = null;
                mqttClient.onmessage = null;
                mqttClient.onerror = null;
                mqttClient.onclose = null;
                if (typeof mqttClient.close === 'function') {
                    mqttClient.close();
                } else if (typeof mqttClient.end === 'function') {
                    mqttClient.end(true);
                }
            } catch (e) {
                console.error('[MQTT Disconnect Error]:', e);
            }
            mqttClient = null;
        }
    }

    function resetDeviceSession() {
        lastTelemetryData = null;
        lastTelemetryTime = 0;
        disconnectMQTT();
        resetTelemetryUI();
        resetChart();
        setDeviceOnlineStatus(false, 'Waiting for telemetry...');
    }

    function resetTelemetryUI() {
        const currency = (currentDeviceObj && currentDeviceObj.currency) || 'IDR';
        const voltage = (currentDeviceObj && currentDeviceObj.voltage != null) ? Number(currentDeviceObj.voltage) : 220.0;
        const rate = (currentDeviceObj && currentDeviceObj.electricity_rate != null) ? Number(currentDeviceObj.electricity_rate) : 0.0;
        const rateDisplay = formatRate(rate, currency);

        for (let ch = 1; ch <= 4; ch++) {
            updateElement(`ch${ch}-w`, '0');
            updateElement(`ch${ch}-val`, '0.00');
            updateElement(`ch${ch}-kwh`, '0.000');
            updateElement(`ch${ch}-cost`, formatCurrency(0, currency));
            setGauge(`ch${ch}-gauge`, 0, 30.0);
        }

        updateElement('total-power-val', '0');
        updateElement('total-kwh-val', '0.000');
        updateElement('total-cost-val', formatCurrency(0, currency));

        updateElement('temp-summary-val', '--');
        updateElement('temp-summary-f-val', '--');

        updateElement('chip-curr-month', '--');
        updateElement('chip-curr-kwh', '0.000 kWh');
        updateElement('chip-curr-cost', formatCurrency(0, currency));
        updateElement('chip-curr-voltage', `${voltage.toFixed(1)} V`);
        updateElement('chip-curr-rate', `${rateDisplay} / kWh`);

        cachedMonthlyHistory = [];
        const tbody = document.getElementById('monthly-history-tbody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Waiting for monthly energy data...</td></tr>';
        }
        renderMonthlyChart([]);
    }

    async function loadDashboardForDevice(serial) {
        const cleanSerial = sanitizeSerial(serial);

        // Always completely reset the previous device session (telemetry cache, timestamp, WebSocket, UI metrics & chart)
        resetDeviceSession();

        currentSerial = cleanSerial;
        deviceSnDisplay.textContent = currentSerial ? currentSerial.toUpperCase() : '--';

        if (!currentSerial) {
            currentDeviceName.textContent = 'No Device Selected';
            currentDeviceLocation.textContent = 'Please enter or select a Device ID';
            if (privacyBadge) privacyBadge.style.display = 'none';
            setStatus('connecting', 'Waiting for Device ID...');
            return;
        }

        setStatus('connecting', 'Connecting...');

        try {
            // Cookie sent automatically — no Authorization header needed
            const res = await fetch(`/api/devices/check-access/${currentSerial}`);
            const data = await res.json();

            // Guard against race conditions if user switched devices while fetch was in flight
            if (currentSerial !== cleanSerial) return;

            currentDeviceObj = data.device;
            applyChannelLabels(currentDeviceObj);
            currentDeviceName.textContent = data.device?.name || `CU100 (${currentSerial.toUpperCase()})`;
            if (data.registered === false) {
                currentDeviceLocation.textContent = 'Location: Unregistered Device';
            } else {
                currentDeviceLocation.textContent = `Location: ${data.device?.location || 'Unassigned'}`;
            }

            const rate = data.device?.electricity_rate != null ? Number(data.device.electricity_rate) : 0.00;
            const currency = data.device?.currency || 'IDR';
            const voltage = data.device?.voltage != null ? Number(data.device.voltage) : 220.0;
            const rateDisplay = formatRate(rate, currency);

            if (rateBadge) {
                rateBadge.style.display = 'flex';
                if (rateBadgeText) rateBadgeText.textContent = `Rate: ${rateDisplay} / kWh`;
            }
            if (rateSummarySub) {
                rateSummarySub.textContent = `Rate: ${rateDisplay} / kWh · Line: ${voltage.toFixed(1)}V`;
            }
            if (summaryVoltageTag) {
                summaryVoltageTag.textContent = `${voltage.toFixed(1)}V`;
            }

            const canEdit = !!(currentUser && currentDeviceObj && (currentUser.id === currentDeviceObj.owner_id || currentUser.role === 'admin'));
            if (btnQuickEditRate) {
                btnQuickEditRate.style.display = canEdit ? 'inline-flex' : 'none';
            }

            if (data.monthly_energy && data.monthly_energy.current_month) {
                const curMonth = data.monthly_energy.current_month;
                const totalKwh = Number(curMonth.kwh_total || 0).toFixed(3);
                const totalCost = Number(curMonth.cost_total || 0);
                updateElement('total-kwh-val', totalKwh);
                updateElement('total-cost-val', formatCurrency(totalCost, currency));

                for (let ch = 1; ch <= 4; ch++) {
                    const chKwh = Number(curMonth[`kwh_ch${ch}`] || 0);
                    updateElement(`ch${ch}-kwh`, chKwh.toFixed(3));
                    updateElement(`ch${ch}-cost`, formatCurrency(chKwh * rate, currency));
                }
            } else {
                updateElement('total-kwh-val', '0.000');
                updateElement('total-cost-val', formatCurrency(0, currency));
                for (let ch = 1; ch <= 4; ch++) {
                    updateElement(`ch${ch}-kwh`, '0.000');
                    updateElement(`ch${ch}-cost`, formatCurrency(0, currency));
                }
            }

            const vis = data.visibility || 'private';
            privacyBadge.style.display = 'flex';
            privacyBadge.className = `privacy-badge ${vis}`;
            privacyIcon.textContent = vis === 'public' ? '🌐' : '🔒';
            privacyText.textContent = vis === 'public' ? 'Public' : 'Private';

            if (data.allowed) {
                unauthorizedOverlay.style.display = 'none';
                dashboardContentWrapper.style.display = 'block';

                if (currentUser && currentUser.role === 'user' && currentDeviceObj && currentUser.id === currentDeviceObj.owner_id) {
                    btnTogglePrivacy.style.display = 'inline-flex';
                } else {
                    btnTogglePrivacy.style.display = 'none';
                }

                connectMQTT(currentSerial);

                loadMonthlyEnergyHistory(currentSerial);

                if (currentViewMode === 'historical') {
                    fetchHistoricalData();
                }
            } else {
                unauthorizedOverlay.style.display = 'flex';
                dashboardContentWrapper.style.display = 'none';
                btnTogglePrivacy.style.display = 'none';
                setStatus('connecting', 'Access Restricted (Private)');
                disconnectMQTT();
            }
        } catch (e) {
            console.error('[Load Device Error]:', e);
            setStatus('connecting', 'Error loading device');
            disconnectMQTT();
        }
    }

    async function handleToggleDashboardPrivacy() {
        if (!currentDeviceObj || !currentDeviceObj.id) return;
        const newVis = currentDeviceObj.visibility === 'private' ? 'public' : 'private';

        try {
            // Cookie sent automatically — no Authorization header needed
            const res = await fetch(`/api/devices/${currentDeviceObj.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ visibility: newVis })
            });

            if (res.ok) {
                await loadDashboardForDevice(currentSerial);
                await refreshUserDevices();
            }
        } catch (err) {
            console.error('[Toggle Privacy Error]:', err);
        }
    }

    async function refreshUserDevices() {
        deviceSwitcherSelect.innerHTML = '<option value="">-- Switch Device --</option>';
        userDevices = [];

        // SECURITY FIX #7: Check currentUser (set from cookie session) instead of authToken
        if (!currentUser) return;

        try {
            // Cookie sent automatically
            const res = await fetch('/api/devices');
            if (res.ok) {
                const data = await res.json();
                userDevices = data.devices || [];

                userDevices.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d.device_id;
                    opt.textContent = `${d.name} (${d.device_id.toUpperCase()}) - ${d.visibility.toUpperCase()}`;
                    if (d.device_id.toLowerCase() === currentSerial.toLowerCase()) {
                        opt.selected = true;
                    }
                    deviceSwitcherSelect.appendChild(opt);
                });
            }
        } catch (e) { }
    }

    // -------------------------------------------------------------------
    // 4. DEVICE MANAGEMENT CRUD
    // -------------------------------------------------------------------
    async function loadDevicesTable() {
        const tableBody = document.getElementById('devices-table-body');
        tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Loading devices...</td></tr>';

        try {
            // Cookie sent automatically
            const res = await fetch('/api/devices');
            const data = await res.json();
            const devices = data.devices || [];

            if (devices.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No devices registered yet. Click "Register New Device" to add your device.</td></tr>';
                return;
            }

            tableBody.innerHTML = '';
            devices.forEach(d => {
                const tr = document.createElement('tr');
                const createdDate = new Date(d.created_at).toLocaleDateString();
                const rateVal = d.electricity_rate != null ? Number(d.electricity_rate).toFixed(2) : '0.00';
                const currVal = d.currency || 'IDR';
                const voltVal = d.voltage != null ? Number(d.voltage).toFixed(1) : '220.0';
                const rateFormatted = currVal === 'USD'
                    ? `$${rateVal} / kWh`
                    : `Rp ${Number(rateVal).toLocaleString('id-ID', { minimumFractionDigits: 2 })} / kWh`;

                tr.innerHTML = `
                    <td><strong>${escapeHtml(d.name)}</strong></td>
                    <td><code>${escapeHtml(d.device_id.toUpperCase())}</code></td>
                    <td>${escapeHtml(d.location)}</td>
                    <td><span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.3); font-weight: 700;">⚡ ${voltVal} V</span></td>
                    <td><span class="badge" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); font-weight: 600;">${rateFormatted} (${currVal})</span></td>
                    <td><span class="badge badge-${d.visibility}">${d.visibility === 'public' ? '🌐 Public' : '🔒 Private'}</span></td>
                    <td>${createdDate}</td>
                    <td>
                        <div class="table-actions">
                            <button class="btn-icon-sm btn-icon-accent" onclick="window.openDeviceQrModal('${escapeHtml(d.device_id)}')" title="View and Print QR Code Label">🏷️ Label</button>
                            <button class="btn-icon-sm" onclick="window.editDevice(${d.id})">Edit</button>
                            <button class="btn-icon-sm btn-icon-danger" onclick="window.deleteDevice(${d.id})">Delete</button>
                        </div>
                    </td>
                `;
                tableBody.appendChild(tr);
            });
        } catch (e) {
            tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#f43f5e;">Error loading devices.</td></tr>';
        }
    }

    function openDeviceModal(device = null) {
        deviceErrorMsg.style.display = 'none';
        if (device) {
            deviceModalTitle.textContent = 'Edit Device Settings';
            deviceEditId.value = device.id;
            deviceNameInput.value = device.name;
            deviceIdInput.value = device.device_id.toUpperCase();
            deviceIdInput.disabled = true;
            deviceLocationInput.value = device.location;
            if (deviceVoltageInput) deviceVoltageInput.value = device.voltage != null ? Number(device.voltage).toFixed(1) : '220.0';
            deviceRateInput.value = device.electricity_rate != null ? Number(device.electricity_rate).toFixed(2) : '0.00';
            deviceCurrencySelect.value = device.currency || 'IDR';
            deviceVisibilitySelect.value = device.visibility;
            if (deviceCh1LabelInput) deviceCh1LabelInput.value = device.ch1_label || 'Channel 1';
            if (deviceCh2LabelInput) deviceCh2LabelInput.value = device.ch2_label || 'Channel 2';
            if (deviceCh3LabelInput) deviceCh3LabelInput.value = device.ch3_label || 'Channel 3';
            if (deviceCh4LabelInput) deviceCh4LabelInput.value = device.ch4_label || 'Channel 4';
        } else {
            deviceModalTitle.textContent = 'Register New Device';
            deviceEditId.value = '';
            deviceForm.reset();
            deviceIdInput.disabled = false;
            if (deviceVoltageInput) deviceVoltageInput.value = '220.0';
            deviceRateInput.value = '0.00';
            deviceCurrencySelect.value = 'IDR';
            if (deviceCh1LabelInput) deviceCh1LabelInput.value = 'Channel 1';
            if (deviceCh2LabelInput) deviceCh2LabelInput.value = 'Channel 2';
            if (deviceCh3LabelInput) deviceCh3LabelInput.value = 'Channel 3';
            if (deviceCh4LabelInput) deviceCh4LabelInput.value = 'Channel 4';
        }
        showModal(deviceModal);
    }

    async function handleSaveDevice(e) {
        e.preventDefault();
        deviceErrorMsg.style.display = 'none';

        const id = deviceEditId.value;
        const name = deviceNameInput.value;
        const device_id = deviceIdInput.value;
        const location = deviceLocationInput.value;
        const voltage = deviceVoltageInput ? (parseFloat(deviceVoltageInput.value) || 220.0) : 220.0;
        const electricity_rate = parseFloat(deviceRateInput.value) || 0;
        const currency = deviceCurrencySelect.value || 'IDR';
        const visibility = deviceVisibilitySelect.value;
        const ch1_label = deviceCh1LabelInput ? deviceCh1LabelInput.value.trim() : 'Channel 1';
        const ch2_label = deviceCh2LabelInput ? deviceCh2LabelInput.value.trim() : 'Channel 2';
        const ch3_label = deviceCh3LabelInput ? deviceCh3LabelInput.value.trim() : 'Channel 3';
        const ch4_label = deviceCh4LabelInput ? deviceCh4LabelInput.value.trim() : 'Channel 4';

        const payload = { name, device_id, location, visibility, electricity_rate, currency, voltage, ch1_label, ch2_label, ch3_label, ch4_label };

        try {
            const url = id ? `/api/devices/${id}` : '/api/devices';
            const method = id ? 'PUT' : 'POST';

            // Cookie sent automatically
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok) {
                deviceErrorMsg.textContent = data.error || 'Failed to save device';
                deviceErrorMsg.style.display = 'block';
                return;
            }

            hideModal(deviceModal);
            loadDevicesTable();
            refreshUserDevices();
            if (currentSerial && device_id.toLowerCase() === currentSerial.toLowerCase()) {
                loadDashboardForDevice(currentSerial);
            }
        } catch (err) {
            deviceErrorMsg.textContent = 'Connection error';
            deviceErrorMsg.style.display = 'block';
        }
    }

    window.editDevice = async function (id) {
        try {
            // Cookie sent automatically
            const res = await fetch('/api/devices');
            const data = await res.json();
            const dev = (data.devices || []).find(d => d.id === id);
            if (dev) openDeviceModal(dev);
        } catch (e) { }
    };

    window.deleteDevice = async function (id) {
        if (!confirm('Are you sure you want to delete this device?')) return;
        try {
            // Cookie sent automatically
            const res = await fetch(`/api/devices/${id}`, { method: 'DELETE' });
            if (res.ok) {
                loadDevicesTable();
                refreshUserDevices();
            }
        } catch (e) { }
    };

    // -------------------------------------------------------------------
    // 4.25 DEVICE QR CODE & LABEL MANAGEMENT
    // -------------------------------------------------------------------
    window.openDeviceQrModal = async function (rawDeviceId) {
        if (!deviceQrModal) return;
        const deviceId = (rawDeviceId || '').trim().toLowerCase().replace(/^cu100_/, '');
        if (!deviceId) return;

        currentQrDeviceId = deviceId;

        // Reset to initial loading state
        if (qrLabelDeviceId) qrLabelDeviceId.textContent = deviceId;
        if (qrLabelDeviceName) qrLabelDeviceName.textContent = 'Loading details...';
        if (qrLabelLocation) qrLabelLocation.textContent = '...';
        if (qrLabelSpecs) qrLabelSpecs.textContent = '220V AC • 4x CT (0-100A)';
        const initialUrl = `${window.location.origin}/?device=${deviceId}`;
        if (qrLabelUrlText) qrLabelUrlText.textContent = initialUrl;
        if (qrModalUrlDisplay) qrModalUrlDisplay.textContent = initialUrl;
        if (linkOpenQrUrl) linkOpenQrUrl.href = initialUrl;
        if (qrLabelImg) qrLabelImg.src = '';

        showModal(deviceQrModal);

        try {
            const res = await fetch(`/api/devices/${deviceId}/qrcode`);
            const data = await res.json();
            currentQrData = data;

            const dev = data.device || {};
            const devName = dev.name || `CU100 (${deviceId.toUpperCase()})`;
            const devLoc = dev.location || 'Home / Facility';
            const devVolt = dev.voltage || 220.0;
            const devVis = (dev.visibility || 'public').toUpperCase();

            if (qrLabelImg) qrLabelImg.src = data.dataUrl;
            if (qrLabelDeviceId) qrLabelDeviceId.textContent = data.device_id;
            if (qrLabelDeviceName) qrLabelDeviceName.textContent = devName;
            if (qrLabelLocation) qrLabelLocation.textContent = devLoc;
            if (qrLabelSpecs) qrLabelSpecs.textContent = `${devVolt}V AC • 4x CT (0-100A)`;
            if (qrLabelVisibilityBadge) qrLabelVisibilityBadge.textContent = devVis;
            if (qrLabelUrlText) qrLabelUrlText.textContent = data.url;
            if (qrModalUrlDisplay) qrModalUrlDisplay.textContent = data.url;
            if (linkOpenQrUrl) linkOpenQrUrl.href = data.url;
        } catch (err) {
            console.error('[QR Modal Error]:', err);
            if (qrLabelDeviceName) qrLabelDeviceName.textContent = 'Failed to load QR code';
        }
    };

    function printSingleLabel() {
        if (!deviceQrModal) return;
        deviceQrModal.classList.add('print-active');
        window.print();
        setTimeout(() => {
            deviceQrModal.classList.remove('print-active');
        }, 1000);
    }

    async function openBatchLabelsModal() {
        if (!batchLabelsModal) return;
        batchLabelsGrid.innerHTML = '<div style="text-align:center; padding: 2rem; color: var(--text-muted);">Generating QR labels for all registered devices...</div>';
        showModal(batchLabelsModal);

        try {
            const res = await fetch('/api/devices-qrcodes');
            const data = await res.json();
            const devices = data.devices || [];

            if (batchLabelCount) batchLabelCount.textContent = `${devices.length} registered device(s)`;
            if (devices.length === 0) {
                batchLabelsGrid.innerHTML = '<div style="text-align:center; padding: 2rem; color: var(--text-muted);">No devices registered yet.</div>';
                return;
            }

            batchLabelsGrid.innerHTML = '';
            devices.forEach(d => {
                const cleanId = (d.device_id || '').toLowerCase().replace(/^cu100_/, '');
                const card = document.createElement('div');
                card.className = 'device-label-sticker';
                card.innerHTML = `
                    <div class="sticker-header">
                        <div class="sticker-brand">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="sticker-brand-icon" aria-hidden="true">
                                <defs>
                                    <linearGradient id="stkRing_${cleanId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00e5ff"/><stop offset="1" stop-color="#067fa8"/></linearGradient>
                                    <linearGradient id="stkBolt_${cleanId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd34d"/><stop offset="0.45" stop-color="#ffb020"/><stop offset="1" stop-color="#ff7a00"/></linearGradient>
                                    <radialGradient id="stkHalo_${cleanId}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffb020" stop-opacity="0.5"/><stop offset="0.7" stop-color="#ffb020" stop-opacity="0.12"/><stop offset="1" stop-color="#ffb020" stop-opacity="0"/></radialGradient>
                                </defs>
                                <rect width="512" height="512" rx="112" fill="#0a0e14"/>
                                <circle cx="256" cy="256" r="160" fill="none" stroke="url(#stkRing_${cleanId})" stroke-width="60" stroke-linecap="round" stroke-dasharray="880 126" transform="rotate(-30 256 256)"/>
                                <circle cx="256" cy="256" r="160" fill="url(#stkHalo_${cleanId})"/>
                                <path d="M302 48 L184 288 L254 288 L228 428 L344 216 L270 216 Z" fill="url(#stkBolt_${cleanId})"/>
                            </svg>
                            <div class="sticker-brand-title">CurrentUsage</div>
                        </div>
                        <div class="sticker-badge">${escapeHtml(d.visibility ? d.visibility.toUpperCase() : 'PUBLIC')}</div>
                    </div>
                    <div class="sticker-body">
                        <div class="qr-col">
                            <img src="${d.dataUrl}" alt="QR Code for ${cleanId}" class="qr-img" />
                        </div>
                        <div class="info-col">
                            <div class="meta-row">
                                <span class="meta-label">DEVICE ID</span>
                                <span class="meta-value-id">${cleanId}</span>
                            </div>
                            <div class="meta-row">
                                <span class="meta-label">FRIENDLY NAME</span>
                                <span class="meta-value">${escapeHtml(d.name)}</span>
                            </div>
                            <div class="meta-row">
                                <span class="meta-label">LOCATION</span>
                                <span class="meta-value">${escapeHtml(d.location || 'Default')}</span>
                            </div>
                            <div class="meta-row">
                                <span class="meta-label">SPECS / RATINGS</span>
                                <span class="meta-value">${d.voltage || 220}V AC • 4x CT</span>
                            </div>
                        </div>
                    </div>
                    <div class="sticker-footer">
                        <div class="url-text">${escapeHtml(d.url)}</div>
                        <div class="scan-hint">Scan with camera to view live dashboard</div>
                    </div>
                `;
                batchLabelsGrid.appendChild(card);
            });
        } catch (err) {
            console.error('[Batch QR Error]:', err);
            batchLabelsGrid.innerHTML = '<div style="text-align:center; padding: 2rem; color: #f43f5e;">Failed to load batch labels.</div>';
        }
    }

    function printBatchSheet() {
        if (!batchLabelsModal) return;
        batchLabelsModal.classList.add('print-active');
        window.print();
        setTimeout(() => {
            batchLabelsModal.classList.remove('print-active');
        }, 1000);
    }

    // -------------------------------------------------------------------
    // 4.5 API TOKENS MANAGEMENT
    // -------------------------------------------------------------------
    async function loadTokensTable() {
        const tableBody = document.getElementById('tokens-table-body');
        if (!tableBody) return;
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading API tokens...</td></tr>';

        try {
            const res = await fetch('/api/user/tokens');
            const data = await res.json();
            const tokens = data.tokens || [];

            if (tokens.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No API tokens generated yet. Click "Generate New Token" to create one.</td></tr>';
                return;
            }

            tableBody.innerHTML = '';
            tokens.forEach(t => {
                const tr = document.createElement('tr');
                const createdDate = new Date(t.created_at).toLocaleDateString();
                const lastUsed = t.last_used_at ? new Date(t.last_used_at).toLocaleString() : 'Never';

                tr.innerHTML = `
                    <td><strong>${escapeHtml(t.name)}</strong></td>
                    <td><code>${escapeHtml(t.token_prefix)}</code></td>
                    <td>${createdDate}</td>
                    <td>${lastUsed}</td>
                    <td>
                        <div class="table-actions">
                            <button class="btn-icon-sm btn-icon-danger" onclick="window.deleteToken(${t.id})">Revoke</button>
                        </div>
                    </td>
                `;
                tableBody.appendChild(tr);
            });
        } catch (e) {
            tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#f43f5e;">Error loading API tokens.</td></tr>';
        }
    }

    function openTokenCreateModal() {
        if (tokenErrorMsg) tokenErrorMsg.style.display = 'none';
        if (tokenCreateForm) tokenCreateForm.reset();
        showModal(tokenCreateModal);
    }

    async function handleCreateToken(e) {
        e.preventDefault();
        if (tokenErrorMsg) tokenErrorMsg.style.display = 'none';

        const name = tokenNameInput.value;

        try {
            const res = await fetch('/api/user/tokens', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });

            const data = await res.json();
            if (!res.ok) {
                if (tokenErrorMsg) {
                    tokenErrorMsg.textContent = data.error || 'Failed to generate API token';
                    tokenErrorMsg.style.display = 'block';
                }
                return;
            }

            hideModal(tokenCreateModal);
            newTokenSecretDisplay.textContent = data.token.secret;
            showModal(tokenDisplayModal);
            loadTokensTable();
        } catch (err) {
            if (tokenErrorMsg) {
                tokenErrorMsg.textContent = 'Connection error';
                tokenErrorMsg.style.display = 'block';
            }
        }
    }

    window.deleteToken = async function (id) {
        if (!confirm('Are you sure you want to revoke this API token? Any application using this token will lose access.')) return;
        try {
            const res = await fetch(`/api/user/tokens/${id}`, { method: 'DELETE' });
            if (res.ok) {
                loadTokensTable();
            }
        } catch (e) { }
    };

    // USER MQTT CREDENTIALS
    let userMqttCreds = { user: '', pass: '', masked: true };

    async function loadUserMqttCredentials() {
        if (!currentUser) return;
        try {
            // Cookie sent automatically
            const res = await fetch('/api/user/mqtt-credentials');
            if (res.ok) {
                const data = await res.json();
                userMqttCreds.user = data.mqtt_user || '';
                userMqttCreds.pass = data.mqtt_pass || '';
                renderUserMqttCredentials();
            }
        } catch (e) { }
    }

    function renderUserMqttCredentials() {
        const userEl = document.getElementById('user-mqtt-username');
        const passEl = document.getElementById('user-mqtt-password');
        const toggleBtn = document.getElementById('btn-toggle-mqtt-pass');

        if (userEl) userEl.textContent = userMqttCreds.user || '---';
        if (passEl) {
            passEl.textContent = userMqttCreds.masked ? '••••••••' : (userMqttCreds.pass || '---');
        }
        if (toggleBtn) toggleBtn.textContent = userMqttCreds.masked ? 'Show' : 'Hide';
    }

    async function handleRegenMqttCredentials() {
        if (!confirm('Regenerate your device MQTT password secret? You will need to update the password on your physical ESP32-C3 device.')) return;
        try {
            // Cookie sent automatically
            const res = await fetch('/api/user/mqtt-credentials', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ regenerate: true })
            });
            if (res.ok) {
                const data = await res.json();
                userMqttCreds.user = data.mqtt_user;
                userMqttCreds.pass = data.mqtt_pass;
                userMqttCreds.masked = false;
                renderUserMqttCredentials();
            }
        } catch (e) {}
    }

    // -------------------------------------------------------------------
    // 5. MQTT WEBSOCKET CONNECTION
    // -------------------------------------------------------------------
    function connectMQTT(serial) {
        disconnectMQTT();
        if (!serial) return;

        const targetSerial = serial.toLowerCase();
        const isHttps = window.location.protocol === 'https:';
        const wsProtocol = isHttps ? 'wss' : 'ws';

        // SECURITY FIX #9: Token no longer passed as URL query param (leaks to server logs).
        // The browser sends the HttpOnly cookie automatically with the WebSocket upgrade request.
        const wsUrl = `${wsProtocol}://${window.location.host}/mqtt`;

        setStatus('connecting', `Connecting WebSocket...`);

        try {
            const ws = new WebSocket(wsUrl);
            ws.onopen = () => {
                if (!currentSerial || currentSerial.toLowerCase() !== targetSerial) {
                    return;
                }
                console.log(`[WebSocket] Connected to ${wsUrl} for device ${targetSerial}`);
                setStatus('online', 'Connected Live');
            };

            ws.onmessage = (event) => {
                try {
                    // Strictly enforce that this WebSocket packet matches the active device
                    if (!currentSerial || currentSerial.toLowerCase() !== targetSerial) {
                        return;
                    }
                    const msg = JSON.parse(event.data);
                    if (msg.topic && msg.payload) {
                        const parts = msg.topic.toLowerCase().split('/');
                        // MQTT topic format: cu100/<device_id>/state or cu100/<device_id>/...
                        const topicSerial = parts.length >= 2 ? parts[1] : '';
                        if (topicSerial === currentSerial.toLowerCase()) {
                            lastTelemetryTime = Date.now();
                            const payloadObj = JSON.parse(msg.payload);
                            updateTelemetryUI(payloadObj);
                            setDeviceOnlineStatus(true, 'Active (Just now)');
                        }
                    }
                } catch (e) { }
            };

            ws.onclose = () => {
                if (currentSerial && currentSerial.toLowerCase() === targetSerial) {
                    setStatus('connecting', 'Disconnected');
                    setDeviceOnlineStatus(false, 'Waiting for telemetry...');
                }
            };

            ws.onerror = (err) => {
                console.error('[WebSocket Error]:', err);
                if (currentSerial && currentSerial.toLowerCase() === targetSerial) {
                    setStatus('connecting', 'WebSocket Error');
                }
            };

            mqttClient = ws;
        } catch (err) {
            console.error('[MQTT Bridge Connect Error]:', err);
        }
    }

    // -------------------------------------------------------------------
    // 6. TELEMETRY & CHART UPDATERS
    // -------------------------------------------------------------------
    function updateTelemetryUI(data) {
        if (!data || typeof data !== 'object') return;
        lastTelemetryData = data;

        const hasPowerData = data.power_ch1 !== undefined || data.current_ch1 !== undefined || data.watts !== undefined || data.currents !== undefined;
        if (!hasPowerData) {
            if (data.temperature !== undefined) {
                let tempC = data.temperature;
                let tempF = (tempC * 9 / 5) + 32;
                updateElement('temp-summary-val', Number(tempC).toFixed(1));
                updateElement('temp-summary-f-val', Number(tempF).toFixed(1));
            }
            return;
        }

        const voltage = (currentDeviceObj && currentDeviceObj.voltage != null) ? Number(currentDeviceObj.voltage) : (Number(data.voltage) || 220.0);

        let ch1_a = data.current_ch1 !== undefined ? Number(data.current_ch1) : (data.currents ? Number(data.currents[0]) : 0);
        let ch2_a = data.current_ch2 !== undefined ? Number(data.current_ch2) : (data.currents ? Number(data.currents[1]) : 0);
        let ch3_a = data.current_ch3 !== undefined ? Number(data.current_ch3) : (data.currents ? Number(data.currents[2]) : 0);
        let ch4_a = data.current_ch4 !== undefined ? Number(data.current_ch4) : (data.currents ? Number(data.currents[3]) : 0);

        // Cloud-calculated power in Watts (P = V * I)
        let ch1_w = data.power_ch1 !== undefined ? data.power_ch1 : Math.round(ch1_a * voltage);
        let ch2_w = data.power_ch2 !== undefined ? data.power_ch2 : Math.round(ch2_a * voltage);
        let ch3_w = data.power_ch3 !== undefined ? data.power_ch3 : Math.round(ch3_a * voltage);
        let ch4_w = data.power_ch4 !== undefined ? data.power_ch4 : Math.round(ch4_a * voltage);

        // Cloud-calculated monthly energy (firmware kwh_ch1..4 array is ignored)
        let ch1_kwh = Number(data.kwh_ch1) || 0;
        let ch2_kwh = Number(data.kwh_ch2) || 0;
        let ch3_kwh = Number(data.kwh_ch3) || 0;
        let ch4_kwh = Number(data.kwh_ch4) || 0;

        let tempC = data.temperature || 0;
        let tempF = (tempC * 9 / 5) + 32;

        updateElement('ch1-w', Math.round(ch1_w));
        updateElement('ch1-val', Number(ch1_a).toFixed(2));
        updateElement('ch1-kwh', Number(ch1_kwh).toFixed(3));
        setGauge('ch1-gauge', ch1_a, 30.0);

        updateElement('ch2-w', Math.round(ch2_w));
        updateElement('ch2-val', Number(ch2_a).toFixed(2));
        updateElement('ch2-kwh', Number(ch2_kwh).toFixed(3));
        setGauge('ch2-gauge', ch2_a, 30.0);

        updateElement('ch3-w', Math.round(ch3_w));
        updateElement('ch3-val', Number(ch3_a).toFixed(2));
        updateElement('ch3-kwh', Number(ch3_kwh).toFixed(3));
        setGauge('ch3-gauge', ch3_a, 30.0);

        updateElement('ch4-w', Math.round(ch4_w));
        updateElement('ch4-val', Number(ch4_a).toFixed(2));
        updateElement('ch4-kwh', Number(ch4_kwh).toFixed(3));
        setGauge('ch4-gauge', ch4_a, 30.0);

        // Electricity Rate & Cost Calculations for each Channel
        const rate = (currentDeviceObj && currentDeviceObj.electricity_rate != null) ? Number(currentDeviceObj.electricity_rate) : 0.00;
        const currency = (currentDeviceObj && currentDeviceObj.currency) || 'IDR';
        const rateDisplay = formatRate(rate, currency);

        const ch1_cost = Number(ch1_kwh) * rate;
        const ch2_cost = Number(ch2_kwh) * rate;
        const ch3_cost = Number(ch3_kwh) * rate;
        const ch4_cost = Number(ch4_kwh) * rate;
        const total_cost = (Number(ch1_kwh) + Number(ch2_kwh) + Number(ch3_kwh) + Number(ch4_kwh)) * rate;

        updateElement('ch1-cost', formatCurrency(ch1_cost, currency));
        updateElement('ch2-cost', formatCurrency(ch2_cost, currency));
        updateElement('ch3-cost', formatCurrency(ch3_cost, currency));
        updateElement('ch4-cost', formatCurrency(ch4_cost, currency));

        updateElement('total-cost-val', formatCurrency(total_cost, currency));
        if (rateSummarySub) rateSummarySub.textContent = `Rate: ${rateDisplay} / kWh · Line: ${voltage.toFixed(1)}V`;
        if (summaryVoltageTag) summaryVoltageTag.textContent = `${voltage.toFixed(1)}V`;

        updateElement('temp-summary-val', Number(tempC).toFixed(1));
        updateElement('temp-summary-f-val', Number(tempF).toFixed(1));

        const totalW = Math.round(ch1_w + ch2_w + ch3_w + ch4_w);
        const totalKwh = (Number(ch1_kwh) + Number(ch2_kwh) + Number(ch3_kwh) + Number(ch4_kwh)).toFixed(3);
        updateElement('total-power-val', totalW);
        updateElement('total-kwh-val', totalKwh);

        // Live update monthly chips and current month table row
        updateElement('chip-curr-kwh', `${totalKwh} kWh`);
        updateElement('chip-curr-cost', formatCurrency(total_cost, currency));
        updateElement('chip-curr-voltage', `${voltage.toFixed(1)} V`);
        updateElement('chip-curr-rate', `${rateDisplay} / kWh`);
        updateLiveMonthlyRow(totalKwh, total_cost, ch1_kwh, ch2_kwh, ch3_kwh, ch4_kwh, currency);

        // Only append live ticks if in Real-Time mode
        if (currentViewMode === 'realtime') {
            pushChartData(ch1_w, ch2_w, ch3_w, ch4_w);
        }
    }

    // -------------------------------------------------------------------
    // 6.1 MONTHLY ENERGY & BILLING HISTORY
    // -------------------------------------------------------------------
    async function loadMonthlyEnergyHistory(serial) {
        if (!serial) return;
        const targetSerial = serial.toLowerCase();
        const tbody = document.getElementById('monthly-history-tbody');
        if (!tbody) return;

        try {
            const res = await fetch(`/api/devices/${encodeURIComponent(serial)}/monthly-energy`);
            // Guard against stale response if device changed while fetching
            if (!currentSerial || currentSerial.toLowerCase() !== targetSerial) return;

            if (!res.ok) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Could not load monthly energy history.</td></tr>';
                return;
            }

            const data = await res.json();
            const currency = data.currency || 'IDR';
            const rate = data.electricity_rate || 0.0;
            const voltage = data.voltage || 220.0;

            if (data.current_month) {
                updateElement('chip-curr-month', data.current_month.month_name || '--');
                updateElement('chip-curr-kwh', `${Number(data.current_month.kwh_total).toFixed(3)} kWh`);
                updateElement('chip-curr-cost', formatCurrency(data.current_month.cost_total, currency));

                // Always populate the top summary card with current month energy & cost,
                // ensuring it displays properly even when the device is disconnected or offline.
                const totalKwh = Number(data.current_month.kwh_total || 0).toFixed(3);
                const totalCost = Number(data.current_month.cost_total || 0);
                updateElement('total-kwh-val', totalKwh);
                updateElement('total-cost-val', formatCurrency(totalCost, currency));

                // If no live telemetry packet is currently active, populate channel cards with month accumulated kWh & cost
                if (!lastTelemetryData) {
                    for (let ch = 1; ch <= 4; ch++) {
                        const chKwh = Number(data.current_month[`kwh_ch${ch}`] || 0);
                        updateElement(`ch${ch}-kwh`, chKwh.toFixed(3));
                        updateElement(`ch${ch}-cost`, formatCurrency(chKwh * rate, currency));
                    }
                }
            } else {
                updateElement('chip-curr-month', '--');
                updateElement('chip-curr-kwh', '0.000 kWh');
                updateElement('chip-curr-cost', formatCurrency(0, currency));
            }
            const rateDisplay = formatRate(rate, currency);
            if (rateSummarySub) rateSummarySub.textContent = `Rate: ${rateDisplay} / kWh · Line: ${Number(voltage).toFixed(1)}V`;
            if (summaryVoltageTag) summaryVoltageTag.textContent = `${Number(voltage).toFixed(1)}V`;

            cachedMonthlyHistory = data.history || [];
            cachedMonthlyCurrency = currency;

            renderFilteredMonthlyView();
        } catch (err) {
            console.error('[Load Monthly Energy Error]:', err);
            if (currentSerial && currentSerial.toLowerCase() === targetSerial) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#f43f5e; padding:1.5rem;">Error loading monthly energy history.</td></tr>';
            }
        }
    }

    function renderFilteredMonthlyView() {
        const tbody = document.getElementById('monthly-history-tbody');
        if (!tbody) return;

        const range = monthlyRangeSelect ? monthlyRangeSelect.value : '12m';
        let limit = 12;
        if (range === '6m') limit = 6;
        else if (range === '12m') limit = 12;
        else if (range === '24m') limit = 24;
        else if (range === 'all') limit = Infinity;

        const displayedHistory = isFinite(limit)
            ? cachedMonthlyHistory.slice(0, limit)
            : cachedMonthlyHistory;

        if (displayedHistory.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:1.5rem;">No historical monthly data recorded yet.</td></tr>';
        } else {
            tbody.innerHTML = '';
            displayedHistory.forEach(m => {
                const tr = document.createElement('tr');
                if (m.status === 'in_progress') tr.id = 'current-month-row';
                const statusBadge = m.status === 'in_progress'
                    ? '<span class="badge-status-in-progress">In Progress</span>'
                    : '<span class="badge-status-completed">Closed</span>';

                tr.innerHTML = `
                    <td><strong>${escapeHtml(m.month_name)}</strong></td>
                    <td>${statusBadge}</td>
                    <td class="ch1-val-cell">${Number(m.kwh_ch1).toFixed(3)}</td>
                    <td class="ch2-val-cell">${Number(m.kwh_ch2).toFixed(3)}</td>
                    <td class="ch3-val-cell">${Number(m.kwh_ch3).toFixed(3)}</td>
                    <td class="ch4-val-cell">${Number(m.kwh_ch4).toFixed(3)}</td>
                    <td><strong style="color: #38bdf8;">${Number(m.kwh_total).toFixed(3)} kWh</strong></td>
                    <td><strong class="cost-highlight" style="color: #34d399;">${formatCurrency(m.cost_total, m.currency || cachedMonthlyCurrency)}</strong></td>
                `;
                tbody.appendChild(tr);
            });
        }

        renderMonthlyChart(displayedHistory);
    }

    function updateLiveMonthlyRow(totalKwh, totalCost, ch1, ch2, ch3, ch4, currency) {
        const row = document.getElementById('current-month-row');
        if (!row) return;
        const cells = row.querySelectorAll('td');
        if (cells.length >= 8) {
            cells[2].textContent = Number(ch1).toFixed(3);
            cells[3].textContent = Number(ch2).toFixed(3);
            cells[4].textContent = Number(ch3).toFixed(3);
            cells[5].textContent = Number(ch4).toFixed(3);
            cells[6].innerHTML = `<strong style="color: #38bdf8;">${Number(totalKwh).toFixed(3)} kWh</strong>`;
            cells[7].innerHTML = `<strong class="cost-highlight" style="color: #34d399;">${formatCurrency(totalCost, currency)}</strong>`;
        }
    }

    function renderMonthlyChart(history = []) {
        const canvas = document.getElementById('monthlyChart');
        if (!canvas) return;

        const chronological = [...history].reverse();
        const labels = chronological.map(m => m.month_name);
        const ch1Data = chronological.map(m => Number((m.kwh_ch1 || 0).toFixed(3)));
        const ch2Data = chronological.map(m => Number((m.kwh_ch2 || 0).toFixed(3)));
        const ch3Data = chronological.map(m => Number((m.kwh_ch3 || 0).toFixed(3)));
        const ch4Data = chronological.map(m => Number((m.kwh_ch4 || 0).toFixed(3)));

        if (monthlyChart) {
            monthlyChart.data.labels = labels;
            monthlyChart.data.datasets[0].data = ch1Data;
            monthlyChart.data.datasets[1].data = ch2Data;
            monthlyChart.data.datasets[2].data = ch3Data;
            monthlyChart.data.datasets[3].data = ch4Data;
            monthlyChart.update();
            return;
        }

        const ctx = canvas.getContext('2d');
        const l1 = (currentDeviceObj && currentDeviceObj.ch1_label) ? `${currentDeviceObj.ch1_label} (CT1)` : 'Ch 1 (CT1)';
        const l2 = (currentDeviceObj && currentDeviceObj.ch2_label) ? `${currentDeviceObj.ch2_label} (CT2)` : 'Ch 2 (CT2)';
        const l3 = (currentDeviceObj && currentDeviceObj.ch3_label) ? `${currentDeviceObj.ch3_label} (CT3)` : 'Ch 3 (CT3)';
        const l4 = (currentDeviceObj && currentDeviceObj.ch4_label) ? `${currentDeviceObj.ch4_label} (CT4)` : 'Ch 4 (CT4)';

        const themeColors = getChartThemeColors();
        monthlyChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: l1, data: ch1Data, backgroundColor: '#06b6d4', borderRadius: 4 },
                    { label: l2, data: ch2Data, backgroundColor: '#10b981', borderRadius: 4 },
                    { label: l3, data: ch3Data, backgroundColor: '#8b5cf6', borderRadius: 4 },
                    { label: l4, data: ch4Data, backgroundColor: '#f59e0b', borderRadius: 4 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        stacked: true,
                        grid: { color: themeColors.grid },
                        ticks: { color: themeColors.ticks, font: { family: 'Outfit', size: 11 } }
                    },
                    y: {
                        stacked: true,
                        grid: { color: themeColors.grid },
                        ticks: {
                            color: themeColors.ticks,
                            font: { family: 'Outfit', size: 11 },
                            callback: v => v + ' kWh'
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: themeColors.text, font: { family: 'Outfit', size: 12 }, usePointStyle: true, boxWidth: 8 }
                    },
                    tooltip: {
                        backgroundColor: themeColors.tooltipBg,
                        titleColor: themeColors.tooltipTitle,
                        bodyColor: themeColors.tooltipBody,
                        borderColor: themeColors.tooltipBorder,
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: ctx => ` ${ctx.dataset.label}: ${ctx.raw.toFixed(3)} kWh`,
                            footer: items => {
                                const total = items.reduce((sum, item) => sum + item.raw, 0);
                                return `Total: ${total.toFixed(3)} kWh`;
                            }
                        }
                    }
                }
            }
        });
    }

    function formatCurrency(amount, currency = 'IDR') {
        const num = Number(amount) || 0;
        if (currency === 'USD') {
            return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        return 'Rp ' + num.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatRate(rate, currency = 'IDR') {
        const num = Number(rate) || 0;
        if (currency === 'USD') {
            return '$' + num.toFixed(2);
        }
        return 'Rp ' + num.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function updateElement(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function setGauge(id, val, maxVal) {
        const el = document.getElementById(id);
        if (el) {
            const pct = Math.min(100, Math.max(0, (val / maxVal) * 100));
            el.style.width = pct + '%';
        }
    }

    function applyChannelLabels(device) {
        const ch1 = (device && device.ch1_label) ? device.ch1_label : 'Channel 1';
        const ch2 = (device && device.ch2_label) ? device.ch2_label : 'Channel 2';
        const ch3 = (device && device.ch3_label) ? device.ch3_label : 'Channel 3';
        const ch4 = (device && device.ch4_label) ? device.ch4_label : 'Channel 4';

        // Sensor card header titles
        updateElement('ch1-name-display', ch1);
        updateElement('ch2-name-display', ch2);
        updateElement('ch3-name-display', ch3);
        updateElement('ch4-name-display', ch4);

        // Monthly history table headers
        updateElement('th-ch1-label', `${ch1} (kWh)`);
        updateElement('th-ch2-label', `${ch2} (kWh)`);
        updateElement('th-ch3-label', `${ch3} (kWh)`);
        updateElement('th-ch4-label', `${ch4} (kWh)`);

        // Real-time power chart dataset labels
        if (powerChart && powerChart.data && powerChart.data.datasets && powerChart.data.datasets.length >= 4) {
            powerChart.data.datasets[0].label = `${ch1} (W)`;
            powerChart.data.datasets[1].label = `${ch2} (W)`;
            powerChart.data.datasets[2].label = `${ch3} (W)`;
            powerChart.data.datasets[3].label = `${ch4} (W)`;
            powerChart.update('none');
        }

        // Monthly chart dataset labels
        if (monthlyChart && monthlyChart.data && monthlyChart.data.datasets && monthlyChart.data.datasets.length >= 4) {
            monthlyChart.data.datasets[0].label = `${ch1} (CT1)`;
            monthlyChart.data.datasets[1].label = `${ch2} (CT2)`;
            monthlyChart.data.datasets[2].label = `${ch3} (CT3)`;
            monthlyChart.data.datasets[3].label = `${ch4} (CT4)`;
            monthlyChart.update('none');
        }
    }

    function getChartThemeColors() {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        return {
            grid: isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.04)',
            ticks: isLight ? '#64748b' : '#9ca3af',
            text: isLight ? '#0f172a' : '#f9fafb',
            tooltipBg: isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(15, 23, 42, 0.95)',
            tooltipBorder: isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.1)',
            tooltipTitle: isLight ? '#0f172a' : '#f9fafb',
            tooltipBody: isLight ? '#475569' : '#cbd5e1'
        };
    }

    function updateChartsTheme(theme) {
        const colors = getChartThemeColors();

        if (powerChart && powerChart.options && powerChart.options.scales) {
            if (powerChart.options.scales.x) {
                powerChart.options.scales.x.grid.color = colors.grid;
                powerChart.options.scales.x.ticks.color = colors.ticks;
            }
            if (powerChart.options.scales.y) {
                powerChart.options.scales.y.grid.color = colors.grid;
                powerChart.options.scales.y.ticks.color = colors.ticks;
            }
            powerChart.update('none');
        }

        if (monthlyChart && monthlyChart.options && monthlyChart.options.scales) {
            if (monthlyChart.options.scales.x) {
                monthlyChart.options.scales.x.grid.color = colors.grid;
                monthlyChart.options.scales.x.ticks.color = colors.ticks;
            }
            if (monthlyChart.options.scales.y) {
                monthlyChart.options.scales.y.grid.color = colors.grid;
                monthlyChart.options.scales.y.ticks.color = colors.ticks;
            }
            if (monthlyChart.options.plugins && monthlyChart.options.plugins.legend && monthlyChart.options.plugins.legend.labels) {
                monthlyChart.options.plugins.legend.labels.color = colors.text;
            }
            if (monthlyChart.options.plugins && monthlyChart.options.plugins.tooltip) {
                monthlyChart.options.plugins.tooltip.backgroundColor = colors.tooltipBg;
                monthlyChart.options.plugins.tooltip.borderColor = colors.tooltipBorder;
                monthlyChart.options.plugins.tooltip.titleColor = colors.tooltipTitle;
                monthlyChart.options.plugins.tooltip.bodyColor = colors.tooltipBody;
            }
            monthlyChart.update('none');
        }
    }

    function initChart() {
        const ctx = document.getElementById('powerChart').getContext('2d');
        const l1 = (currentDeviceObj && currentDeviceObj.ch1_label) ? `${currentDeviceObj.ch1_label} (W)` : 'Ch 1 (W)';
        const l2 = (currentDeviceObj && currentDeviceObj.ch2_label) ? `${currentDeviceObj.ch2_label} (W)` : 'Ch 2 (W)';
        const l3 = (currentDeviceObj && currentDeviceObj.ch3_label) ? `${currentDeviceObj.ch3_label} (W)` : 'Ch 3 (W)';
        const l4 = (currentDeviceObj && currentDeviceObj.ch4_label) ? `${currentDeviceObj.ch4_label} (W)` : 'Ch 4 (W)';

        const themeColors = getChartThemeColors();
        powerChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartData.labels,
                datasets: [
                    { label: l1, data: chartData.ch1, borderColor: '#06b6d4', borderWidth: 2, tension: 0.35, pointRadius: 2 },
                    { label: l2, data: chartData.ch2, borderColor: '#10b981', borderWidth: 2, tension: 0.35, pointRadius: 2 },
                    { label: l3, data: chartData.ch3, borderColor: '#8b5cf6', borderWidth: 2, tension: 0.35, pointRadius: 2 },
                    { label: l4, data: chartData.ch4, borderColor: '#f59e0b', borderWidth: 2, tension: 0.35, pointRadius: 2 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 400 },
                scales: {
                    x: { grid: { color: themeColors.grid }, ticks: { color: themeColors.ticks } },
                    y: { beginAtZero: true, grid: { color: themeColors.grid }, ticks: { color: themeColors.ticks } }
                }
            }
        });
    }

    function pushChartData(w1, w2, w3, w4) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        chartData.labels.push(timeStr);
        chartData.ch1.push(Math.round(w1));
        chartData.ch2.push(Math.round(w2));
        chartData.ch3.push(Math.round(w3));
        chartData.ch4.push(Math.round(w4));

        if (chartData.labels.length > MAX_CHART_POINTS) {
            chartData.labels.shift();
            chartData.ch1.shift();
            chartData.ch2.shift();
            chartData.ch3.shift();
            chartData.ch4.shift();
        }

        powerChart.update('none');
    }

    function resetChart() {
        chartData.labels.length = 0;
        chartData.ch1.length = 0;
        chartData.ch2.length = 0;
        chartData.ch3.length = 0;
        chartData.ch4.length = 0;
        if (powerChart) powerChart.update('none');
    }

    // -------------------------------------------------------------------
    // 7. REAL-TIME VS HISTORICAL DUCKDB VIEW SWITCHING
    // -------------------------------------------------------------------
    function setChartMode(mode) {
        currentViewMode = mode;
        if (mode === 'realtime') {
            if (btnModeRealtime) btnModeRealtime.classList.add('active');
            if (btnModeHistorical) btnModeHistorical.classList.remove('active');
            if (historicalControlsBar) historicalControlsBar.style.display = 'none';
            if (chartMainHeading) chartMainHeading.textContent = '⚡ Real-Time Power Load';
            if (chartSubHeading) chartSubHeading.textContent = 'Live active load (Watts) per channel';
            hideChartOverlay();
            resetChart();
        } else {
            if (btnModeRealtime) btnModeRealtime.classList.remove('active');
            if (btnModeHistorical) btnModeHistorical.classList.add('active');
            if (historicalControlsBar) historicalControlsBar.style.display = 'flex';
            if (chartMainHeading) chartMainHeading.textContent = '📊 Historical Power Load Analytics';
            if (chartSubHeading) chartSubHeading.textContent = 'Aggregated metric trends';
            fetchHistoricalData();
        }
    }

    async function fetchHistoricalData(customStart = null, customEnd = null) {
        if (!currentSerial) {
            showChartOverlay('🔍', 'Please select or enter a Device ID to view historical telemetry.');
            return;
        }

        const range = historyRangeSelect ? historyRangeSelect.value : '24h';
        const resolution = historyResSelect ? historyResSelect.value : '5m';
        const agg = historyAggSelect ? historyAggSelect.value : 'max';

        if (chartSubHeading) {
            chartSubHeading.textContent = (agg === 'max')
                ? 'Aggregated peak load spikes (MAX) • Loading...'
                : 'Aggregated average metric trends (AVG) • Loading...';
        }

        let end = (customEnd && !isNaN(Number(customEnd))) ? Number(customEnd) : Date.now();
        let start = (customStart && !isNaN(Number(customStart))) ? Number(customStart) : null;

        if (!start) {
            if (range === '1h') start = end - (60 * 60 * 1000);
            else if (range === '24h') start = end - (24 * 60 * 60 * 1000);
            else if (range === '7d') start = end - (7 * 24 * 60 * 60 * 1000);
            else if (range === '30d') start = end - (30 * 24 * 60 * 60 * 1000);
            else if (range === 'all') start = end - (365 * 24 * 60 * 60 * 1000);
            else start = end - (24 * 60 * 60 * 1000);
        }

        if (start > end) {
            const t = start;
            start = end;
            end = t;
        }

        const reqSerial = currentSerial.toLowerCase();
        showChartOverlay('⏳', 'Loading historical analytics from DuckDB...');

        try {
            // Cookie sent automatically
            const url = `/api/telemetry/history?device_id=${encodeURIComponent(currentSerial)}&start=${start}&end=${end}&resolution=${resolution}&agg=${agg}`;
            const res = await fetch(url);
            const result = await res.json();

            // Guard against stale asynchronous DuckDB responses if user changed devices
            if (!currentSerial || currentSerial.toLowerCase() !== reqSerial) return;

            if (!res.ok) {
                console.error('[History Fetch Error]:', result.error);
                if (res.status === 403) {
                    showChartOverlay('🔒', 'Access restricted: Please log in with an authorized account to view telemetry history for this private device.');
                } else {
                    showChartOverlay('⚠️', `Failed to load telemetry history: ${result.error || 'Server error'}`);
                }
                if (chartSubHeading) chartSubHeading.textContent = 'Failed to load historical data';
                return;
            }

            resetChart();

            const records = result.data || [];

            if (records.length === 0) {
                if (chartSubHeading) {
                    chartSubHeading.textContent = 'No records in selected time range';
                }
                if (result.bounds && result.bounds.total_records > 0 && result.bounds.latest) {
                    const latestDate = new Date(result.bounds.latest);
                    if (!isNaN(latestDate.getTime())) {
                        const latestStr = latestDate.toLocaleString();
                        const latestMs = latestDate.getTime();
                        showChartOverlay(
                            'ℹ️',
                            `No telemetry found in the selected range.<br><span style="color: #cbd5e1;">Latest data for <strong>${currentSerial.toUpperCase()}</strong> was recorded on:</span><br><strong>${latestStr}</strong> (${Number(result.bounds.total_records).toLocaleString()} total points stored)`,
                            '📅 View Latest Telemetry Window',
                            () => {
                                // Load 24-hour window around the latest recorded data
                                const winEnd = latestMs + (10 * 60 * 1000);
                                const winStart = Math.max(0, latestMs - (24 * 60 * 60 * 1000));
                                if (historyRangeSelect) historyRangeSelect.value = 'all';
                                if (historyResSelect) historyResSelect.value = '5m';
                                fetchHistoricalData(winStart, winEnd);
                            }
                        );
                    } else {
                        showChartOverlay('📭', `No historical telemetry has been recorded yet for device <strong>${currentSerial.toUpperCase()}</strong>.<br><span style="color: #94a3b8; font-size: 0.8rem;">Ensure the physical device is transmitting telemetry packets to the MQTT broker.</span>`);
                    }
                } else {
                    showChartOverlay('📭', `No historical telemetry has been recorded yet for device <strong>${currentSerial.toUpperCase()}</strong>.<br><span style="color: #94a3b8; font-size: 0.8rem;">Ensure the physical device is transmitting telemetry packets to the MQTT broker.</span>`);
                }
                return;
            }

            hideChartOverlay();

            if (chartSubHeading) {
                chartSubHeading.textContent = (agg === 'max')
                    ? `Aggregated peak spikes (MAX) • ${records.length} points plotted`
                    : `Aggregated average trends (AVG) • ${records.length} points plotted`;
            }

            records.forEach(row => {
                const ts = row.bucket_time || row.timestamp;
                const dt = new Date(ts);
                const timeLabel = (range === '7d' || range === '30d' || range === 'all' || resolution === '1d' || (customStart && (end - start > 48 * 3600 * 1000)))
                    ? dt.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                // Calculate exact Channel Wattage from stored i_rms and v_rms metrics
                const v_nominal = (typeof row.v_rms === 'number' && row.v_rms > 0) ? row.v_rms : 220;
                let ch1_w = (typeof row.i_rms1 === 'number' && row.i_rms1 > 0) ? (row.i_rms1 * v_nominal) : 0;
                let ch2_w = (typeof row.i_rms2 === 'number' && row.i_rms2 > 0) ? (row.i_rms2 * v_nominal) : 0;
                let ch3_w = (typeof row.i_rms3 === 'number' && row.i_rms3 > 0) ? (row.i_rms3 * v_nominal) : 0;
                let ch4_w = (typeof row.i_rms4 === 'number' && row.i_rms4 > 0) ? (row.i_rms4 * v_nominal) : 0;

                // Fallback to active power on Channel 1 if individual currents were zero or unmeasured
                if (ch1_w === 0 && ch2_w === 0 && ch3_w === 0 && ch4_w === 0 && typeof row.p_active === 'number' && row.p_active > 0) {
                    ch1_w = row.p_active;
                }

                chartData.labels.push(timeLabel);
                chartData.ch1.push(Math.round(ch1_w));
                chartData.ch2.push(Math.round(ch2_w));
                chartData.ch3.push(Math.round(ch3_w));
                chartData.ch4.push(Math.round(ch4_w));
            });

            powerChart.update();
        } catch (err) {
            console.error('[Fetch Historical Data Failed]:', err);
            showChartOverlay('⚠️', 'Connection error while fetching historical analytics.');
            if (chartSubHeading) chartSubHeading.textContent = 'Connection error';
        }
    }

    // UTILITIES
    function getQueryParam(name) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(name) || urlParams.get('device') || urlParams.get('serial') || urlParams.get('sn') || urlParams.get('id');
    }

    function sanitizeSerial(raw) {
        if (!raw) return '';
        let cleaned = raw.trim().toLowerCase();
        if (cleaned.startsWith('cu100_')) cleaned = cleaned.substring(6);
        return cleaned.replace(/[^a-f0-9]/g, '');
    }

    function updateUrlSerial(serial) {
        const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?device=' + serial;
        window.history.pushState({ path: newUrl }, '', newUrl);
    }

    function setStatus(state, message) {
        statusDot.className = 'pulse-dot ' + state;
        statusText.textContent = message;
    }

    function setDeviceOnlineStatus(isOnline, detailText) {
        if (deviceStatusTag) {
            deviceStatusTag.className = 'device-status-tag ' + (isOnline ? 'online' : 'offline');
            deviceStatusTag.textContent = isOnline ? 'ONLINE' : 'OFFLINE';
        }
        if (deviceLastSeen && detailText) {
            deviceLastSeen.textContent = detailText;
        }
    }

    function startInactivityCheck() {
        if (inactivityTimer) clearInterval(inactivityTimer);
        inactivityTimer = setInterval(() => {
            if (!lastTelemetryTime) {
                setDeviceOnlineStatus(false, 'Waiting for telemetry...');
                return;
            }
            const elapsedSec = Math.floor((Date.now() - lastTelemetryTime) / 1000);
            if (elapsedSec > 15) {
                setDeviceOnlineStatus(false, `Last seen ${elapsedSec}s ago`);
            } else {
                const timeAgoStr = elapsedSec <= 1 ? 'Just now' : `${elapsedSec}s ago`;
                setDeviceOnlineStatus(true, `Active (${timeAgoStr})`);
            }
        }, 2000);
    }

    function showModal(modal) {
        if (modal) {
            modal.classList.add('active');
            if (modal === authModal && recaptchaSiteKey) {
                loadRecaptchaScript(() => {
                    if (forgotPasswordForm && forgotPasswordForm.style.display !== 'none') {
                        renderUserForgotRecaptcha();
                    } else {
                        renderUserRecaptcha();
                    }
                });
            }
        }
    }

    function hideModal(modal) {
        if (modal) {
            modal.classList.remove('active');
            if (modal === authModal) {
                showLoginForm();
            }
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    document.addEventListener('DOMContentLoaded', init);
})();
