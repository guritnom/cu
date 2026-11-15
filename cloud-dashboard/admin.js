// CU100 Admin Back-Office Logic
(function () {
    // SECURITY FIX #7: No token stored in localStorage or any JS variable.
    // Authentication is handled entirely by HttpOnly cookies set by the server.
    // All fetch() calls to same-origin endpoints automatically include the cookie.
    let currentAdmin = JSON.parse(localStorage.getItem('cu100_admin_info') || 'null');

    let allUsersList = [];

    // DOM Elements
    const adminLoginWrapper = document.getElementById('admin-login-wrapper');
    const adminWorkspace = document.getElementById('admin-workspace');
    const adminUserBadge = document.getElementById('admin-user-badge');
    const adminNameDisplay = document.getElementById('admin-name-display');

    const adminLoginForm = document.getElementById('admin-login-form');
    const adminLoginError = document.getElementById('admin-login-error');
    const btnAdminLogout = document.getElementById('btn-admin-logout');
    const adminRecaptchaContainer = document.getElementById('admin-recaptcha-container');

    const adminAuthTitle = document.getElementById('admin-auth-title');
    const adminAuthSubtitle = document.getElementById('admin-auth-subtitle');
    const linkAdminForgotPassword = document.getElementById('link-admin-forgot-password');
    const linkAdminBackToLogin = document.getElementById('link-admin-back-to-login');
    const adminForgotForm = document.getElementById('admin-forgot-form');
    const adminForgotError = document.getElementById('admin-forgot-error');
    const adminForgotSuccess = document.getElementById('admin-forgot-success');
    const adminForgotIdentifier = document.getElementById('admin-forgot-identifier');
    const btnAdminForgotSubmit = document.getElementById('btn-admin-forgot-submit');
    const adminForgotRecaptchaContainer = document.getElementById('admin-forgot-recaptcha-container');

    // reCAPTCHA State
    let adminRecaptchaWidgetId = null;
    let adminForgotRecaptchaWidgetId = null;
    let recaptchaSiteKey = null;

    const statTotalUsers = document.getElementById('stat-total-users');
    const statTotalDevices = document.getElementById('stat-total-devices');
    const statPublicDevices = document.getElementById('stat-public-devices');
    const statPrivateDevices = document.getElementById('stat-private-devices');

    const adminUsersTbody = document.getElementById('admin-users-tbody');
    const adminDevicesTbody = document.getElementById('admin-devices-tbody');

    const btnAdminAddUser = document.getElementById('btn-admin-add-user');
    const adminUserModal = document.getElementById('admin-user-modal');
    const adminUserForm = document.getElementById('admin-user-form');
    const userModalTitle = document.getElementById('user-modal-title');
    const userEditId = document.getElementById('user-edit-id');
    const userInputUsername = document.getElementById('user-input-username');
    const userInputEmail = document.getElementById('user-input-email');
    const userInputPassword = document.getElementById('user-input-password');
    const userInputRole = document.getElementById('user-input-role');
    const userInputRetention = document.getElementById('user-input-retention');
    const userInputMqttUser = document.getElementById('user-input-mqtt-user');
    const userInputMqttPass = document.getElementById('user-input-mqtt-pass');
    const adminUserError = document.getElementById('admin-user-error');
    const btnCloseUserModal = document.getElementById('btn-close-user-modal');

    const adminDeviceModal = document.getElementById('admin-device-modal');
    const adminDeviceForm = document.getElementById('admin-device-form');
    const deviceEditId = document.getElementById('device-edit-id');
    const deviceInputName = document.getElementById('device-input-name');
    const deviceInputLocation = document.getElementById('device-input-location');
    const deviceInputVoltage = document.getElementById('device-input-voltage');
    const deviceInputRate = document.getElementById('device-input-rate');
    const deviceInputCurrency = document.getElementById('device-input-currency');
    const deviceInputVisibility = document.getElementById('device-input-visibility');
    const deviceInputOwner = document.getElementById('device-input-owner');
    const deviceInputCh1Label = document.getElementById('device-input-ch1-label');
    const deviceInputCh2Label = document.getElementById('device-input-ch2-label');
    const deviceInputCh3Label = document.getElementById('device-input-ch3-label');
    const deviceInputCh4Label = document.getElementById('device-input-ch4-label');
    const adminDeviceError = document.getElementById('admin-device-error');
    const btnCloseDeviceModal = document.getElementById('btn-close-device-modal');

    // QR Code & Label Elements
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
    const btnAdminBatchLabels = document.getElementById('btn-admin-batch-labels');
    const btnCloseBatchModal = document.getElementById('btn-close-batch-modal');
    const btnDismissBatchModal = document.getElementById('btn-dismiss-batch-modal');
    const btnPrintBatchSheet = document.getElementById('btn-print-batch-sheet');
    const batchLabelsGrid = document.getElementById('batch-labels-grid');
    const batchLabelCount = document.getElementById('batch-label-count');

    let currentQrData = null;
    let currentQrDeviceId = null;

    async function init() {
        setupEventListeners();
        initAdminRecaptcha();

        // SECURITY FIX #7: Check session via cookie (no localStorage token needed)
        const isValidAdmin = await checkAdminSession();
        if (isValidAdmin) {
            showAdminWorkspace();
            loadAdminData();
            return;
        }

        showLoginOverlay();
    }

    function setupEventListeners() {
        const btnThemeToggle = document.getElementById('btn-theme-toggle');
        if (btnThemeToggle) {
            btnThemeToggle.addEventListener('click', () => {
                const active = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
                const nextTheme = active === 'light' ? 'dark' : 'light';
                document.documentElement.setAttribute('data-theme', nextTheme);
                try {
                    localStorage.setItem('cu100_theme', nextTheme);
                } catch (e) {}
            });
        }

        adminLoginForm.addEventListener('submit', handleAdminLogin);
        btnAdminLogout.addEventListener('click', handleAdminLogout);

        if (linkAdminForgotPassword) {
            linkAdminForgotPassword.addEventListener('click', showAdminForgotForm);
        }
        if (linkAdminBackToLogin) {
            linkAdminBackToLogin.addEventListener('click', showAdminLoginForm);
        }
        if (adminForgotForm) {
            adminForgotForm.addEventListener('submit', handleAdminForgotPassword);
        }

        btnAdminAddUser.addEventListener('click', () => openUserModal());
        btnCloseUserModal.addEventListener('click', () => hideModal(adminUserModal));
        adminUserForm.addEventListener('submit', handleSaveUser);

        btnCloseDeviceModal.addEventListener('click', () => hideModal(adminDeviceModal));
        adminDeviceForm.addEventListener('submit', handleSaveDevice);

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
        if (btnAdminBatchLabels) {
            btnAdminBatchLabels.addEventListener('click', openBatchLabelsModal);
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
    }

    async function checkAdminSession() {
        try {
            // Cookie is sent automatically — no Authorization header needed
            const res = await fetch('/api/auth/me');
            if (res.ok) {
                const data = await res.json();
                if (data.user && data.user.role === 'admin') {
                    currentAdmin = data.user;
                    localStorage.setItem('cu100_admin_info', JSON.stringify(currentAdmin));
                    return true;
                }
            }
        } catch (e) {}

        currentAdmin = null;
        localStorage.removeItem('cu100_admin_info');
        return false;
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

    async function initAdminRecaptcha() {
        try {
            const res = await fetch('/api/auth/config');
            if (!res.ok) return;
            const config = await res.json();
            if (config.recaptchaEnabled && config.recaptchaSiteKey) {
                recaptchaSiteKey = config.recaptchaSiteKey;
                if (adminRecaptchaContainer) {
                    adminRecaptchaContainer.style.display = 'flex';
                }
                loadRecaptchaScript(() => {
                    renderAdminRecaptcha();
                });
            }
        } catch (e) {
            console.warn('[Admin reCAPTCHA config fetch failed]:', e);
        }
    }

    function renderAdminRecaptcha() {
        if (!recaptchaSiteKey || !adminRecaptchaContainer || adminRecaptchaWidgetId !== null) return;
        if (!window.grecaptcha || !window.grecaptcha.render) return;
        try {
            const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
            adminRecaptchaWidgetId = grecaptcha.render('admin-recaptcha-container', {
                sitekey: recaptchaSiteKey,
                theme: theme
            });
        } catch (e) {
            console.warn('[Admin reCAPTCHA render failed]:', e);
        }
    }

    function renderAdminForgotRecaptcha() {
        if (!recaptchaSiteKey || !adminForgotRecaptchaContainer || adminForgotRecaptchaWidgetId !== null) return;
        if (!window.grecaptcha || !window.grecaptcha.render) return;
        try {
            const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
            adminForgotRecaptchaWidgetId = grecaptcha.render('admin-forgot-recaptcha-container', {
                sitekey: recaptchaSiteKey,
                theme: theme
            });
        } catch (e) {
            console.warn('[Admin Forgot reCAPTCHA render failed]:', e);
        }
    }

    function showAdminLoginForm() {
        if (adminLoginForm) adminLoginForm.style.display = 'block';
        if (adminForgotForm) adminForgotForm.style.display = 'none';
        if (adminAuthTitle) adminAuthTitle.textContent = 'Admin Back-Office Sign In';
        if (adminAuthSubtitle) adminAuthSubtitle.textContent = 'Please enter your administrator credentials to access the back-office management console.';
        if (adminLoginError) adminLoginError.style.display = 'none';
        if (adminForgotError) adminForgotError.style.display = 'none';
        if (adminForgotSuccess) adminForgotSuccess.style.display = 'none';
    }

    function showAdminForgotForm() {
        if (adminLoginForm) adminLoginForm.style.display = 'none';
        if (adminForgotForm) adminForgotForm.style.display = 'block';
        if (adminAuthTitle) adminAuthTitle.textContent = 'Admin Password Recovery';
        if (adminAuthSubtitle) adminAuthSubtitle.textContent = 'Enter your administrator registered email to receive a password reset link.';
        if (adminForgotError) adminForgotError.style.display = 'none';
        if (adminForgotSuccess) adminForgotSuccess.style.display = 'none';

        if (recaptchaSiteKey && adminForgotRecaptchaContainer) {
            adminForgotRecaptchaContainer.style.display = 'flex';
            loadRecaptchaScript(() => {
                renderAdminForgotRecaptcha();
            });
        }
    }

    async function handleAdminForgotPassword(e) {
        e.preventDefault();
        if (adminForgotError) adminForgotError.style.display = 'none';
        if (adminForgotSuccess) adminForgotSuccess.style.display = 'none';

        const identifier = (adminForgotIdentifier?.value || '').trim();
        if (!identifier) {
            if (adminForgotError) {
                adminForgotError.textContent = 'Please enter your administrator email or username.';
                adminForgotError.style.display = 'block';
            }
            return;
        }

        let recaptchaToken = null;
        if (recaptchaSiteKey && adminForgotRecaptchaWidgetId !== null && window.grecaptcha) {
            recaptchaToken = grecaptcha.getResponse(adminForgotRecaptchaWidgetId);
            if (!recaptchaToken) {
                if (adminForgotError) {
                    adminForgotError.textContent = 'Please complete the reCAPTCHA challenge';
                    adminForgotError.style.display = 'block';
                }
                return;
            }
        }

        if (btnAdminForgotSubmit) {
            btnAdminForgotSubmit.disabled = true;
            btnAdminForgotSubmit.textContent = 'Sending...';
        }

        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier, portal: 'admin', recaptchaToken })
            });

            const data = await res.json();

            if (!res.ok) {
                if (adminForgotError) {
                    adminForgotError.textContent = data.error || 'Failed to request password reset.';
                    adminForgotError.style.display = 'block';
                }
                if (adminForgotRecaptchaWidgetId !== null && window.grecaptcha) {
                    grecaptcha.reset(adminForgotRecaptchaWidgetId);
                }
                if (btnAdminForgotSubmit) {
                    btnAdminForgotSubmit.disabled = false;
                    btnAdminForgotSubmit.textContent = 'Send Password Reset Link';
                }
                return;
            }

            if (adminForgotSuccess) {
                adminForgotSuccess.textContent = data.message || 'If an account matches that email, a password reset link has been sent.';
                adminForgotSuccess.style.display = 'block';
            }
            if (adminForgotIdentifier) adminForgotIdentifier.value = '';

            if (adminForgotRecaptchaWidgetId !== null && window.grecaptcha) {
                grecaptcha.reset(adminForgotRecaptchaWidgetId);
            }

            if (btnAdminForgotSubmit) {
                btnAdminForgotSubmit.disabled = false;
                btnAdminForgotSubmit.textContent = 'Send Password Reset Link';
            }
        } catch (err) {
            if (adminForgotError) {
                adminForgotError.textContent = 'Server connection error. Please try again.';
                adminForgotError.style.display = 'block';
            }
            if (adminForgotRecaptchaWidgetId !== null && window.grecaptcha) {
                grecaptcha.reset(adminForgotRecaptchaWidgetId);
            }
            if (btnAdminForgotSubmit) {
                btnAdminForgotSubmit.disabled = false;
                btnAdminForgotSubmit.textContent = 'Send Password Reset Link';
            }
        }
    }

    async function handleAdminLogin(e) {
        e.preventDefault();
        adminLoginError.style.display = 'none';

        const username = document.getElementById('admin-input-username').value;
        const password = document.getElementById('admin-input-password').value;

        let recaptchaToken = null;
        if (recaptchaSiteKey && adminRecaptchaWidgetId !== null && window.grecaptcha) {
            recaptchaToken = grecaptcha.getResponse(adminRecaptchaWidgetId);
            if (!recaptchaToken) {
                adminLoginError.textContent = 'Please complete the reCAPTCHA challenge';
                adminLoginError.style.display = 'block';
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
                adminLoginError.textContent = data.error || 'Login failed';
                adminLoginError.style.display = 'block';
                if (adminRecaptchaWidgetId !== null && window.grecaptcha) {
                    grecaptcha.reset(adminRecaptchaWidgetId);
                }
                return;
            }

            if (data.user.role !== 'admin') {
                adminLoginError.textContent = 'Access Denied: Account does not have administrator privileges';
                adminLoginError.style.display = 'block';
                if (adminRecaptchaWidgetId !== null && window.grecaptcha) {
                    grecaptcha.reset(adminRecaptchaWidgetId);
                }
                return;
            }

            // SECURITY FIX #7: Server sets HttpOnly cookie — we only store display info (no token)
            currentAdmin = data.user;
            localStorage.setItem('cu100_admin_info', JSON.stringify(currentAdmin));

            if (adminRecaptchaWidgetId !== null && window.grecaptcha) {
                grecaptcha.reset(adminRecaptchaWidgetId);
            }

            adminLoginForm.reset();
            showAdminWorkspace();
            loadAdminData();
        } catch (err) {
            adminLoginError.textContent = 'Server connection error';
            adminLoginError.style.display = 'block';
            if (adminRecaptchaWidgetId !== null && window.grecaptcha) {
                grecaptcha.reset(adminRecaptchaWidgetId);
            }
        }
    }

    async function handleAdminLogout() {
        try {
            // SECURITY FIX #7: Ask server to clear the HttpOnly cookie
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch (e) {}
        currentAdmin = null;
        localStorage.removeItem('cu100_admin_info');
        showLoginOverlay();
    }

    function showLoginOverlay() {
        showAdminLoginForm();
        adminLoginWrapper.style.display = 'flex';
        adminWorkspace.style.display = 'none';
        adminUserBadge.style.display = 'none';
        if (recaptchaSiteKey) {
            renderAdminRecaptcha();
        }
    }

    function showAdminWorkspace() {
        adminLoginWrapper.style.display = 'none';
        adminWorkspace.style.display = 'flex';
        adminUserBadge.style.display = 'flex';
        adminNameDisplay.textContent = currentAdmin ? currentAdmin.username : 'Admin';
    }

    async function loadAdminData() {
        await Promise.all([loadUsersTable(), loadDevicesTable()]);
    }

    // USER MANAGEMENT
    async function loadUsersTable() {
        adminUsersTbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Loading user data...</td></tr>';
        try {
            // Cookie sent automatically — no Authorization header needed
            const res = await fetch('/api/admin/users');
            const data = await res.json();
            allUsersList = data.users || [];

            statTotalUsers.textContent = allUsersList.length;
            adminUsersTbody.innerHTML = '';

            allUsersList.forEach(u => {
                const tr = document.createElement('tr');
                const createdDate = new Date(u.created_at).toLocaleDateString();
                const retStr = u.retention_period === '30d' ? '📅 1 Month' : (u.retention_period === '180d' ? '📊 6 Months' : '⚡ 7 Days');

                tr.innerHTML = `
                    <td>#${u.id}</td>
                    <td><strong>${escapeHtml(u.username)}</strong></td>
                    <td>${escapeHtml(u.email)}</td>
                    <td><span class="badge badge-${u.role}">${u.role.toUpperCase()}</span></td>
                    <td><span class="badge badge-secondary" style="font-weight:600;">${retStr}</span></td>
                    <td><code>${escapeHtml(u.mqtt_user || '---')}</code></td>
                    <td>${u.device_count} Device(s)</td>
                    <td>${createdDate}</td>
                    <td>
                        <div class="table-actions">
                            <button class="btn-icon-sm" onclick="window.adminEditUser(${u.id})">Edit</button>
                            ${u.id !== currentAdmin.id ? `<button class="btn-icon-sm btn-icon-danger" onclick="window.adminDeleteUser(${u.id})">Delete</button>` : ''}
                        </div>
                    </td>
                `;
                adminUsersTbody.appendChild(tr);
            });
        } catch (e) {
            adminUsersTbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#f43f5e;">Error loading users.</td></tr>';
        }
    }

    function openUserModal(user = null) {
        adminUserError.style.display = 'none';
        if (user) {
            userModalTitle.textContent = 'Edit User Account';
            userEditId.value = user.id;
            userInputUsername.value = user.username;
            userInputEmail.value = user.email;
            userInputPassword.value = '';
            userInputRole.value = user.role;
            if (userInputRetention) userInputRetention.value = user.retention_period || '7d';
            if (userInputMqttUser) userInputMqttUser.value = user.mqtt_user || '';
            if (userInputMqttPass) userInputMqttPass.value = '';
        } else {
            userModalTitle.textContent = 'Create New User Account';
            userEditId.value = '';
            adminUserForm.reset();
            if (userInputRetention) userInputRetention.value = '7d';
            if (userInputMqttUser) userInputMqttUser.value = '';
            if (userInputMqttPass) userInputMqttPass.value = '';
        }
        showModal(adminUserModal);
    }

    async function handleSaveUser(e) {
        e.preventDefault();
        adminUserError.style.display = 'none';

        const id = userEditId.value;
        const username = userInputUsername.value;
        const email = userInputEmail.value;
        const password = userInputPassword.value;
        const role = userInputRole.value;
        const retention_period = userInputRetention ? userInputRetention.value : '7d';
        const mqtt_user = userInputMqttUser ? userInputMqttUser.value.trim() : '';
        const mqtt_pass = userInputMqttPass ? userInputMqttPass.value.trim() : '';

        const payload = { username, email, password, role, retention_period, mqtt_user, mqtt_pass };

        try {
            const url = id ? `/api/admin/users/${id}` : '/api/admin/users';
            const method = id ? 'PUT' : 'POST';

            // Cookie sent automatically — no Authorization header needed
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok) {
                adminUserError.textContent = data.error || 'Operation failed';
                adminUserError.style.display = 'block';
                return;
            }

            hideModal(adminUserModal);
            loadUsersTable();
        } catch (err) {
            adminUserError.textContent = 'Server error';
            adminUserError.style.display = 'block';
        }
    }

    window.adminEditUser = function (id) {
        const u = allUsersList.find(usr => usr.id === id);
        if (u) openUserModal(u);
    };

    window.adminDeleteUser = async function (id) {
        if (!confirm('Are you sure you want to delete this user?')) return;
        try {
            // Cookie sent automatically
            const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
            if (res.ok) {
                loadUsersTable();
                loadDevicesTable();
            }
        } catch (e) {}
    };

    // GLOBAL DEVICE AUDIT & MANAGEMENT
    async function loadDevicesTable() {
        adminDevicesTbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Loading devices...</td></tr>';
        try {
            // Cookie sent automatically
            const res = await fetch('/api/devices');
            const data = await res.json();
            const devices = data.devices || [];

            statTotalDevices.textContent = devices.length;
            const pubCount = devices.filter(d => d.visibility === 'public').length;
            statPublicDevices.textContent = pubCount;
            statPrivateDevices.textContent = devices.length - pubCount;

            adminDevicesTbody.innerHTML = '';
            if (devices.length === 0) {
                adminDevicesTbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">No devices in system.</td></tr>';
                return;
            }

            devices.forEach(d => {
                const tr = document.createElement('tr');
                const ownerName = d.owner_name ? d.owner_name : '<em>Unassigned</em>';
                const rateVal = d.electricity_rate != null ? Number(d.electricity_rate).toFixed(2) : '0.00';
                const currVal = d.currency || 'IDR';
                const voltVal = d.voltage != null ? Number(d.voltage).toFixed(1) : '220.0';
                const rateFormatted = currVal === 'USD'
                    ? `$${rateVal} / kWh`
                    : `Rp ${Number(rateVal).toLocaleString('id-ID', { minimumFractionDigits: 2 })} / kWh`;

                tr.innerHTML = `
                    <td><code>${escapeHtml(d.device_id.toUpperCase())}</code></td>
                    <td><strong>${escapeHtml(d.name)}</strong></td>
                    <td>${escapeHtml(d.location)}</td>
                    <td>${ownerName}</td>
                    <td><span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.3); font-weight: 700;">⚡ ${voltVal} V</span></td>
                    <td><span class="badge" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); font-weight: 600;">${rateFormatted} (${currVal})</span></td>
                    <td><span class="badge badge-${d.visibility}">${d.visibility === 'public' ? '🌐 Public' : '🔒 Private'}</span></td>
                    <td>
                        <div class="table-actions">
                            <button class="btn-icon-sm btn-icon-accent" onclick="window.openDeviceQrModal('${escapeHtml(d.device_id)}')" title="View and Print QR Code Label">🏷️ Label</button>
                            <button class="btn-icon-sm" onclick="window.adminEditDevice(${d.id})">Edit / Reassign</button>
                            <button class="btn-icon-sm btn-icon-danger" onclick="window.adminDeleteDevice(${d.id})">Delete</button>
                        </div>
                    </td>
                `;
                adminDevicesTbody.appendChild(tr);
            });
        } catch (e) {
            adminDevicesTbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#f43f5e;">Error loading devices.</td></tr>';
        }
    }

    window.adminEditDevice = async function (id) {
        try {
            // Cookie sent automatically
            const res = await fetch('/api/devices');
            const data = await res.json();
            const dev = (data.devices || []).find(d => d.id === id);
            if (!dev) return;

            deviceEditId.value = dev.id;
            deviceInputName.value = dev.name;
            deviceInputLocation.value = dev.location;
            if (deviceInputVoltage) deviceInputVoltage.value = dev.voltage != null ? Number(dev.voltage).toFixed(1) : '220.0';
            deviceInputRate.value = dev.electricity_rate != null ? Number(dev.electricity_rate).toFixed(2) : '0.00';
            deviceInputCurrency.value = dev.currency || 'IDR';
            deviceInputVisibility.value = dev.visibility;
            if (deviceInputCh1Label) deviceInputCh1Label.value = dev.ch1_label || 'Channel 1';
            if (deviceInputCh2Label) deviceInputCh2Label.value = dev.ch2_label || 'Channel 2';
            if (deviceInputCh3Label) deviceInputCh3Label.value = dev.ch3_label || 'Channel 3';
            if (deviceInputCh4Label) deviceInputCh4Label.value = dev.ch4_label || 'Channel 4';

            // Populate Owners
            deviceInputOwner.innerHTML = '<option value="">-- No Owner (Unassigned) --</option>';
            allUsersList.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = `${u.username} (${u.email})`;
                if (dev.owner_id === u.id) opt.selected = true;
                deviceInputOwner.appendChild(opt);
            });

            adminDeviceError.style.display = 'none';
            showModal(adminDeviceModal);
        } catch (e) {}
    };

    async function handleSaveDevice(e) {
        e.preventDefault();
        adminDeviceError.style.display = 'none';

        const id = deviceEditId.value;
        const name = deviceInputName.value;
        const location = deviceInputLocation.value;
        const voltage = deviceInputVoltage ? (parseFloat(deviceInputVoltage.value) || 220.0) : 220.0;
        const electricity_rate = parseFloat(deviceInputRate.value) || 0;
        const currency = deviceInputCurrency.value || 'IDR';
        const visibility = deviceInputVisibility.value;
        const owner_id = deviceInputOwner.value ? parseInt(deviceInputOwner.value, 10) : null;
        const ch1_label = deviceInputCh1Label ? deviceInputCh1Label.value.trim() : 'Channel 1';
        const ch2_label = deviceInputCh2Label ? deviceInputCh2Label.value.trim() : 'Channel 2';
        const ch3_label = deviceInputCh3Label ? deviceInputCh3Label.value.trim() : 'Channel 3';
        const ch4_label = deviceInputCh4Label ? deviceInputCh4Label.value.trim() : 'Channel 4';

        try {
            // Cookie sent automatically
            const res = await fetch(`/api/devices/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, location, visibility, owner_id, electricity_rate, currency, voltage, ch1_label, ch2_label, ch3_label, ch4_label })
            });

            if (res.ok) {
                hideModal(adminDeviceModal);
                loadDevicesTable();
                loadUsersTable();
            } else {
                const data = await res.json();
                adminDeviceError.textContent = data.error || 'Failed to update device';
                adminDeviceError.style.display = 'block';
            }
        } catch (err) {
            adminDeviceError.textContent = 'Server error';
            adminDeviceError.style.display = 'block';
        }
    }

    window.adminDeleteDevice = async function (id) {
        if (!confirm('Are you sure you want to delete this device from system?')) return;
        try {
            // Cookie sent automatically
            const res = await fetch(`/api/devices/${id}`, { method: 'DELETE' });
            if (res.ok) {
                loadDevicesTable();
                loadUsersTable();
            }
        } catch (e) {}
    };

    // -------------------------------------------------------------------
    // ADMIN QR CODE & LABEL MANAGEMENT
    // -------------------------------------------------------------------
    window.openDeviceQrModal = async function (rawDeviceId) {
        if (!deviceQrModal) return;
        const deviceId = (rawDeviceId || '').trim().toLowerCase().replace(/^cu100_/, '');
        if (!deviceId) return;

        currentQrDeviceId = deviceId;

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
            console.error('[Admin QR Error]:', err);
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
                                    <linearGradient id="admStkRing_${cleanId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00e5ff"/><stop offset="1" stop-color="#067fa8"/></linearGradient>
                                    <linearGradient id="admStkBolt_${cleanId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd34d"/><stop offset="0.45" stop-color="#ffb020"/><stop offset="1" stop-color="#ff7a00"/></linearGradient>
                                    <radialGradient id="admStkHalo_${cleanId}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffb020" stop-opacity="0.5"/><stop offset="0.7" stop-color="#ffb020" stop-opacity="0.12"/><stop offset="1" stop-color="#ffb020" stop-opacity="0"/></radialGradient>
                                </defs>
                                <rect width="512" height="512" rx="112" fill="#0a0e14"/>
                                <circle cx="256" cy="256" r="160" fill="none" stroke="url(#admStkRing_${cleanId})" stroke-width="60" stroke-linecap="round" stroke-dasharray="880 126" transform="rotate(-30 256 256)"/>
                                <circle cx="256" cy="256" r="160" fill="url(#admStkHalo_${cleanId})"/>
                                <path d="M302 48 L184 288 L254 288 L228 428 L344 216 L270 216 Z" fill="url(#admStkBolt_${cleanId})"/>
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
            console.error('[Admin Batch QR Error]:', err);
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

    function showModal(m) { if (m) m.classList.add('active'); }
    function hideModal(m) { if (m) m.classList.remove('active'); }
    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    document.addEventListener('DOMContentLoaded', init);
})();
