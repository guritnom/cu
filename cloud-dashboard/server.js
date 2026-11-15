require('dotenv').config();
const http = require('http');
BigInt.prototype.toJSON = function() { return Number(this); };
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const mqtt = require('mqtt');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');

const { initDb, queryGet, queryAll, queryRun, generateMqttCredentials } = require('./db');
const { initTelemetryDb, enqueueTelemetry, getTelemetryHistory, getDeviceTelemetryBounds, purgeExpiredTelemetry, safeParseDate } = require('./telemetry_db');
const { initMonthlyEnergy, invalidateDeviceConfig, processTelemetryEnergy, getDeviceMonthlyEnergy, flushMonthlyEnergy } = require('./monthly_energy');
const { sendPasswordResetEmail, isSmtpConfigured } = require('./mailer');

const HTTP_PORT = process.env.PORT || 3000;
const MQTT_BROKER_HOST = process.env.MQTT_HOST || '127.0.0.1';
const MQTT_BROKER_PORT = process.env.MQTT_PORT || 1883;
const MQTT_USER = process.env.MQTT_USER || 'admin_bridge_user';
const MQTT_PASS = process.env.MQTT_PASS || crypto.randomBytes(24).toString('hex');
if (!process.env.MQTT_PASS) {
    console.warn('[config] MQTT_PASS is not set — generated a random bridge password for this session. '
        + 'Set MQTT_PASS / MQTT_USER (see .env.example) so the mosquitto-go-auth HTTP backend can authenticate the bridge user.');
}
const APP_URL = process.env.APP_URL ? process.env.APP_URL.trim().replace(/\/+$/, '') : null;
const RECAPTCHA_SITE_KEY = process.env.RECAPTCHA_SITE_KEY ? process.env.RECAPTCHA_SITE_KEY.trim() : null;
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY ? process.env.RECAPTCHA_SECRET_KEY.trim() : null;
const RECAPTCHA_ENABLED = Boolean(RECAPTCHA_SITE_KEY && RECAPTCHA_SECRET_KEY);

// Helper to determine the application's base public URL (e.g. for QR codes / device links)
function getBaseUrl(req) {
    if (APP_URL) return APP_URL;
    if (req) {
        const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host = req.get('host');
        if (host) return `${proto}://${host}`;
    }
    return 'https://dashboard.currentusage.com';
}

// SECURITY FIX #1: Require JWT_SECRET from environment — crash on startup if missing
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('\n[FATAL] JWT_SECRET environment variable is not set.');
    console.error('[FATAL] Please set a strong, random JWT_SECRET in your environment before starting.\n');
    process.exit(1);
}

const COOKIE_NAME = 'cu100_auth';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const app = express();
// Trust only the single immediate upstream reverse proxy (e.g. nginx on the same host).
// Using `true` would allow clients to spoof X-Forwarded-For and bypass IP rate limiting.
app.set('trust proxy', 1);
app.use(cors({ origin: false })); // Same-origin only — no cross-origin API access
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // SECURITY FIX #7: cookie-parser for HttpOnly session cookies

// Initialize Databases on Startup
initDb().catch(err => console.error('[DB Init Error]:', err));
initTelemetryDb().catch(err => console.error('[DuckDB Init Error]:', err));
initMonthlyEnergy();

// Helper to verify custom API tokens (cu100_sk_...)
async function verifyApiToken(rawToken) {
    if (!rawToken || typeof rawToken !== 'string' || !rawToken.startsWith('cu100_sk_')) return null;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const apiToken = await queryGet(
        `SELECT t.id AS token_id, t.user_id, u.id AS id, u.username, u.email, u.role
         FROM api_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = ?`,
        [tokenHash]
    );
    if (!apiToken) return null;

    // Asynchronously touch last_used_at timestamp
    queryRun(`UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`, [apiToken.token_id]).catch(() => {});

    return {
        id: apiToken.id,
        username: apiToken.username,
        email: apiToken.email,
        role: apiToken.role
    };
}

// SECURITY FIX #7: Accept token from HttpOnly cookie first, fall back to Authorization header or X-API-Key header
async function authenticateToken(req, res, next) {
    const cookieToken = req.cookies && req.cookies[COOKIE_NAME];
    const authHeader = req.headers['authorization'];
    const apiKeyHeader = req.headers['x-api-key'];
    const headerToken = authHeader && authHeader.split(' ')[1];

    const token = cookieToken || headerToken || apiKeyHeader;
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    if (token.startsWith('cu100_sk_')) {
        try {
            const user = await verifyApiToken(token);
            if (!user) {
                return res.status(403).json({ error: 'Invalid or revoked API token' });
            }
            req.user = user;
            return next();
        } catch (e) {
            console.error('[API Token Auth Error]:', e);
            return res.status(500).json({ error: 'Internal server error during token verification' });
        }
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token' });
        req.user = user;
        next();
    });
}

async function optionalToken(req, res, next) {
    const cookieToken = req.cookies && req.cookies[COOKIE_NAME];
    const authHeader = req.headers['authorization'];
    const apiKeyHeader = req.headers['x-api-key'];
    const headerToken = authHeader && authHeader.split(' ')[1];
    const token = cookieToken || headerToken || apiKeyHeader;

    if (token) {
        if (token.startsWith('cu100_sk_')) {
            try {
                const user = await verifyApiToken(token);
                if (user) req.user = user;
            } catch (e) {}
            return next();
        }
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (!err) req.user = user;
            next();
        });
    } else {
        next();
    }
}

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin privileges required' });
    }
    next();
}

