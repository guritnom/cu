const nodemailer = require('nodemailer');

/**
 * Returns whether custom SMTP credentials are provided in environment
 */
function isSmtpConfigured() {
    const user = process.env.SMTP_USER || process.env.MAILJET_API_KEY;
    const pass = process.env.SMTP_PASS || process.env.MAILJET_SECRET_KEY;
    return Boolean(user && pass);
}

/**
 * Creates and returns a Nodemailer transporter configured for Mailjet / custom SMTP
 */
function createTransporter(overrides = {}) {
    let host = (overrides.host || process.env.SMTP_HOST || 'in-v3.mailjet.com').trim();
    // Auto-correct common typo in-v.mailjet.com to official in-v3.mailjet.com
    if (host === 'in-v.mailjet.com') {
        host = 'in-v3.mailjet.com';
    }
    const port = overrides.port !== undefined ? overrides.port : parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = overrides.secure !== undefined ? overrides.secure : (process.env.SMTP_SECURE === 'true' || port === 465);
    const user = process.env.SMTP_USER || process.env.MAILJET_API_KEY;
    const pass = process.env.SMTP_PASS || process.env.MAILJET_SECRET_KEY;

    if (!user || !pass) {
        return null;
    }

    return nodemailer.createTransport({
        host,
        port,
        secure,
        auth: {
            user: user.trim(),
            pass: pass.trim()
        },
        // Fast timeouts so connection issues fail over quickly instead of hanging
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 10000,
        tls: {
            rejectUnauthorized: process.env.NODE_ENV === 'production'
        }
    });
}

/**
 * Direct HTTPS API fallback for Mailjet when outbound SMTP ports are blocked by ISP/firewall
 */
