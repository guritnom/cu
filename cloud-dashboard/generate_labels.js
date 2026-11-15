/**
 * CurrentUsage CU100 - Offline & Automated Label Generator
 * 
 * Generates high-resolution QR codes and printable labels for all registered devices
 * in cu100_cloud.db.
 * 
 * Target URL format: https://dashboard.currentusage.com/?device=<device_id>
 * Example: https://dashboard.currentusage.com/?device=e83dc19c35c0
 * 
 * Run via: node generate_labels.js
 */

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { queryAll, initDb } = require('./db');

const OUTPUT_DIR = path.join(__dirname, 'labels');
const APP_URL = (process.env.APP_URL || 'https://dashboard.currentusage.com').trim().replace(/\/+$/, '');

async function generateAllLabels() {
    console.log('🏷️  CurrentUsage CU100 Label Generator');
    console.log(`🔗 Base URL: ${APP_URL}`);
    console.log('==============================================');

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    await initDb();
    const devices = await queryAll(`
        SELECT d.id, d.device_id, d.name, d.location, d.voltage, d.visibility, d.created_at,
               u.username AS owner_name
        FROM devices d
        LEFT JOIN users u ON u.id = d.owner_id
        ORDER BY d.id ASC
    `);

    if (devices.length === 0) {
        console.log('⚠️  No registered devices found in database.');
        process.exit(0);
    }

    console.log(`Found ${devices.length} registered device(s):\n`);

    const labelCardsHtml = [];

    for (const d of devices) {
        const cleanId = d.device_id.toLowerCase().replace(/^cu100_/, '');
        const targetUrl = `${APP_URL}/?device=${cleanId}`;
        const pngPath = path.join(OUTPUT_DIR, `label-${cleanId}.png`);
        const qrOnlyPngPath = path.join(OUTPUT_DIR, `qrcode-${cleanId}.png`);
        const svgPath = path.join(OUTPUT_DIR, `qrcode-${cleanId}.svg`);

        // Generate high-resolution QR PNG (512x512)
        await QRCode.toFile(qrOnlyPngPath, targetUrl, {
            type: 'png',
            width: 512,
            margin: 2,
            errorCorrectionLevel: 'M',
            color: { dark: '#000000', light: '#ffffff' }
        });

        // Generate SVG
        const svgString = await QRCode.toString(targetUrl, {
            type: 'svg',
            width: 512,
            margin: 2,
            errorCorrectionLevel: 'M',
            color: { dark: '#000000', light: '#ffffff' }
        });
        fs.writeFileSync(svgPath, svgString);

        // Generate base64 dataUrl for HTML inclusion
        const dataUrl = await QRCode.toDataURL(targetUrl, {
            width: 320,
            margin: 2,
            errorCorrectionLevel: 'M'
        });

        console.log(`✅ [${d.id}] ${d.name} (${cleanId.toUpperCase()})`);
        console.log(`   🔗 URL:  ${targetUrl}`);
        console.log(`   📁 PNG:  ${path.relative(process.cwd(), qrOnlyPngPath)}`);
        console.log(`   📁 SVG:  ${path.relative(process.cwd(), svgPath)}`);

        labelCardsHtml.push(`
            <div class="sticker-card">
                <div class="sticker-header">
                    <div class="sticker-brand">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="brand-icon" aria-hidden="true">
                            <defs>
                                <linearGradient id="genRing_${cleanId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00e5ff"/><stop offset="1" stop-color="#067fa8"/></linearGradient>
                                <linearGradient id="genBolt_${cleanId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd34d"/><stop offset="0.45" stop-color="#ffb020"/><stop offset="1" stop-color="#ff7a00"/></linearGradient>
                                <radialGradient id="genHalo_${cleanId}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffb020" stop-opacity="0.5"/><stop offset="0.7" stop-color="#ffb020" stop-opacity="0.12"/><stop offset="1" stop-color="#ffb020" stop-opacity="0"/></radialGradient>
                            </defs>
                            <rect width="512" height="512" rx="112" fill="#0a0e14"/>
                            <circle cx="256" cy="256" r="160" fill="none" stroke="url(#genRing_${cleanId})" stroke-width="60" stroke-linecap="round" stroke-dasharray="880 126" transform="rotate(-30 256 256)"/>
                            <circle cx="256" cy="256" r="160" fill="url(#genHalo_${cleanId})"/>
                            <path d="M302 48 L184 288 L254 288 L228 428 L344 216 L270 216 Z" fill="url(#genBolt_${cleanId})"/>
                        </svg>
                        <div class="brand-title">CurrentUsage</div>
                    </div>
                    <div class="sticker-badge">${escapeHtml(d.visibility ? d.visibility.toUpperCase() : 'PUBLIC')}</div>
                </div>

                <div class="sticker-body">
                    <div class="qr-col">
                        <img src="${dataUrl}" alt="QR Code for ${cleanId}" class="qr-img" />
                    </div>
                    <div class="info-col">
                        <div class="meta-row">
                            <span class="meta-label">DEVICE ID</span>
                            <span class="meta-value-id">${cleanId}</span>
                        </div>
                        <div class="meta-row">
                            <span class="meta-label">DEVICE NAME</span>
                            <span class="meta-value">${escapeHtml(d.name)}</span>
                        </div>
                        <div class="meta-row">
                            <span class="meta-label">LOCATION</span>
                            <span class="meta-value">${escapeHtml(d.location || 'Unspecified')}</span>
                        </div>
                        <div class="meta-row">
                            <span class="meta-label">VOLTAGE</span>
                            <span class="meta-value">${d.voltage || 220}V AC • 4x CT (0-100A)</span>
                        </div>
                    </div>
                </div>

                <div class="sticker-footer">
                    <div class="url-text">${targetUrl}</div>
                    <div class="scan-hint">Scan with phone camera to open dashboard</div>
                </div>
            </div>
        `);
    }

    // Build standalone printable HTML sheet
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CurrentUsage CU100 - Printable Device Labels</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Outfit:wght@400;600;700;800&family=JetBrains+Mono:wght@600;700&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Outfit', sans-serif;
            background: #f1f5f9;
            color: #0f172a;
            padding: 24px;
        }
        .header-bar {
            max-width: 960px;
            margin: 0 auto 24px auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #ffffff;
            padding: 16px 24px;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.06);
        }
        .header-title h1 { font-size: 1.3rem; font-weight: 800; color: #0f172a; }
        .header-title p { font-size: 0.85rem; color: #64748b; margin-top: 2px; }
        .btn-print {
            background: linear-gradient(135deg, #0aa6c9, #0284c7);
            color: #ffffff;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 0.95rem;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(10, 166, 201, 0.3);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .btn-print:hover { background: linear-gradient(135deg, #068da8, #0369a1); }
        .labels-grid {
            max-width: 960px;
            margin: 0 auto;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
            gap: 20px;
        }
        .sticker-card {
            background: #ffffff;
            border: 2px solid #0f172a;
            border-radius: 10px;
            padding: 14px 16px;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
            display: flex;
            flex-direction: column;
            gap: 10px;
            page-break-inside: avoid;
        }
        .sticker-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1.5px solid #0f172a;
            padding-bottom: 8px;
        }
        .sticker-brand {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .brand-icon {
            width: 24px;
            height: 24px;
        }
        .brand-title {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 1.05rem;
            font-weight: 800;
            letter-spacing: 0.5px;
            color: #0f172a;
            line-height: 1.1;
        }
        .sticker-badge {
            background: #0f172a;
            color: #ffffff;
            font-size: 0.65rem;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 4px;
            letter-spacing: 0.5px;
        }
        .sticker-body {
            display: flex;
            gap: 14px;
            align-items: center;
        }
        .qr-col {
            flex-shrink: 0;
            background: #ffffff;
            padding: 4px;
            border: 1.5px solid #e2e8f0;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .qr-img {
            width: 110px;
            height: 110px;
            display: block;
        }
        .info-col {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 5px;
            min-width: 0;
        }
        .meta-row {
            display: flex;
            flex-direction: column;
        }
        .meta-label {
            font-size: 0.6rem;
            font-weight: 700;
            color: #64748b;
            letter-spacing: 0.5px;
            text-transform: uppercase;
        }
        .meta-value-id {
            font-family: 'JetBrains Mono', monospace;
            font-size: 1rem;
            font-weight: 800;
            color: #0f172a;
            letter-spacing: 1px;
        }
        .meta-value {
            font-size: 0.8rem;
            font-weight: 700;
            color: #1e293b;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .sticker-footer {
            border-top: 1.5px solid #e2e8f0;
            padding-top: 8px;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .url-text {
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.68rem;
            color: #0f172a;
            font-weight: 700;
            word-break: break-all;
        }
        .scan-hint {
            font-size: 0.62rem;
            color: #64748b;
            font-weight: 500;
        }
        @media print {
            body {
                background: #ffffff !important;
                padding: 0 !important;
            }
            .header-bar {
                display: none !important;
            }
            .labels-grid {
                max-width: 100% !important;
                grid-template-columns: repeat(2, 1fr) !important;
                gap: 12px !important;
            }
            .sticker-card {
                border: 2px solid #000000 !important;
                box-shadow: none !important;
                break-inside: avoid !important;
                page-break-inside: avoid !important;
            }
            .sticker-badge {
                border: 1px solid #000000 !important;
                background: #000000 !important;
                color: #ffffff !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .qr-col {
                border-color: #000000 !important;
            }
        }
    </style>
</head>
<body>
    <div class="header-bar">
        <div class="header-title">
            <h1>CurrentUsage CU100 Device Labels</h1>
            <p>Generated for ${devices.length} registered hardware device(s). Ready to print on sticker paper or label sheets.</p>
        </div>
        <button class="btn-print" onclick="window.print()">
            🖨️ Print Labels Sheet
        </button>
    </div>

    <div class="labels-grid">
        ${labelCardsHtml.join('\n')}
    </div>
</body>
</html>`;

    const htmlPath = path.join(OUTPUT_DIR, 'print_labels.html');
    fs.writeFileSync(htmlPath, htmlContent);
    console.log(`\n📄 Printable Sheet: ${path.relative(process.cwd(), htmlPath)}`);
    console.log('✨ All labels generated successfully!\n');
    process.exit(0);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

generateAllLabels().catch(err => {
    console.error('Fatal error during label generation:', err);
    process.exit(1);
});