// SECURITY FIX #10: Admin audit trail logger
async function logAdminAction(req, action, targetType, targetId, details = '') {
    try {
        await queryRun(
            `INSERT INTO admin_audit_log (admin_id, admin_username, action, target_type, target_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, req.user.username, action, targetType, String(targetId), details, req.ip || 'unknown']
        );
    } catch (e) {
        console.error('[Audit Log Error]:', e.message);
    }
}

// -------------------------------------------------------------------
// SECURITY FIX #6: Rate limiting on login endpoint
// -------------------------------------------------------------------
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again in 15 minutes.' }
});

const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 requests per 15 minutes per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many password reset requests. Please try again in 15 minutes.' }
});

const resetPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many password reset attempts. Please try again in 15 minutes.' }
});

// Helper to verify Google reCAPTCHA v2 token
async function verifyRecaptcha(token, remoteIp) {
    if (!RECAPTCHA_ENABLED) {
        return { success: true };
    }
    if (!token) {
        return { success: false, error: 'reCAPTCHA verification is required. Please check the box.' };
    }
    try {
        const formData = new URLSearchParams();
        formData.append('secret', RECAPTCHA_SECRET_KEY);
        formData.append('response', token);
        if (remoteIp) {
            formData.append('remoteip', remoteIp);
        }

        const verifyRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString()
        });

        const data = await verifyRes.json();
        if (data.success) {
            return { success: true };
        } else {
            console.warn('[reCAPTCHA Verification Failed]:', data['error-codes'] || data);
            return { success: false, error: 'reCAPTCHA verification failed. Please try again.' };
        }
    } catch (err) {
        console.error('[reCAPTCHA API Error]:', err);
        return { success: false, error: 'Unable to contact reCAPTCHA verification service' };
    }
}

// -------------------------------------------------------------------
// 1. AUTHENTICATION ENDPOINTS
// -------------------------------------------------------------------

// GET /api/auth/config — returns public authentication config (e.g. reCAPTCHA site key)
app.get('/api/auth/config', (req, res) => {
    res.json({
        recaptchaSiteKey: RECAPTCHA_ENABLED ? RECAPTCHA_SITE_KEY : null,
        recaptchaEnabled: RECAPTCHA_ENABLED
    });
});

// POST /api/auth/login
app.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        const recaptchaToken = req.body.recaptchaToken || req.body['g-recaptcha-response'];

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        if (RECAPTCHA_ENABLED) {
            const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress;
            const recaptchaResult = await verifyRecaptcha(recaptchaToken, clientIp);
            if (!recaptchaResult.success) {
                return res.status(400).json({ error: recaptchaResult.error });
            }
        }

        const user = await queryGet(`SELECT * FROM users WHERE username = ? OR email = ?`, [username, username]);
        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const passwordValid = bcrypt.compareSync(password, user.password_hash);
        if (!passwordValid) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const tokenPayload = {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role
        };

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

        // SECURITY FIX #7: Set HttpOnly cookie — not accessible to JavaScript
        res.cookie(COOKIE_NAME, token, {
            httpOnly: true,
            secure: IS_PRODUCTION,
            sameSite: 'Strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in ms
        });

        res.json({
            message: 'Login successful',
            token, // kept for backward compatibility with any API clients
            user: tokenPayload
        });
    } catch (err) {
        console.error('[API Auth Login Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/auth/logout — clears the session cookie
app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'Strict' });
    res.json({ message: 'Logged out successfully' });
});

// POST /api/auth/forgot-password — initiates password reset via SMTP
app.post('/api/auth/forgot-password', forgotPasswordLimiter, async (req, res) => {
    try {
        const identifier = (req.body.identifier || req.body.email || req.body.username || '').trim();
        const recaptchaToken = req.body.recaptchaToken || req.body['g-recaptcha-response'];
        const referer = req.headers.referer || '';
        let portal = (req.body.portal || req.body.role || '').toLowerCase();
        if (!portal) {
            portal = referer.includes('admin.html') ? 'admin' : 'user';
        }

        if (!identifier) {
            return res.status(400).json({ error: 'Please enter your registered email address or username.' });
        }

        if (RECAPTCHA_ENABLED) {
            const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress;
            const recaptchaResult = await verifyRecaptcha(recaptchaToken, clientIp);
            if (!recaptchaResult.success) {
                return res.status(400).json({ error: recaptchaResult.error });
            }
        }

        // Generic safe message to prevent email enumeration for unknown accounts
        const genericSuccessMsg = 'If an account matches that email address or username, a password reset link has been sent.';

        // Look up user by email or username (case-insensitive)
        const user = await queryGet(
            `SELECT id, username, email, role FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)`,
            [identifier, identifier]
        );

        if (!user || !user.email) {
            return res.json({ success: true, message: genericSuccessMsg });
        }

        // Strict portal separation: Admin portal only for admins; User portal only for standard users
        // Silently do not generate tokens or send emails if privileges do not match, returning generic message to prevent enumeration
        if (portal === 'admin' && user.role !== 'admin') {
            return res.json({ success: true, message: genericSuccessMsg });
        }
        if (portal === 'user' && user.role === 'admin') {
            return res.json({ success: true, message: genericSuccessMsg });
        }

        // Generate cryptographically secure random token (64 hex characters)
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour expiration

        // Invalidate previous unused reset tokens for this user
        await queryRun(`UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0`, [user.id]);

        // Insert new reset token
        await queryRun(
            `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
            [user.id, tokenHash, expiresAt]
        );

        // Construct full public reset link
        const resetUrl = `${getBaseUrl(req)}/reset-password.html?token=${rawToken}`;

        // Send email via SMTP (or fallback log in dev)
        try {
            await sendPasswordResetEmail({
                toEmail: user.email,
                username: user.username,
                resetUrl,
                role: user.role
            });
        } catch (mailErr) {
            console.error('[AUTH ERROR] Could not dispatch reset email:', mailErr.message);
        }

        return res.json({
            success: true,
            message: genericSuccessMsg
        });
    } catch (err) {
        console.error('[API Forgot Password Error]:', err);
        res.status(500).json({ error: 'Unable to process password reset request at this time.' });
    }
});

// GET /api/auth/verify-reset-token — verifies token validity before rendering form
app.get('/api/auth/verify-reset-token', async (req, res) => {
    try {
        const token = (req.query.token || '').trim();
        if (!token) {
            return res.status(400).json({ valid: false, error: 'Reset token is required.' });
        }

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const record = await queryGet(
            `SELECT pr.id, pr.user_id, pr.expires_at, pr.used, u.username, u.email, u.role
             FROM password_resets pr
             JOIN users u ON u.id = pr.user_id
             WHERE pr.token_hash = ?`,
            [tokenHash]
        );

        if (!record || record.used === 1) {
            return res.status(400).json({ valid: false, error: 'This password reset link is invalid or has already been used.' });
        }

        if (new Date(record.expires_at) < new Date()) {
            return res.status(400).json({ valid: false, error: 'This password reset link has expired. Please request a new one.' });
        }

        res.json({
            valid: true,
            username: record.username,
            role: record.role
        });
    } catch (err) {
        console.error('[API Verify Reset Token Error]:', err);
        res.status(500).json({ valid: false, error: 'Internal server error while verifying token.' });
    }
});