async function sendViaMailjetApi({ toEmail, username, subject, textContent, htmlContent, fromEmail, fromName }) {
    const user = process.env.SMTP_USER || process.env.MAILJET_API_KEY;
    const pass = process.env.SMTP_PASS || process.env.MAILJET_SECRET_KEY;
    if (!user || !pass) {
        throw new Error('Mailjet API credentials missing');
    }

    const auth = Buffer.from(`${user.trim()}:${pass.trim()}`).toString('base64');
    const payload = {
        Messages: [
            {
                From: {
                    Email: fromEmail,
                    Name: fromName
                },
                To: [
                    {
                        Email: toEmail,
                        Name: username || 'User'
                    }
                ],
                Subject: subject || `${fromName}: Password Reset Request`,
                TextPart: textContent,
                HTMLPart: htmlContent
            }
        ]
    };

    const res = await fetch('https://api.mailjet.com/v3.1/send', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${auth}`
        },
        body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        const detail = data.ErrorMessage || 
                       (data.Messages && data.Messages[0]?.Errors?.map(e => e.ErrorMessage).join('; ')) || 
                       `HTTP ${res.status}`;
        throw new Error(detail);
    }

    const messageId = data.Messages?.[0]?.To?.[0]?.MessageID || 'API-' + Date.now();
    return { success: true, messageId };
}

/**
 * Sends a password reset email via custom SMTP with automatic failover to alternative ports/API
 */
async function sendPasswordResetEmail({ toEmail, username, resetUrl, role = 'user' }) {
    const brandName = (process.env.APP_NAME || process.env.BRAND_NAME || process.env.SMTP_FROM_NAME || 'CurrentUsage').trim();
    const fromName = (process.env.SMTP_FROM_NAME || brandName).trim();
    const fromEmail = (process.env.SMTP_FROM || process.env.MAILJET_FROM_EMAIL || 'noreply@currentusage.com').trim();
    const subject = `${brandName}: Password Reset Request`;

    const textContent = `
${brandName} — Password Reset Request

Hello ${username || 'there'},

We received a request to reset the password for your ${brandName} account.

To reset your password, open the link below in your browser:
${resetUrl}

This link will expire in 1 hour.

If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.

— ${brandName} Team
`.trim();

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #0b0f19;
      color: #e2e8f0;
    }
    .wrapper {
      width: 100%;
      background-color: #0b0f19;
      padding: 40px 15px;
    }
    .card {
      max-width: 540px;
      margin: 0 auto;
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }
    .header {
      padding: 32px 32px 24px 32px;
      text-align: center;
      background: linear-gradient(180deg, rgba(99, 102, 241, 0.15) 0%, rgba(17, 24, 39, 0) 100%);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .brand-title {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.5px;
      color: #ffffff;
      margin: 0;
    }
    .brand-accent {
      color: #6366f1;
    }
    .content {
      padding: 32px;
    }
    h2 {
      font-size: 20px;
      font-weight: 600;
      color: #ffffff;
      margin-top: 0;
      margin-bottom: 16px;
    }
    p {
      font-size: 15px;
      line-height: 1.6;
      color: #cbd5e1;
      margin: 0 0 18px 0;
    }
    .btn-container {
      text-align: center;
      margin: 32px 0;
    }
    .reset-btn {
      display: inline-block;
      background: #4f46e5;
      background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
      color: #ffffff !important;
      text-decoration: none;
      font-size: 15px;
      font-weight: 600;
      padding: 14px 32px;
      border-radius: 10px;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
      letter-spacing: 0.2px;
    }
    .callout {
      background: rgba(15, 23, 42, 0.6);
      border-left: 3px solid #f59e0b;
      padding: 14px 16px;
      border-radius: 0 8px 8px 0;
      margin-bottom: 24px;
      font-size: 13px;
      color: #e2e8f0;
    }
    .link-fallback {
      font-size: 12px;
      color: #94a3b8;
      word-break: break-all;
      background: rgba(0, 0, 0, 0.3);
      padding: 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .link-fallback a {
      color: #818cf8;
      text-decoration: underline;
    }
    .footer {
      padding: 24px 32px;
      text-align: center;
      background: rgba(15, 23, 42, 0.4);
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body style="background-color: #0b0f19; color: #e2e8f0;">
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <h1 class="brand-title" style="color: #ffffff;">${escapeHtml(brandName)}</h1>
      </div>
      <div class="content">
        <h2 style="color: #ffffff;">Password Reset Request</h2>
        <p style="color: #cbd5e1;">Hello <strong style="color: #ffffff;">${escapeHtml(username || 'there')}</strong>,</p>
        <p style="color: #cbd5e1;">We received a request to reset the password associated with your account.</p>
        <p style="color: #cbd5e1;">Click the button below to securely set your new password:</p>

        <div class="btn-container">
          <a href="${resetUrl}" class="reset-btn" target="_blank" rel="noopener">Reset Password</a>
        </div>

        <div class="callout" style="color: #e2e8f0;">
          ⏱️ <strong style="color: #ffffff;">Link Expiration:</strong> This reset link will expire in <strong style="color: #ffffff;">1 hour</strong>. For your security, each link can only be used once.
        </div>

        <p style="font-size: 13px; color: #94a3b8; margin-bottom: 8px;">
          If the button above does not work, copy and paste this link into your browser:
        </p>
        <div class="link-fallback" style="color: #94a3b8;">
          <a href="${resetUrl}" style="color: #818cf8; text-decoration: underline;">${escapeHtml(resetUrl)}</a>
        </div>

        <p style="font-size: 13px; color: #64748b; margin-top: 24px; margin-bottom: 0;">
          If you did not request a password reset, you can safely ignore this email. Your current password remains unchanged.
        </p>
      </div>
      <div class="footer" style="color: #64748b;">
        ${escapeHtml(brandName)} • Automated Security Notification<br>
        Please do not reply directly to this automated email.
      </div>
    </div>
  </div>
</body>
</html>
`.trim();

    if (!isSmtpConfigured()) {
        console.warn('\n============================================================');
        console.warn('⚠️  [MAILER WARNING] SMTP is not configured in .env!');
        console.warn('⚠️  Please configure SMTP_USER & SMTP_PASS in .env to send emails.');
        console.warn(`⚠️  Simulated password reset for: ${toEmail} (${username}, role: ${role})`);
        console.warn(`🔗  RESET LINK: ${resetUrl}`);
        console.warn('============================================================\n');
        return {
            success: true,
            simulated: true,
            resetUrl,
            message: 'SMTP not configured: reset link logged to server console.'
        };
    }

    const host = (process.env.SMTP_HOST || 'in-v3.mailjet.com').trim();
    const isMailjet = host.includes('mailjet') || Boolean(process.env.MAILJET_API_KEY);

    // Prioritize direct HTTPS REST API (Port 443) for Mailjet
    // This avoids ISP/firewall port blocking on 587/465 and delivers instantly in < 1 second.
    if (isMailjet && process.env.FORCE_SMTP !== 'true') {
        try {
            const apiResult = await sendViaMailjetApi({
                toEmail,
                username,
                subject,
                textContent,
                htmlContent,
                fromEmail,
                fromName
            });
            console.log(`[MAILER] Password reset email sent to ${toEmail} via Mailjet HTTPS API (Message ID: ${apiResult.messageId})`);
            return {
                success: true,
                simulated: false,
                messageId: apiResult.messageId
            };
        } catch (apiErr) {
            console.warn(`[MAILER WARN] Mailjet HTTPS API failed (${apiErr.message}). Falling back to SMTP...`);
        }
    }

    // Standard SMTP dispatch (for other custom SMTP providers or fallback)
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const primaryTransporter = createTransporter();

    try {
        const info = await primaryTransporter.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: toEmail,
            subject,
            text: textContent,
            html: htmlContent
        });

        console.log(`[MAILER] Password reset email sent to ${toEmail} via SMTP:${port} (Message ID: ${info.messageId})`);
        return {
            success: true,
            simulated: false,
            messageId: info.messageId
        };
    } catch (primaryErr) {
        console.error('[MAILER ERROR] Failed to send email via SMTP:', primaryErr.message);
        throw primaryErr;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

module.exports = {
    isSmtpConfigured,
    sendPasswordResetEmail,
    createTransporter,
    sendViaMailjetApi
};