// POST /api/auth/reset-password — updates password using verified reset token
app.post('/api/auth/reset-password', resetPasswordLimiter, async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) {
            return res.status(400).json({ error: 'Reset token and new password are required.' });
        }

        if (typeof newPassword !== 'string' || newPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        }

        const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
        const record = await queryGet(
            `SELECT pr.id, pr.user_id, pr.expires_at, pr.used, u.username, u.email, u.role
             FROM password_resets pr
             JOIN users u ON u.id = pr.user_id
             WHERE pr.token_hash = ?`,
            [tokenHash]
        );

        if (!record || record.used === 1) {
            return res.status(400).json({ error: 'This password reset link is invalid or has already been used.' });
        }

        if (new Date(record.expires_at) < new Date()) {
            return res.status(400).json({ error: 'This password reset link has expired. Please request a new one.' });
        }

        const salt = bcrypt.genSaltSync(10);
        const passwordHash = bcrypt.hashSync(newPassword, salt);

        // Update user's password in users table
        await queryRun(`UPDATE users SET password_hash = ? WHERE id = ?`, [passwordHash, record.user_id]);

        // Mark reset token as used
        await queryRun(`UPDATE password_resets SET used = 1 WHERE id = ?`, [record.id]);

        // Log admin audit trail
        await queryRun(
            `INSERT INTO admin_audit_log (admin_id, admin_username, action, target_type, target_id, details, ip_address)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [record.user_id, record.username, 'PASSWORD_RESET', 'user', String(record.user_id), `Password successfully reset via email token (${record.role})`, req.ip || 'unknown']
        ).catch(() => {});

        console.log(`[AUTH] Password successfully reset for ${record.role} "${record.username}" (${record.email})`);

        res.json({
            success: true,
            role: record.role,
            message: 'Your password has been successfully reset. You can now log in.'
        });
    } catch (err) {
        console.error('[API Reset Password Error]:', err);
        res.status(500).json({ error: 'Internal server error while resetting password.' });
    }
});

// GET /api/auth/me
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const user = await queryGet(`SELECT id, username, email, role, mqtt_user, created_at FROM users WHERE id = ?`, [req.user.id]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user });
    } catch (err) {
        console.error('[API Auth Me Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/user/mqtt-credentials
app.get('/api/user/mqtt-credentials', authenticateToken, async (req, res) => {
    try {
        let user = await queryGet(`SELECT id, username, mqtt_user, mqtt_pass, mqtt_pass_hash FROM users WHERE id = ?`, [req.user.id]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Auto-provision credentials if missing
        if (!user.mqtt_user) {
            const creds = generateMqttCredentials(user.username);
            const mqttPassHash = bcrypt.hashSync(creds.mqttPass, 10);
            await queryRun(`UPDATE users SET mqtt_user = ?, mqtt_pass = ?, mqtt_pass_hash = ? WHERE id = ?`,
                [creds.mqttUser, creds.mqttPass, mqttPassHash, user.id]);
            user.mqtt_user = creds.mqttUser;
            user.mqtt_pass = creds.mqttPass;
        }

        // SECURITY: Return plaintext only if it's still stored (legacy users).
        // After regeneration, plaintext is cleared — password can only be seen at that moment.
        res.json({
            mqtt_user: user.mqtt_user,
            mqtt_pass: user.mqtt_pass || null // null = already regenerated, plaintext no longer available
        });
    } catch (err) {
        console.error('[API User MQTT Creds Get Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/user/mqtt-credentials — regenerate or update MQTT credentials
app.put('/api/user/mqtt-credentials', authenticateToken, async (req, res) => {
    try {
        const { regenerate } = req.body;
        let user = await queryGet(`SELECT id, username FROM users WHERE id = ?`, [req.user.id]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const creds = generateMqttCredentials(user.username);
        const newMqttUser = creds.mqttUser;
        const newMqttPass = creds.mqttPass; // plaintext — returned to user ONCE, then cleared

        // SECURITY FIX #3: store bcrypt hash; clear plaintext after regeneration
        const mqttPassHash = bcrypt.hashSync(newMqttPass, 10);
        await queryRun(
            `UPDATE users SET mqtt_user = ?, mqtt_pass = NULL, mqtt_pass_hash = ? WHERE id = ?`,
            [newMqttUser, mqttPassHash, req.user.id]
        );

        res.json({
            message: 'MQTT credentials regenerated. Save this password — it will not be shown again.',
            mqtt_user: newMqttUser,
            mqtt_pass: newMqttPass // plaintext shown ONCE only
        });
    } catch (err) {
        console.error('[API User MQTT Creds Update Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// -------------------------------------------------------------------
// 1.5 USER API TOKENS MANAGEMENT ENDPOINTS
// -------------------------------------------------------------------

// GET /api/user/tokens — List user's active API tokens
app.get('/api/user/tokens', authenticateToken, async (req, res) => {
    try {
        const tokens = await queryAll(
            `SELECT id, name, token_prefix, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`,
            [req.user.id]
        );
        res.json({ tokens });
    } catch (err) {
        console.error('[API User Tokens Get Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/user/tokens — Generate a new API token
app.post('/api/user/tokens', authenticateToken, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || String(name).trim() === '') {
            return res.status(400).json({ error: 'Token name is required' });
        }

        const rawSecret = 'cu100_sk_' + crypto.randomBytes(24).toString('hex');
        const tokenPrefix = rawSecret.substring(0, 14) + '...';
        const tokenHash = crypto.createHash('sha256').update(rawSecret).digest('hex');

        const result = await queryRun(
            `INSERT INTO api_tokens (user_id, name, token_prefix, token_hash) VALUES (?, ?, ?, ?)`,
            [req.user.id, String(name).trim(), tokenPrefix, tokenHash]
        );

        res.status(201).json({
            message: 'API token generated successfully',
            token: {
                id: result.lastID,
                name: String(name).trim(),
                token_prefix: tokenPrefix,
                secret: rawSecret, // Returned ONLY ONCE
                created_at: new Date().toISOString()
            }
        });
    } catch (err) {
        console.error('[API User Token Post Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/user/tokens/:id — Revoke/delete an API token
app.delete('/api/user/tokens/:id', authenticateToken, async (req, res) => {
    try {
        const tokenId = parseInt(req.params.id, 10);
        const existing = await queryGet(`SELECT id FROM api_tokens WHERE id = ? AND user_id = ?`, [tokenId, req.user.id]);
        if (!existing) {
            return res.status(404).json({ error: 'API token not found' });
        }

        await queryRun(`DELETE FROM api_tokens WHERE id = ? AND user_id = ?`, [tokenId, req.user.id]);
        res.json({ message: 'API token revoked successfully' });
    } catch (err) {
        console.error('[API User Token Delete Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/admin/retention
app.get('/api/admin/retention', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const setting = await queryGet(`SELECT value FROM system_settings WHERE key = 'retention_period'`);
        const retention_period = (setting && setting.value) ? setting.value : '7d';
        res.json({ retention_period });
    } catch (err) {
        console.error('[API Admin Retention Get Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/admin/retention
app.put('/api/admin/retention', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { retention_period } = req.body;
        const validRetention = ['7d', '30d', '180d'].includes(retention_period) ? retention_period : '7d';

        await queryRun(`INSERT OR REPLACE INTO system_settings (key, value) VALUES ('retention_period', ?)`, [validRetention]);
        runRetentionCleanupJob().catch(e => console.error('[Retention Job Error]:', e));

        await logAdminAction(req, 'UPDATE_RETENTION', 'system', 'retention_period', `new_value=${validRetention}`);

        res.json({ message: 'Global system retention policy updated successfully', retention_period: validRetention });
    } catch (err) {
        console.error('[API Admin Retention Put Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/admin/purge-retention
app.post('/api/admin/purge-retention', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await runRetentionCleanupJob();
        await logAdminAction(req, 'MANUAL_PURGE', 'system', 'telemetry', 'Triggered manual telemetry purge');
        res.json({ message: 'Telemetry purge executed successfully' });
    } catch (err) {
        console.error('[API Admin Purge Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// -------------------------------------------------------------------
// 2. ADMIN BACK-OFFICE USER MANAGEMENT ENDPOINTS
// -------------------------------------------------------------------

// GET /api/admin/users
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await queryAll(`
            SELECT u.id, u.username, u.email, u.role, u.mqtt_user, COALESCE(u.retention_period, '7d') AS retention_period, u.created_at,
                   COUNT(d.id) AS device_count
            FROM users u
            LEFT JOIN devices d ON d.owner_id = u.id
            GROUP BY u.id
            ORDER BY u.created_at DESC
        `);
        res.json({ users });
    } catch (err) {
        console.error('[API Admin Users Get Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/admin/audit-log — SECURITY FIX #10: Expose audit log to admins
app.get('/api/admin/audit-log', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
        const logs = await queryAll(
            `SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT ?`,
            [limit]
        );
        res.json({ logs });
    } catch (err) {
        console.error('[API Admin Audit Log Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/admin/users (Create User)
app.post('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { username, email, password, role, mqtt_user, mqtt_pass, retention_period } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Username, email, and password are required' });
        }

        const validRole = role === 'admin' ? 'admin' : 'user';
        const validRetention = ['7d', '30d', '180d'].includes(retention_period) ? retention_period : '7d';

        const existing = await queryGet(`SELECT id, username, email FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)`, [username.trim(), email.trim()]);
        if (existing) {
            if (existing.email.toLowerCase() === email.trim().toLowerCase()) {
                return res.status(409).json({ error: 'Email already exists' });
            }
            return res.status(409).json({ error: 'Username already exists' });
        }

        const creds = generateMqttCredentials(username);
        const finalMqttUser = mqtt_user || creds.mqttUser;
        const finalMqttPass = mqtt_pass || creds.mqttPass;
        // SECURITY FIX #3: store bcrypt hash for MQTT password
        const mqttPassHash = bcrypt.hashSync(finalMqttPass, 10);

        const hash = bcrypt.hashSync(password, 10);
        const result = await queryRun(
            `INSERT INTO users (username, email, password_hash, role, mqtt_user, mqtt_pass, mqtt_pass_hash, retention_period) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [username.trim(), email.trim(), hash, validRole, finalMqttUser, finalMqttPass, mqttPassHash, validRetention]
        );

        runRetentionCleanupJob().catch(e => console.error('[Retention Job Error]:', e));
        await logAdminAction(req, 'CREATE_USER', 'user', result.lastID, `username=${username}, role=${validRole}`);

        res.status(201).json({
            message: 'User created successfully',
            user: { id: result.lastID, username, email, role: validRole, mqtt_user: finalMqttUser, mqtt_pass: finalMqttPass, retention_period: validRetention }
        });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT') {
            if (err.message && err.message.includes('users.email')) {
                return res.status(409).json({ error: 'Email already exists' });
            }
            if (err.message && err.message.includes('users.username')) {
                return res.status(409).json({ error: 'Username already exists' });
            }
        }
        console.error('[API Admin User Create Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/admin/users/:id (Update User)
app.put('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const { username, email, password, role, mqtt_user, mqtt_pass, retention_period } = req.body;

        const user = await queryGet(`SELECT * FROM users WHERE id = ?`, [userId]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const newUsername = (username && username.trim()) || user.username;
        const newEmail = (email && email.trim()) || user.email;
        const newRole = role ? (role === 'admin' ? 'admin' : 'user') : user.role;
        const newRetention = retention_period ? (['7d', '30d', '180d'].includes(retention_period) ? retention_period : user.retention_period) : (user.retention_period || '7d');

        // Check if new username or email is already taken by another user
        const duplicate = await queryGet(
            `SELECT id, username, email FROM users WHERE (LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)) AND id != ?`,
            [newUsername, newEmail, userId]
        );
        if (duplicate) {
            if (duplicate.email.toLowerCase() === newEmail.toLowerCase()) {
                return res.status(409).json({ error: 'Email is already in use by another user' });
            }
            return res.status(409).json({ error: 'Username is already in use by another user' });
        }

        let newHash = user.password_hash;
        if (password && password.trim().length > 0) {
            newHash = bcrypt.hashSync(password, 10);
        }

        // Handle MQTT credential update
        let newMqttUser = mqtt_user || user.mqtt_user;
        let mqttPassUpdate = '';
        let mqttHashUpdate = user.mqtt_pass_hash;
        let mqttPlaintextUpdate = user.mqtt_pass;

        if (mqtt_pass && mqtt_pass.trim().length > 0) {
            mqttHashUpdate = bcrypt.hashSync(mqtt_pass, 10);
            mqttPlaintextUpdate = mqtt_pass; // admin can set explicit credentials
        }

        await queryRun(
            `UPDATE users SET username = ?, email = ?, password_hash = ?, role = ?, mqtt_user = ?, mqtt_pass = ?, mqtt_pass_hash = ?, retention_period = ? WHERE id = ?`,
            [newUsername, newEmail, newHash, newRole, newMqttUser, mqttPlaintextUpdate, mqttHashUpdate, newRetention, userId]
        );

        runRetentionCleanupJob().catch(e => console.error('[Retention Job Error]:', e));
        await logAdminAction(req, 'UPDATE_USER', 'user', userId, `username=${newUsername}, role=${newRole}`);

        res.json({ message: 'User updated successfully' });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT') {
            if (err.message && err.message.includes('users.email')) {
                return res.status(409).json({ error: 'Email is already in use by another user' });
            }
            if (err.message && err.message.includes('users.username')) {
                return res.status(409).json({ error: 'Username is already in use by another user' });
            }
        }
        console.error('[API Admin User Update Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/admin/users/:id
app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        if (userId === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own admin account' });
        }

        const targetUser = await queryGet(`SELECT username FROM users WHERE id = ?`, [userId]);
        await queryRun(`DELETE FROM users WHERE id = ?`, [userId]);
        await queryRun(`UPDATE devices SET owner_id = NULL WHERE owner_id = ?`, [userId]);

        await logAdminAction(req, 'DELETE_USER', 'user', userId, `username=${targetUser ? targetUser.username : 'unknown'}`);

        res.json({ message: 'User deleted successfully' });
    } catch (err) {
        console.error('[API Admin User Delete Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// -------------------------------------------------------------------
// 3. DEVICE MANAGEMENT ENDPOINTS
// -------------------------------------------------------------------

// GET /api/devices
app.get('/api/devices', authenticateToken, async (req, res) => {
    try {
        let devices;
        if (req.user.role === 'admin') {
            devices = await queryAll(`
                SELECT d.id, d.device_id, d.name, d.location, d.visibility, d.owner_id, d.electricity_rate, d.currency, d.voltage,
                       d.ch1_label, d.ch2_label, d.ch3_label, d.ch4_label, d.created_at,
                       u.username AS owner_name
                FROM devices d
                LEFT JOIN users u ON u.id = d.owner_id
                ORDER BY d.created_at DESC
            `);
        } else {
            devices = await queryAll(`
                SELECT id, device_id, name, location, visibility, owner_id, electricity_rate, currency, voltage,
                       ch1_label, ch2_label, ch3_label, ch4_label, created_at
                FROM devices
                WHERE owner_id = ?
                ORDER BY created_at DESC
            `, [req.user.id]);
        }
        res.json({ devices });
    } catch (err) {
        console.error('[API Devices Get Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/devices/check-access/:deviceId
app.get('/api/devices/check-access/:deviceId', optionalToken, async (req, res) => {
    try {
        const deviceId = req.params.deviceId.toLowerCase().trim();
        const device = await queryGet(`
            SELECT d.id, d.device_id, d.name, d.location, d.visibility, d.owner_id, d.electricity_rate, d.currency, d.voltage,
                   d.ch1_label, d.ch2_label, d.ch3_label, d.ch4_label,
                   u.username AS owner_name
            FROM devices d
            LEFT JOIN users u ON u.id = d.owner_id
            WHERE LOWER(d.device_id) = ?
        `, [deviceId]);

        if (!device) {
            let monthlyEnergy = null;
            try {
                monthlyEnergy = await getDeviceMonthlyEnergy(deviceId);
            } catch (e) { }

            return res.json({
                registered: false,
                allowed: true,
                visibility: 'public',
                monthly_energy: monthlyEnergy,
                device: {
                    device_id: deviceId,
                    name: `CU100 (${deviceId.toUpperCase()})`,
                    location: 'Default',
                    visibility: 'public',
                    electricity_rate: 0.00,
                    currency: 'IDR',
                    voltage: 220.0,
                    ch1_label: 'Channel 1',
                    ch2_label: 'Channel 2',
                    ch3_label: 'Channel 3',
                    ch4_label: 'Channel 4'
                }
            });
        }

        let allowed = false;
        if (device.visibility === 'public') {
            allowed = true;
        } else if (req.user && req.user.role === 'user') {
            if (req.user.id === device.owner_id) {
                allowed = true;
            }
        } else if (req.user && req.user.role === 'admin') {
            allowed = true;
        }

        let monthlyEnergy = null;
        if (allowed) {
            try {
                monthlyEnergy = await getDeviceMonthlyEnergy(deviceId);
            } catch (e) {
                console.error('[Check Access Monthly Energy Error]:', e.message);
            }
        }

        res.json({
            registered: true,
            allowed,
            visibility: device.visibility,
            monthly_energy: monthlyEnergy,
            device: allowed ? {
                id: device.id,
                device_id: device.device_id,
                name: device.name,
                location: device.location,
                visibility: device.visibility,
                owner_id: device.owner_id,
                owner_name: device.owner_name,
                electricity_rate: device.electricity_rate != null ? Number(Number(device.electricity_rate).toFixed(2)) : 0.00,
                currency: device.currency || 'IDR',
                voltage: device.voltage != null ? Number(Number(device.voltage).toFixed(1)) : 220.0,
                ch1_label: device.ch1_label || 'Channel 1',
                ch2_label: device.ch2_label || 'Channel 2',
                ch3_label: device.ch3_label || 'Channel 3',
                ch4_label: device.ch4_label || 'Channel 4'
            } : {
                device_id: device.device_id,
                name: `Private Device (${device.device_id.toUpperCase()})`,
                location: 'Hidden (Private)',
                visibility: 'private'
            }
        });
    } catch (err) {
        console.error('[API Check Access Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/devices
app.post('/api/devices', authenticateToken, async (req, res) => {
    try {
        const { device_id, name, location, visibility, electricity_rate, currency, voltage, ch1_label, ch2_label, ch3_label, ch4_label } = req.body;
        if (!device_id || !name || !location) {
            return res.status(400).json({ error: 'Device ID, Name, and Location are required' });
        }

        const normalizedDeviceId = device_id.toLowerCase().trim();
        const validVisibility = visibility === 'private' ? 'private' : 'public';
        const validRate = (electricity_rate !== undefined && electricity_rate !== null && !isNaN(parseFloat(electricity_rate)))
            ? Math.round(parseFloat(electricity_rate) * 100) / 100
            : 0.00;
        const validCurrency = (currency && String(currency).toUpperCase() === 'USD') ? 'USD' : 'IDR';
        const validVoltage = (voltage !== undefined && voltage !== null && !isNaN(parseFloat(voltage)) && parseFloat(voltage) > 0)
            ? Math.round(parseFloat(voltage) * 10) / 10
            : 220.0;
        const validCh1 = (ch1_label && String(ch1_label).trim()) ? String(ch1_label).trim() : 'Channel 1';
        const validCh2 = (ch2_label && String(ch2_label).trim()) ? String(ch2_label).trim() : 'Channel 2';
        const validCh3 = (ch3_label && String(ch3_label).trim()) ? String(ch3_label).trim() : 'Channel 3';
        const validCh4 = (ch4_label && String(ch4_label).trim()) ? String(ch4_label).trim() : 'Channel 4';

        const existing = await queryGet(`SELECT * FROM devices WHERE LOWER(device_id) = ?`, [normalizedDeviceId]);
        if (existing) {
            if (existing.owner_id && existing.owner_id !== req.user.id && req.user.role !== 'admin') {
                return res.status(409).json({ error: 'Device ID is already registered to another user' });
            }
            await queryRun(`
                UPDATE devices SET name = ?, location = ?, visibility = ?, owner_id = ?, electricity_rate = ?, currency = ?, voltage = ?,
                                   ch1_label = ?, ch2_label = ?, ch3_label = ?, ch4_label = ?
                WHERE id = ?
            `, [name, location, validVisibility, req.user.id, validRate, validCurrency, validVoltage, validCh1, validCh2, validCh3, validCh4, existing.id]);

            invalidateDeviceConfig(normalizedDeviceId);

            return res.json({
                message: 'Device updated successfully',
                deviceId: existing.id,
                electricity_rate: validRate,
                currency: validCurrency,
                voltage: validVoltage,
                ch1_label: validCh1,
                ch2_label: validCh2,
                ch3_label: validCh3,
                ch4_label: validCh4
            });
        }

        const result = await queryRun(`
            INSERT INTO devices (device_id, name, location, visibility, owner_id, electricity_rate, currency, voltage, ch1_label, ch2_label, ch3_label, ch4_label)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [normalizedDeviceId, name, location, validVisibility, req.user.id, validRate, validCurrency, validVoltage, validCh1, validCh2, validCh3, validCh4]);

        invalidateDeviceConfig(normalizedDeviceId);

        res.status(201).json({
            message: 'Device registered successfully',
            device: {
                id: result.lastID,
                device_id: normalizedDeviceId,
                name,
                location,
                visibility: validVisibility,
                owner_id: req.user.id,
                electricity_rate: validRate,
                currency: validCurrency,
                voltage: validVoltage,
                ch1_label: validCh1,
                ch2_label: validCh2,
                ch3_label: validCh3,
                ch4_label: validCh4
            }
        });
    } catch (err) {
        console.error('[API Device Post Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/devices/:id
app.put('/api/devices/:id', authenticateToken, async (req, res) => {
    try {
        const deviceId = req.params.id;
        const { name, location, visibility, owner_id, electricity_rate, currency, voltage, ch1_label, ch2_label, ch3_label, ch4_label } = req.body;

        const device = await queryGet(`SELECT * FROM devices WHERE id = ?`, [deviceId]);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        if (req.user.role !== 'admin' && device.owner_id !== req.user.id) {
            return res.status(403).json({ error: 'Unauthorized to modify this device' });
        }

        const newName = name || device.name;
        const newLocation = location || device.location;
        const newVisibility = visibility ? (visibility === 'private' ? 'private' : 'public') : device.visibility;
        let newOwnerId = device.owner_id;
        if (req.user.role === 'admin' && owner_id !== undefined) {
            newOwnerId = owner_id;
        }

        let newRate = device.electricity_rate != null ? Number(device.electricity_rate) : 0.00;
        if (electricity_rate !== undefined && electricity_rate !== null && !isNaN(parseFloat(electricity_rate))) {
            newRate = Math.round(parseFloat(electricity_rate) * 100) / 100;
        }

        let newCurrency = device.currency || 'IDR';
        if (currency !== undefined && currency !== null) {
            newCurrency = String(currency).toUpperCase() === 'USD' ? 'USD' : 'IDR';
        }

        let newVoltage = device.voltage != null ? Number(device.voltage) : 220.0;
        if (voltage !== undefined && voltage !== null && !isNaN(parseFloat(voltage)) && parseFloat(voltage) > 0) {
            newVoltage = Math.round(parseFloat(voltage) * 10) / 10;
        }

        const newCh1 = (ch1_label !== undefined && ch1_label !== null && String(ch1_label).trim()) ? String(ch1_label).trim() : (device.ch1_label || 'Channel 1');
        const newCh2 = (ch2_label !== undefined && ch2_label !== null && String(ch2_label).trim()) ? String(ch2_label).trim() : (device.ch2_label || 'Channel 2');
        const newCh3 = (ch3_label !== undefined && ch3_label !== null && String(ch3_label).trim()) ? String(ch3_label).trim() : (device.ch3_label || 'Channel 3');
        const newCh4 = (ch4_label !== undefined && ch4_label !== null && String(ch4_label).trim()) ? String(ch4_label).trim() : (device.ch4_label || 'Channel 4');

        await queryRun(`
            UPDATE devices SET name = ?, location = ?, visibility = ?, owner_id = ?, electricity_rate = ?, currency = ?, voltage = ?,
                               ch1_label = ?, ch2_label = ?, ch3_label = ?, ch4_label = ?
            WHERE id = ?
        `, [newName, newLocation, newVisibility, newOwnerId, newRate, newCurrency, newVoltage, newCh1, newCh2, newCh3, newCh4, deviceId]);

        invalidateDeviceConfig(device.device_id);

        if (req.user.role === 'admin') {
            await logAdminAction(req, 'UPDATE_DEVICE', 'device', deviceId, `name=${newName}, visibility=${newVisibility}, rate=${newRate}, currency=${newCurrency}, voltage=${newVoltage}`);
        }

        res.json({
            message: 'Device updated successfully',
            electricity_rate: newRate,
            currency: newCurrency,
            voltage: newVoltage,
            ch1_label: newCh1,
            ch2_label: newCh2,
            ch3_label: newCh3,
            ch4_label: newCh4
        });
    } catch (err) {
        console.error('[API Device Put Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/devices/:id
app.delete('/api/devices/:id', authenticateToken, async (req, res) => {
    try {
        const deviceId = req.params.id;
        const device = await queryGet(`SELECT * FROM devices WHERE id = ?`, [deviceId]);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        if (req.user.role !== 'admin' && device.owner_id !== req.user.id) {
            return res.status(403).json({ error: 'Unauthorized to delete this device' });
        }

        await queryRun(`DELETE FROM devices WHERE id = ?`, [deviceId]);

        if (req.user.role === 'admin') {
            await logAdminAction(req, 'DELETE_DEVICE', 'device', deviceId, `device_id=${device.device_id}`);
        }

        res.json({ message: 'Device deleted successfully' });
    } catch (err) {
        console.error('[API Device Delete Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// -------------------------------------------------------------------
// 3.4 TELEMETRY HISTORICAL DATA (DUCKDB ENGINE)
// -------------------------------------------------------------------

// GET /api/telemetry/history
app.get('/api/telemetry/history', optionalToken, async (req, res) => {
    try {
        const { device_id, start, end, resolution, agg } = req.query;
        if (!device_id) {
            return res.status(400).json({ error: 'device_id query parameter is required' });
        }

        const cleanDeviceId = String(device_id).toLowerCase().trim().replace(/^cu100_/, '');
        const prefixDeviceId = 'cu100_' + cleanDeviceId;

        const dev = await queryGet(`SELECT visibility, owner_id FROM devices WHERE LOWER(device_id) = ? OR LOWER(device_id) = ?`, [cleanDeviceId, prefixDeviceId]);
        if (dev && dev.visibility === 'private') {
            if (!req.user || (req.user.role !== 'admin' && req.user.id !== dev.owner_id)) {
                return res.status(403).json({ error: 'Unauthorized to view telemetry history for this private device' });
            }
        }

        const now = Date.now();
        const endD = safeParseDate(end, new Date(now));
        const endTime = (endD && !isNaN(endD.getTime())) ? endD.getTime() : now;

        const startD = safeParseDate(start, new Date(endTime - 24 * 60 * 60 * 1000));
        let startTime = (startD && !isNaN(startD.getTime())) ? startD.getTime() : (endTime - 24 * 60 * 60 * 1000);

        let finalEnd = endTime;
        if (startTime > finalEnd) {
            const tmp = startTime;
            startTime = finalEnd;
            finalEnd = tmp;
        }

        const resBucket = resolution || 'raw';
        const aggMode = ['avg', 'max'].includes(String(agg).toLowerCase()) ? String(agg).toLowerCase() : 'avg';

        const history = await getTelemetryHistory(cleanDeviceId, startTime, finalEnd, resBucket, aggMode);
        
        let bounds = null;
        if (history.length === 0) {
            bounds = await getDeviceTelemetryBounds(cleanDeviceId);
        }

        res.json({
            device_id: cleanDeviceId,
            count: history.length,
            start: startTime,
            end: finalEnd,
            resolution: resBucket,
            aggregation: aggMode,
            data: history,
            bounds: bounds
        });
    } catch (err) {
        console.error('[API Telemetry History Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/devices/:deviceId/monthly-energy
app.get('/api/devices/:deviceId/monthly-energy', optionalToken, async (req, res) => {
    try {
        const deviceId = req.params.deviceId.toLowerCase().trim().replace(/^cu100_/, '');
        const dev = await queryGet(`SELECT visibility, owner_id FROM devices WHERE LOWER(device_id) = ?`, [deviceId]);

        if (dev && dev.visibility === 'private') {
            if (!req.user || (req.user.role !== 'admin' && req.user.id !== dev.owner_id)) {
                return res.status(403).json({ error: 'Unauthorized to view monthly energy for this private device' });
            }
        }

        const data = await getDeviceMonthlyEnergy(deviceId);
        res.json(data);
    } catch (err) {
        console.error('[API Monthly Energy Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/telemetry/monthly?deviceId=...
app.get('/api/telemetry/monthly', optionalToken, async (req, res) => {
    try {
        const deviceId = (req.query.deviceId || '').toLowerCase().trim().replace(/^cu100_/, '');
        if (!deviceId) return res.status(400).json({ error: 'deviceId query param is required' });

        const dev = await queryGet(`SELECT visibility, owner_id FROM devices WHERE LOWER(device_id) = ?`, [deviceId]);
        if (dev && dev.visibility === 'private') {
            if (!req.user || (req.user.role !== 'admin' && req.user.id !== dev.owner_id)) {
                return res.status(403).json({ error: 'Unauthorized to view monthly energy for this private device' });
            }
        }

        const data = await getDeviceMonthlyEnergy(deviceId);
        res.json(data);
    } catch (err) {
        console.error('[API Telemetry Monthly Error]:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// -------------------------------------------------------------------
// 3.45 DEVICE QR CODE & LABEL GENERATION
// -------------------------------------------------------------------

// GET /api/devices/:deviceId/qrcode
// Generates QR code containing https://dashboard.currentusage.com/?device=<deviceId>
app.get('/api/devices/:deviceId/qrcode', optionalToken, async (req, res) => {
    try {
        const rawId = (req.params.deviceId || '').trim().toLowerCase();
        const deviceId = rawId.replace(/^cu100_/, '');
        if (!deviceId) {
            return res.status(400).json({ error: 'Valid device ID is required' });
        }

        const baseUrl = getBaseUrl(req);
        const targetUrl = `${baseUrl}/?device=${deviceId}`;
        const format = (req.query.format || 'json').toLowerCase();
        const size = Math.min(Math.max(parseInt(req.query.size, 10) || 320, 64), 1024);
        const margin = parseInt(req.query.margin, 10) || 2;

        if (format === 'png') {
            const buffer = await QRCode.toBuffer(targetUrl, {
                type: 'png',
                width: size,
                margin: margin,
                errorCorrectionLevel: 'M',
                color: { dark: '#000000', light: '#ffffff' }
            });
            if (req.query.download === '1' || req.query.download === 'true') {
                res.setHeader('Content-Disposition', `attachment; filename="qrcode-${deviceId}.png"`);
            }
            res.setHeader('Content-Type', 'image/png');
            return res.send(buffer);
        }

        if (format === 'svg') {
            const svgString = await QRCode.toString(targetUrl, {
                type: 'svg',
                width: size,
                margin: margin,
                errorCorrectionLevel: 'M',
                color: { dark: '#000000', light: '#ffffff' }
            });
            if (req.query.download === '1' || req.query.download === 'true') {
                res.setHeader('Content-Disposition', `attachment; filename="qrcode-${deviceId}.svg"`);
            }
            res.setHeader('Content-Type', 'image/svg+xml');
            return res.send(svgString);
        }

        // Default: JSON response with base64 dataUrl, SVG, and device metadata
        const dataUrl = await QRCode.toDataURL(targetUrl, {
            width: size,
            margin: margin,
            errorCorrectionLevel: 'M',
            color: { dark: '#000000', light: '#ffffff' }
        });
        const svgString = await QRCode.toString(targetUrl, {
            type: 'svg',
            width: size,
            margin: margin,
            errorCorrectionLevel: 'M',
            color: { dark: '#000000', light: '#ffffff' }
        });

        const device = await queryGet(`
            SELECT id, device_id, name, location, voltage, visibility, electricity_rate, currency, created_at
            FROM devices
            WHERE LOWER(device_id) = ?
        `, [deviceId]);

        res.json({
            device_id: deviceId,
            url: targetUrl,
            dataUrl,
            svg: svgString,
            device: device || null
        });
    } catch (err) {
        console.error('[API QRCode Error]:', err);
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// GET /api/devices-qrcodes
// Batch QR code generator for user's registered devices (or all devices if admin)
app.get('/api/devices-qrcodes', authenticateToken, async (req, res) => {
    try {
        let devices;
        if (req.user.role === 'admin') {
            devices = await queryAll(`
                SELECT d.id, d.device_id, d.name, d.location, d.voltage, d.visibility, d.electricity_rate, d.currency, d.created_at,
                       u.username AS owner_name
                FROM devices d
                LEFT JOIN users u ON u.id = d.owner_id
                ORDER BY d.created_at DESC
            `);
        } else {
            devices = await queryAll(`
                SELECT id, device_id, name, location, voltage, visibility, electricity_rate, currency, created_at
                FROM devices
                WHERE owner_id = ?
                ORDER BY created_at DESC
            `, [req.user.id]);
        }

        const baseUrl = getBaseUrl(req);
        const items = await Promise.all(devices.map(async (d) => {
            const cleanId = d.device_id.toLowerCase().replace(/^cu100_/, '');
            const targetUrl = `${baseUrl}/?device=${cleanId}`;
            const dataUrl = await QRCode.toDataURL(targetUrl, {
                width: 250,
                margin: 2,
                errorCorrectionLevel: 'M',
                color: { dark: '#000000', light: '#ffffff' }
            });
            const svg = await QRCode.toString(targetUrl, {
                type: 'svg',
                width: 250,
                margin: 2,
                errorCorrectionLevel: 'M',
                color: { dark: '#000000', light: '#ffffff' }
            });
            return {
                ...d,
                url: targetUrl,
                dataUrl,
                svg
            };
        }));

        res.json({ devices: items });
    } catch (err) {
        console.error('[API Batch QRCode Error]:', err);
        res.status(500).json({ error: 'Failed to generate batch QR codes' });
    }
});

// -------------------------------------------------------------------
// 3.5 MOSQUITTO & NANOMQ HTTP AUTHENTICATION WEBHOOKS
// -------------------------------------------------------------------

// SECURITY FIX #3: bcrypt.compare for MQTT password verification
async function verifyMqttUser(username, password) {
    // 1. Allow Server Bridge Admin (plain comparison for internal bridge only)
    if (MQTT_USER && username === MQTT_USER && password === MQTT_PASS) {
        return { allowed: true, isSuperuser: true };
    }

    // 2. Lookup device owner by mqtt_user
    const user = await queryGet(`SELECT id, username, mqtt_pass, mqtt_pass_hash FROM users WHERE mqtt_user = ?`, [username]);
    if (!user) return { allowed: false };

    // 3. Check bcrypt hash first (new method), fall back to plaintext (legacy migration)
    if (user.mqtt_pass_hash) {
        const valid = bcrypt.compareSync(password, user.mqtt_pass_hash);
        return { allowed: valid, isSuperuser: false, user };
    } else if (user.mqtt_pass) {
        // Legacy plaintext — still works during migration period
        const valid = (password === user.mqtt_pass);
        return { allowed: valid, isSuperuser: false, user };
    }

    return { allowed: false };
}

// 1. Mosquitto User Authentication
const handleMosquittoUserAuth = async (req, res) => {
    try {
        const username = req.body.username;
        const password = req.body.password;

        if (!username || !password || String(username).trim() === '' || String(password).trim() === '') {
            console.log(`[Mosquitto Auth] Anonymous/missing credentials -> DENIED`);
            return res.status(400).send('Denied');
        }

        const result = await verifyMqttUser(username, password);
        if (result.allowed) {
            console.log(`[Mosquitto Auth] '${username}' -> ALLOWED`);
            return res.status(200).send('OK');
        }

        console.warn(`[Mosquitto Auth] Invalid credentials for '${username}' -> DENIED`);
        return res.status(400).send('Denied');
    } catch (err) {
        console.error('[Mosquitto User Auth Error]:', err);
        return res.status(500).send('Error');
    }
};

app.post('/api/mosquitto/user', handleMosquittoUserAuth);
app.post('/api/auth/user', handleMosquittoUserAuth);

// 2. Mosquitto Superuser Check
const handleMosquittoSuperuser = async (req, res) => {
    try {
        const username = req.body.username;
        if (!username) return res.status(400).send('Denied');

        if (MQTT_USER && username === MQTT_USER) {
            return res.status(200).send('OK');
        }

        const user = await queryGet(`SELECT role FROM users WHERE mqtt_user = ? OR username = ?`, [username, username]);
        if (user && user.role === 'admin') {
            return res.status(200).send('OK');
        }

        return res.status(400).send('Denied');
    } catch (err) {
        return res.status(400).send('Denied');
    }
};

app.post('/api/mosquitto/superuser', handleMosquittoSuperuser);
app.post('/api/auth/superuser', handleMosquittoSuperuser);

// 3. Mosquitto ACL Authorization
const handleMosquittoAcl = async (req, res) => {
    try {
        const { username, topic, acc } = req.body;
        if (!username || !topic) return res.status(400).send('Denied');

        if (MQTT_USER && username === MQTT_USER) {
            return res.status(200).send('OK');
        }

        const user = await queryGet(`SELECT id, role FROM users WHERE mqtt_user = ? OR username = ?`, [username, username]);
        if (user && user.role === 'admin') {
            return res.status(200).send('OK');
        }

        const parts = topic.split('/');
        if (parts.length >= 1 && parts[0].toLowerCase() === 'cu100') {
            if (parts.length === 1 || parts[1] === '#' || parts[1] === '+') {
                return res.status(200).send('OK');
            }

            const serial = parts[1].toLowerCase();
            const device = await queryGet(`SELECT owner_id, visibility FROM devices WHERE LOWER(device_id) = ?`, [serial]);

            if (!device) {
                return res.status(200).send('OK');
            }

            if (user && device.owner_id === user.id) {
                return res.status(200).send('OK');
            }

            if (device.visibility === 'public' && parseInt(acc, 10) === 1) {
                return res.status(200).send('OK');
            }
        }

        console.warn(`[Mosquitto ACL] User '${username}' denied access to topic '${topic}'`);
        return res.status(400).send('Denied');
    } catch (err) {
        console.error('[Mosquitto ACL Error]:', err);
        return res.status(500).send('Error');
    }
};

app.post('/api/mosquitto/acl', handleMosquittoAcl);
app.post('/api/auth/acl', handleMosquittoAcl);

// 4. NanoMQ Single-Endpoint Auth
const handleSingleEndpointAuth = async (req, res) => {
    try {
        const username = req.body.username;
        const password = req.body.password;

        if (!username || !password || String(username).trim() === '' || String(password).trim() === '') {
            return res.status(200).json({ result: 'deny' });
        }

        const result = await verifyMqttUser(username, password);
        if (result.allowed) {
            return res.status(200).json({ result: 'allow', is_superuser: result.isSuperuser || false });
        }

        return res.status(200).json({ result: 'deny' });
    } catch (err) {
        console.error('[API HTTP Auth Error]:', err);
        return res.status(200).json({ result: 'deny' });
    }
};

app.post('/api/nanomq/auth', handleSingleEndpointAuth);
app.post('/api/mosquitto/auth', handleSingleEndpointAuth);

// -------------------------------------------------------------------
// 4. STATIC FILE SERVING & SECURITY BLOCKS
// -------------------------------------------------------------------
// SECURITY FIX #8: Extended blocklist covering all backend source files and database files
app.use((req, res, next) => {
    const filePath = req.path.toLowerCase();
    if (
        filePath === '/server.js' ||
        filePath === '/db.js' ||
        filePath === '/telemetry_db.js' ||      // was missing — backend module
        filePath.endsWith('.db') ||
        filePath.endsWith('.duckdb') ||          // was missing — DuckDB data file
        filePath.endsWith('.duckdb.wal') ||      // was missing — DuckDB WAL file
        filePath === '/package.json' ||
        filePath === '/package-lock.json' ||
        filePath.includes('.env') ||
        filePath.startsWith('/node_modules')
    ) {
        console.warn(`[Security] Blocked access to backend file: ${req.path} from ${req.ip}`);
        return res.status(403).send('Forbidden: Access Denied');
    }
    next();
});

// Dedicated Admin Back-Office Route
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Dedicated Password Reset Route
app.get('/reset-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'reset-password.html'));
});

// Dedicated Landing Page Route & Assets (from dedicated landing-page/ folder)
const LANDING_PAGE_DIR = path.join(__dirname, '..', 'landing-page');
app.use('/landing', express.static(LANDING_PAGE_DIR));
app.get('/landing', (req, res) => {
    res.sendFile(path.join(LANDING_PAGE_DIR, 'index.html'));
});

app.use(express.static(__dirname));

// Fallback route for SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// -------------------------------------------------------------------
// 5. WEBSOCKET TO MQTT BRIDGE WITH PRIVACY ENFORCEMENT
// -------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/mqtt' });

console.log(`[Bridge] Initializing WebSocket-to-TCP MQTT Bridge...`);
console.log(`[Bridge] Target Broker: mqtt://${MQTT_BROKER_HOST}:${MQTT_BROKER_PORT}`);

// Helper: parse cookie header string into a map
function parseCookieHeader(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(';').forEach(part => {
        const [key, ...valParts] = part.trim().split('=');
        if (key) cookies[key.trim()] = decodeURIComponent(valParts.join('='));
    });
    return cookies;
}

// -------------------------------------------------------------------
// 5. SERVER-LEVEL PERSISTENT MQTT CLIENT FOR CONTINUOUS TELEMETRY INGESTION
// -------------------------------------------------------------------
const serverMqttOpts = {
    clientId: 'cu100_server_ingest_' + Math.random().toString(16).substring(2, 8),
    keepalive: 30,
    reconnectPeriod: 3000
};
if (MQTT_USER) serverMqttOpts.username = MQTT_USER;
if (MQTT_PASS) serverMqttOpts.password = MQTT_PASS;

const serverMqttClient = mqtt.connect(`mqtt://${MQTT_BROKER_HOST}:${MQTT_BROKER_PORT}`, serverMqttOpts);

serverMqttClient.on('connect', () => {
    console.log(`[Server Ingest] Persistent MQTT telemetry connection established to ${MQTT_BROKER_HOST}:${MQTT_BROKER_PORT}`);
    serverMqttClient.subscribe('cu100/#', (err) => {
        if (err) console.error('[Server Ingest] Failed to subscribe to cu100/#:', err.message);
        else console.log('[Server Ingest] Subscribed to cu100/# (24/7 background telemetry ingestion active)');
    });
});

serverMqttClient.on('error', (err) => {
    console.error('[Server Ingest MQTT Error]:', err.message);
});

serverMqttClient.on('message', async (topic, message) => {
    const parts = topic.split('/');
    if (parts.length >= 2) {
        const rawSerial = parts[1].toLowerCase();
        const subTopic = parts[2] ? parts[2].toLowerCase() : 'state';

        if (subTopic === 'state') {
            try {
                const payloadObj = JSON.parse(message.toString());

                const i_rms1 = payloadObj.current_ch1 !== undefined ? payloadObj.current_ch1 : (payloadObj.i_rms1 || (payloadObj.currents ? payloadObj.currents[0] : 0));
                const i_rms2 = payloadObj.current_ch2 !== undefined ? payloadObj.current_ch2 : (payloadObj.i_rms2 || (payloadObj.currents ? payloadObj.currents[1] : 0));
                const i_rms3 = payloadObj.current_ch3 !== undefined ? payloadObj.current_ch3 : (payloadObj.i_rms3 || (payloadObj.currents ? payloadObj.currents[2] : 0));
                const i_rms4 = payloadObj.current_ch4 !== undefined ? payloadObj.current_ch4 : (payloadObj.i_rms4 || (payloadObj.currents ? payloadObj.currents[3] : 0));

                const temp = payloadObj.temperature !== undefined ? payloadObj.temperature : (payloadObj.temp || 0);
                const ts = payloadObj.ts ? payloadObj.ts * 1000 : Date.now();

                // Cloud-calculated power & monthly energy accumulation (firmware kwh_ch1..4 is ignored)
                const energyRes = await processTelemetryEnergy(rawSerial, [i_rms1, i_rms2, i_rms3, i_rms4], ts);

                enqueueTelemetry({
                    device_id: rawSerial,
                    timestamp: ts,
                    v_rms: energyRes.voltage,
                    i_rms1: energyRes.current_ch1,
                    i_rms2: energyRes.current_ch2,
                    i_rms3: energyRes.current_ch3,
                    i_rms4: energyRes.current_ch4,
                    p_active: energyRes.p_active,
                    temp: Number(temp) || 0
                });
            } catch (e) {
                // Ignore non-JSON telemetry payloads
            }
        }
    }
});

wss.on('connection', (ws, req) => {
    console.log('[Bridge] Browser client connected to WebSocket endpoint.');

    // SECURITY FIX #9: Read token from HttpOnly cookie in the HTTP upgrade request
    // (browser sends cookies automatically with the WS upgrade request)
    const cookies = parseCookieHeader(req.headers.cookie || '');
    const cookieToken = cookies[COOKIE_NAME] || null;

    // Transitional fallback: also accept URL query param (kept for backward compat only)
    const urlParams = new URLSearchParams(req.url.replace(/^\/mqtt\??/, ''));
    const urlToken = urlParams.get('token');

    const token = cookieToken || urlToken;
    let wsUser = null;
    if (token) {
        try {
            wsUser = jwt.verify(token, JWT_SECRET);
        } catch (e) {
            // Invalid token — proceed as anonymous (read-only for public devices)
        }
    }

    // Connect to MQTT Broker
    const mqttOpts = {
        clientId: 'bridge_' + Math.random().toString(16).substring(2, 8),
        keepalive: 30,
        reconnectPeriod: 3000
    };
    if (MQTT_USER) mqttOpts.username = MQTT_USER;
    if (MQTT_PASS) mqttOpts.password = MQTT_PASS;

    const mqttClient = mqtt.connect(`mqtt://${MQTT_BROKER_HOST}:${MQTT_BROKER_PORT}`, mqttOpts);

    mqttClient.on('connect', () => {
        console.log(`[Bridge] TCP MQTT connection established to ${MQTT_BROKER_HOST}:${MQTT_BROKER_PORT}`);
        mqttClient.subscribe('cu100/#');
    });

    mqttClient.on('message', async (topic, message) => {
        const parts = topic.split('/');

        // 2. Forward message to active WebSocket browser clients if authorized
        if (ws.readyState === WebSocket.OPEN) {
            if (parts.length >= 2) {
                const serial = parts[1].toLowerCase();
                const subTopic = parts[2] ? parts[2].toLowerCase() : 'state';

                try {
                    const dev = await queryGet(`SELECT visibility, owner_id FROM devices WHERE LOWER(device_id) = ?`, [serial]);
                    if (dev && dev.visibility === 'private') {
                        if (!wsUser || (wsUser.role !== 'admin' && wsUser.id !== dev.owner_id)) {
                            return;
                        }
                    }
                } catch (err) {
                    // ignore DB error
                }

                // If state telemetry message, enrich with cloud-calculated power & monthly kWh
                if (subTopic === 'state') {
                    try {
                        const payloadObj = JSON.parse(message.toString());
                        const i_rms1 = payloadObj.current_ch1 !== undefined ? payloadObj.current_ch1 : (payloadObj.i_rms1 || (payloadObj.currents ? payloadObj.currents[0] : 0));
                        const i_rms2 = payloadObj.current_ch2 !== undefined ? payloadObj.current_ch2 : (payloadObj.i_rms2 || (payloadObj.currents ? payloadObj.currents[1] : 0));
                        const i_rms3 = payloadObj.current_ch3 !== undefined ? payloadObj.current_ch3 : (payloadObj.i_rms3 || (payloadObj.currents ? payloadObj.currents[2] : 0));
                        const i_rms4 = payloadObj.current_ch4 !== undefined ? payloadObj.current_ch4 : (payloadObj.i_rms4 || (payloadObj.currents ? payloadObj.currents[3] : 0));
                        const ts = payloadObj.ts ? payloadObj.ts * 1000 : Date.now();

                        const energyRes = await processTelemetryEnergy(serial, [i_rms1, i_rms2, i_rms3, i_rms4], ts);

                        const cleanPayload = {
                            ...payloadObj,
                            voltage: energyRes.voltage,
                            power_ch1: energyRes.power_ch1,
                            power_ch2: energyRes.power_ch2,
                            power_ch3: energyRes.power_ch3,
                            power_ch4: energyRes.power_ch4,
                            p_active: energyRes.p_active,
                            // Replace firmware kwh with cloud-calculated monthly kWh
                            kwh_ch1: energyRes.kwh_ch1,
                            kwh_ch2: energyRes.kwh_ch2,
                            kwh_ch3: energyRes.kwh_ch3,
                            kwh_ch4: energyRes.kwh_ch4,
                            kwh_total: energyRes.kwh_total,
                            cost_total: energyRes.cost_total,
                            currency: energyRes.currency,
                            year_month: energyRes.year_month
                        };
                        delete cleanPayload.kwh; // Remove any raw array from firmware

                        ws.send(JSON.stringify({
                            topic: topic,
                            payload: JSON.stringify(cleanPayload)
                        }));
                        return;
                    } catch (e) {
                        // ignore and fall through
                    }
                }
            }

            const payload = JSON.stringify({
                topic: topic,
                payload: message.toString()
            });
            ws.send(payload);
        }
    });

    // SECURITY FIX #4: Gate WebSocket publishing — require auth + device ownership
    ws.on('message', async (data) => {
        try {
            const parsed = JSON.parse(data);
            if (!parsed.topic || !parsed.payload) return;

            // Reject publish from unauthenticated clients
            if (!wsUser) {
                console.warn('[Bridge] Unauthenticated WS publish attempt blocked.');
                return;
            }

            // Validate topic format: must be cu100/<serial>/...
            const parts = parsed.topic.split('/');
            if (parts.length < 2 || parts[0].toLowerCase() !== 'cu100') {
                console.warn(`[Bridge] User '${wsUser.username}' blocked: invalid topic format '${parsed.topic}'`);
                return;
            }

            const serial = parts[1].toLowerCase();

            // Admins can publish to any topic; regular users only to their own devices
            if (wsUser.role !== 'admin') {
                const device = await queryGet(`SELECT owner_id FROM devices WHERE LOWER(device_id) = ?`, [serial]);
                if (!device || device.owner_id !== wsUser.id) {
                    console.warn(`[Bridge] User '${wsUser.username}' blocked from publishing to unowned device '${serial}'`);
                    return;
                }
            }

            mqttClient.publish(parsed.topic, String(parsed.payload));
        } catch (e) {
            // Ignore non-JSON control frames
        }
    });

    ws.on('close', () => {
        console.log('[Bridge] Browser client disconnected.');
        mqttClient.end(true);
    });

    ws.on('error', (err) => {
        console.error('[Bridge WS Error]:', err.message);
        mqttClient.end(true);
    });
});

// -------------------------------------------------------------------
// 6. AUTOMATED TELEMETRY DATA RETENTION CLEANUP JOB
// -------------------------------------------------------------------
async function runRetentionCleanupJob() {
    try {
        console.log('[Retention Job] Running scheduled per-device owner telemetry cleanup...');
        const deviceRules = await queryAll(`
            SELECT d.device_id, COALESCE(u.retention_period, '7d') AS retention_period
            FROM devices d
            LEFT JOIN users u ON u.id = d.owner_id
        `);
        await purgeExpiredTelemetry(deviceRules);
        console.log(`[Retention Job] Telemetry cleanup completed successfully.`);
    } catch (err) {
        console.error('[Retention Job Error]:', err);
    }
}

// Schedule daily retention cleanup (runs 5s after startup, then every 24h)
setTimeout(() => {
    runRetentionCleanupJob();
    setInterval(runRetentionCleanupJob, 24 * 60 * 60 * 1000);
}, 5000);

server.listen(HTTP_PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 CU100 Cloud Energy Monitor Server Running!`);
    console.log(`👉 Access URL: http://localhost:${HTTP_PORT}/`);
    console.log(`📡 Connected to TCP MQTT: ${MQTT_BROKER_HOST}:${MQTT_BROKER_PORT}`);
    console.log(`=======================================================`);
});
