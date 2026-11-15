#ifndef MAIN_WEB_ASSETS_H_
#define MAIN_WEB_ASSETS_H_

const char INDEX_HTML[] = R"rawhtml(
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CurrentUsage Energy Monitor</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;700;800&family=Space+Grotesk:wght@400;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #030712;
            --card-bg: rgba(17, 24, 39, 0.55);
            --card-border: rgba(255, 255, 255, 0.07);
            --text-main: #f3f4f6;
            --text-muted: #9ca3af;
            --primary: #6366f1;
            
            --ch1-color: #06b6d4; /* Neon Cyan */
            --ch2-color: #10b981; /* Neon Emerald */
            --ch3-color: #8b5cf6; /* Neon Purple */
            --ch4-color: #f59e0b; /* Neon Amber */
            --temp-color: #f43f5e; /* Neon Rose for DS18B20 */
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Outfit', sans-serif;
            background-color: var(--bg-color);
            background-image: 
                radial-gradient(circle at 10% 20%, rgba(99, 102, 241, 0.1) 0%, transparent 40%),
                radial-gradient(circle at 90% 80%, rgba(6, 182, 212, 0.1) 0%, transparent 40%);
            background-attachment: fixed;
            color: var(--text-main);
            min-height: 100vh;
            padding: 2rem 1rem;
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        .container {
            width: 100%;
            max-width: 1200px;
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
        }

        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0 0.5rem;
        }

        .logo-section h1 {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 2rem;
            font-weight: 700;
            background: linear-gradient(135deg, #a5b4fc, #818cf8, #06b6d4);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.5px;
        }

        .logo-section p {
            font-size: 0.875rem;
            color: var(--text-muted);
            margin-top: 0.25rem;
        }

        .status-badge {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid var(--card-border);
            padding: 0.5rem 1rem;
            border-radius: 9999px;
            font-size: 0.875rem;
            font-weight: 500;
            backdrop-filter: blur(8px);
        }

        .pulse-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: #ef4444; /* Default: offline */
        }

        .pulse-dot.online {
            background-color: #10b981;
            box-shadow: 0 0 12px #10b981;
            animation: pulse 2s infinite;
        }

        .pulse-dot.ap-mode {
            background-color: #3b82f6;
            box-shadow: 0 0 12px #3b82f6;
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }

        /* NAVIGATION MENU */
        .nav-bar {
            display: flex;
            gap: 0.5rem;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid var(--card-border);
            padding: 0.4rem;
            border-radius: 16px;
            backdrop-filter: blur(12px);
        }

        .nav-item {
            background: transparent;
            border: none;
            color: var(--text-muted);
            padding: 0.75rem 1.25rem;
            border-radius: 12px;
            cursor: pointer;
            font-family: inherit;
            font-size: 0.9375rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            transition: all 0.2s ease;
        }

        .nav-item svg {
            fill: currentColor;
            width: 18px;
            height: 18px;
        }

        .nav-item:hover {
            color: var(--text-main);
            background: rgba(255, 255, 255, 0.05);
        }

        .nav-item.active {
            color: white;
            background: var(--primary);
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
        }

        /* RESPONSIVE DESIGN (MOBILE VIEW) */
        @media (max-width: 600px) {
            body {
                padding: 1rem 0.5rem;
            }

            header {
                flex-direction: column;
                align-items: stretch;
                gap: 0.75rem;
            }

            .logo-section {
                text-align: center;
            }

            .status-badge {
                justify-content: center;
            }

            .nav-bar {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 0.25rem;
                padding: 0.25rem;
                border-radius: 12px;
            }

            .nav-item {
                flex-direction: column;
                justify-content: center;
                align-items: center;
                gap: 0.35rem;
                padding: 0.6rem 0.25rem;
                font-size: 0.75rem;
                border-radius: 8px;
                text-align: center;
            }

            .nav-item svg {
                width: 20px;
                height: 20px;
            }

            .card {
                padding: 1.25rem;
                border-radius: 16px;
            }
        }

        /* VIEWS STYLING */
        .view-content {
            display: none;
            animation: fadeIn 0.35s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .view-content.active {
            display: block;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* SUMMARY BAR */
        .summary-bar {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 1.25rem;
            margin-bottom: 1.5rem;
        }

        .summary-card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 1.1rem 1.25rem;
            backdrop-filter: blur(16px);
            display: flex;
            flex-direction: column;
            gap: 0.35rem;
        }

        .summary-title {
            font-size: 0.6875rem;
            font-weight: 700;
            letter-spacing: 1px;
            color: var(--text-muted);
        }

        .summary-value {
            display: flex;
            align-items: baseline;
            gap: 0.35rem;
        }

        .num-highlight {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 1.75rem;
            font-weight: 700;
            color: white;
        }

        /* Dashboard Grid */
        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 1.5rem;
        }

        .card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 20px;
            padding: 1.5rem;
            backdrop-filter: blur(16px);
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.2);
            transition: transform 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        .card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 4px;
        }

        .card.ch1::before { background: var(--ch1-color); }
        .card.ch2::before { background: var(--ch2-color); }
        .card.ch3::before { background: var(--ch3-color); }
        .card.ch4::before { background: var(--ch4-color); }

        .card:hover {
            transform: translateY(-4px);
            box-shadow: 0 12px 40px 0 rgba(0, 0, 0, 0.35);
        }

        .card.ch1:hover { border-color: rgba(6, 182, 212, 0.3); }
        .card.ch2:hover { border-color: rgba(16, 185, 129, 0.3); }
        .card.ch3:hover { border-color: rgba(139, 92, 246, 0.3); }
        .card.ch4:hover { border-color: rgba(245, 158, 11, 0.3); }

        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.25rem;
        }

        .card-title {
            font-size: 0.875rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--text-muted);
            font-weight: 600;
        }

        .sensor-icon {
            opacity: 0.7;
        }

        .card.ch1 .sensor-icon { fill: var(--ch1-color); }
        .card.ch2 .sensor-icon { fill: var(--ch2-color); }
        .card.ch3 .sensor-icon { fill: var(--ch3-color); }
        .card.ch4 .sensor-icon { fill: var(--ch4-color); }

        .value-display {
            display: flex;
            align-items: baseline;
            gap: 0.25rem;
            margin-bottom: 1rem;
        }

        .value-display.dual-value {
            justify-content: space-between;
        }

        .value-display .primary-value {
            display: flex;
            align-items: baseline;
            gap: 0.25rem;
        }

        .value-display .secondary-value {
            display: flex;
            align-items: baseline;
            gap: 0.15rem;
            opacity: 0.85;
        }

        .value-display .number {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 3rem;
            font-weight: 700;
            line-height: 1;
        }

        .value-display .amp-number {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--text-main);
        }

        .card.ch1 .number { text-shadow: 0 0 15px rgba(6, 182, 212, 0.3); }
        .card.ch2 .number { text-shadow: 0 0 15px rgba(16, 185, 129, 0.3); }
        .card.ch3 .number { text-shadow: 0 0 15px rgba(139, 92, 246, 0.3); }
        .card.ch4 .number { text-shadow: 0 0 15px rgba(245, 158, 11, 0.3); }

        .card.ch1 .secondary-value .amp-number { text-shadow: 0 0 10px rgba(6, 182, 212, 0.2); }
        .card.ch2 .secondary-value .amp-number { text-shadow: 0 0 10px rgba(16, 185, 129, 0.2); }
        .card.ch3 .secondary-value .amp-number { text-shadow: 0 0 10px rgba(139, 92, 246, 0.2); }
        .card.ch4 .secondary-value .amp-number { text-shadow: 0 0 10px rgba(245, 158, 11, 0.2); }

        .value-display .unit {
            font-size: 1.25rem;
            color: var(--text-muted);
            font-weight: 500;
        }

        .gauge-container {
            width: 100%;
            height: 6px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 3px;
            overflow: hidden;
            margin-bottom: 1rem;
        }

        .gauge-bar {
            height: 100%;
            width: 0%;
            border-radius: 3px;
            transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .card.ch1 .gauge-bar { background: var(--ch1-color); }
        .card.ch2 .gauge-bar { background: var(--ch2-color); }
        .card.ch3 .gauge-bar { background: var(--ch3-color); }
        .card.ch4 .gauge-bar { background: var(--ch4-color); }

        .stats {
            display: flex;
            justify-content: space-between;
            font-size: 0.8125rem;
            color: var(--text-muted);
        }

        /* Large chart card */
        .chart-card {
            margin-top: 2.25rem;
            padding: 1.5rem;
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }

        .chart-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .chart-legend {
            display: flex;
            gap: 1rem;
            font-size: 0.8125rem;
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 0.35rem;
            color: var(--text-muted);
        }

        .legend-color {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }

        .canvas-wrapper {
            position: relative;
            width: 100%;
            height: 280px;
        }

        canvas {
            width: 100%;
            height: 100%;
        }

        /* Wi-Fi card formatting */
        .config-card {
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
            max-width: 600px;
            margin: 1rem auto;
        }

        .form-group {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            position: relative;
        }

        .form-group label {
            font-size: 0.875rem;
            font-weight: 500;
            color: var(--text-muted);
        }

        .form-group input, .form-group select {
            width: 100%;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid var(--card-border);
            border-radius: 10px;
            padding: 0.75rem 1rem;
            color: var(--text-main);
            font-family: inherit;
            font-size: 0.9375rem;
            transition: all 0.2s;
            outline: none;
        }

        .form-group input:focus, .form-group select:focus {
            border-color: var(--primary);
            background: rgba(255, 255, 255, 0.08);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
        }

        .btn {
            background: linear-gradient(135deg, #6366f1, #4f46e5);
            color: white;
            border: none;
            border-radius: 10px;
            padding: 0.75rem 1.5rem;
            font-family: inherit;
            font-size: 0.9375rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
        }

        .btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(99, 102, 241, 0.45);
        }

        .btn:active {
            transform: translateY(0);
        }

        .btn-secondary {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid var(--card-border);
            color: var(--text-main);
            box-shadow: none;
        }

        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.1);
            box-shadow: none;
        }

        .network-list {
            margin-top: 0.5rem;
            max-height: 180px;
            overflow-y: auto;
            border: 1px solid var(--card-border);
            border-radius: 10px;
            background: rgba(0, 0, 0, 0.15);
        }

        .network-item {
            padding: 0.625rem 1rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(255, 255, 255, 0.03);
            cursor: pointer;
            transition: background 0.2s;
            font-size: 0.875rem;
        }

        .network-item:last-child {
            border-bottom: none;
        }

        .network-item:hover {
            background: rgba(255, 255, 255, 0.05);
        }

        .network-info {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .spinner {
            width: 16px;
            height: 16px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 0.8s linear infinite;
            display: none;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* SYSTEM SETTINGS/STATS VIEW */
        .settings-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 1.5rem;
        }

        .diagnostic-row {
            display: flex;
            justify-content: space-between;
            padding: 0.75rem 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            font-size: 0.9375rem;
        }

        .diagnostic-row:last-child {
            border-bottom: none;
        }

        .diagnostic-label {
            color: var(--text-muted);
        }

        .diagnostic-value {
            font-weight: 600;
            font-family: 'Space Grotesk', sans-serif;
        }

        .badge-coming-soon {
            display: inline-block;
            background: rgba(99, 102, 241, 0.15);
            color: #a5b4fc;
            padding: 0.2rem 0.5rem;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 0.5rem;
        }

        /* Overlay modal for reboot */
        .reboot-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(3, 7, 18, 0.85);
            backdrop-filter: blur(12px);
            z-index: 1000;
            display: none;
            justify-content: center;
            align-items: center;
        }

        .reboot-dialog {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 24px;
            padding: 2.5rem;
            max-width: 450px;
            width: 90%;
            text-align: center;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
        }

        .reboot-dialog h3 {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 1.5rem;
            margin-bottom: 1rem;
        }

        .reboot-dialog p {
            color: var(--text-muted);
            margin-bottom: 2rem;
            line-height: 1.5;
        }

        .circular-progress {
            position: relative;
            width: 80px;
            height: 80px;
            margin: 0 auto;
        }

        .circular-progress svg {
            width: 100%;
            height: 100%;
            transform: rotate(-90deg);
        }

        .circular-progress circle {
            fill: none;
            stroke-width: 6;
        }

        .circular-progress circle.bg {
            stroke: rgba(255, 255, 255, 0.05);
        }

        .circular-progress circle.val {
            stroke: var(--primary);
            stroke-dasharray: 226;
            stroke-dashoffset: 226;
            transition: stroke-dashoffset 1s linear;
        }

        /* DS18B20 Temp Card CSS */
        .card.temp-card::before { background: var(--temp-color); }
        .card.temp-card:hover { border-color: rgba(244, 63, 94, 0.3); }
        .card.temp-card .sensor-icon { fill: var(--temp-color); }
        .card.temp-card .number { text-shadow: 0 0 15px rgba(244, 63, 94, 0.3); }
        .card.temp-card .gauge-bar { background: var(--temp-color); }

        /* Factory Reset Button Styling */
        #btn-factory-reset {
            width: 100%;
            font-size: 0.875rem;
            background: linear-gradient(135deg, #ef4444, #dc2626);
            box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
            border: none;
            color: white;
        }

        #btn-factory-reset:hover {
            background: linear-gradient(135deg, #f87171, #ef4444);
            box-shadow: 0 6px 16px rgba(239, 68, 68, 0.5);
            transform: translateY(-1px);
        }

        #btn-factory-reset:active {
            transform: translateY(0);
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- HEADER -->
        <header>
            <div class="logo-section">
                <h1>CurrentUsage</h1>
                <p>Energy Monitor Dashboard</p>
            </div>
            <div class="status-badge">
                <div id="status-dot" class="pulse-dot"></div>
                <span id="status-text">Connecting...</span>
            </div>
        </header>

        <!-- NAVIGATION MENU -->
        <nav class="nav-bar">
            <button id="nav-dashboard" class="nav-item active" onclick="switchView('dashboard')">
                <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
                Dashboard
            </button>
            <button id="nav-wifi" class="nav-item" onclick="switchView('wifi')">
                <svg viewBox="0 0 24 24"><path d="M12 3C7.3 3 3.07 4.9 0 8l1.9 1.9C4.5 7.4 8.1 6 12 6s7.5 1.4 10.1 3.9L24 8C20.93 4.9 16.7 3 12 3zm0 6c-3.1 0-5.9 1.2-8 3.2l1.9 1.9c1.6-1.6 3.7-2.6 6.1-2.6s4.5 1 6.1 2.6L20 12.2C17.9 10.2 15.1 9 12 9zm0 6c-1.6 0-3 .6-4.1 1.6L12 21l4.1-4.4c-1.1-1-2.5-1.6-4.1-1.6z"/></svg>
                Wi-Fi Setup
            </button>
            <button id="nav-settings" class="nav-item" onclick="switchView('settings')">
                <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
                System settings
            </button>
        </nav>

        <!-- VIEW 1: DASHBOARD -->
        <main id="view-dashboard" class="view-content active">
            <!-- TOP STATS SUMMARY BAR -->
            <div class="summary-bar">
                <div class="summary-card">
                    <span class="summary-title">ACTIVE LOAD WATT</span>
                    <div class="summary-value">
                        <span id="total-power-val" class="num-highlight">0</span>
                        <span class="unit">W</span>
                    </div>
                </div>
                <div class="summary-card">
                    <span class="summary-title">TOTAL ACCUMULATED ENERGY</span>
                    <div class="summary-value">
                        <span id="total-kwh-val" class="num-highlight">0.000</span>
                        <span class="unit">kWh</span>
                    </div>
                </div>
            </div>

            <!-- SENSOR GRID -->
            <div class="dashboard-grid">
                <!-- Sensor 1 -->
                <div class="card ch1">
                    <div class="card-header">
                        <span class="card-title">SCT Sensor 1</span>
                        <svg class="sensor-icon" width="20" height="20" viewBox="0 0 24 24"><path d="M13.5 2c-5.246 0-9.5 4.254-9.5 9.5s4.254 9.5 9.5 9.5 9.5-4.254 9.5-9.5-4.254-9.5-9.5-9.5zm0 17c-4.136 0-7.5-3.364-7.5-7.5s3.364-7.5 7.5-7.5 7.5 3.364 7.5 7.5-3.364 7.5-7.5 7.5zm-5.5-7.5c0-.276.224-.5.5-.5h4v-4c0-.276.224-.5.5-.5s.5.224.5.5v4.5c0 .276-.224.5-.5.5h-4.5c-.276 0-.5-.224-.5-.5z"/></svg>
                    </div>
                    <div class="value-display dual-value">
                        <div class="primary-value">
                            <span id="ch1-w" class="number">0</span>
                            <span class="unit">W</span>
                        </div>
                        <div class="secondary-value">
                            <span id="ch1-val" class="amp-number">0.00</span>
                            <span class="unit" style="font-size: 0.875rem;">A</span>
                        </div>
                    </div>
                    <div class="gauge-container">
                        <div id="ch1-gauge" class="gauge-bar"></div>
                    </div>
                    <div class="stats" style="justify-content: center;">
                        <span>Energy: <strong id="ch1-kwh">0.000</strong> kWh<span id="ch1-cost-wrap" style="display: none;"> (<strong id="ch1-cost" style="color: #34d399;">--</strong>)</span></span>
                    </div>
                </div>

                <!-- Sensor 2 -->
                <div class="card ch2">
                    <div class="card-header">
                        <span class="card-title">SCT Sensor 2</span>
                        <svg class="sensor-icon" width="20" height="20" viewBox="0 0 24 24"><path d="M13.5 2c-5.246 0-9.5 4.254-9.5 9.5s4.254 9.5 9.5 9.5 9.5-4.254 9.5-9.5-4.254-9.5-9.5-9.5zm0 17c-4.136 0-7.5-3.364-7.5-7.5s3.364-7.5 7.5-7.5 7.5 3.364 7.5 7.5-3.364 7.5-7.5 7.5zm-5.5-7.5c0-.276.224-.5.5-.5h4v-4c0-.276.224-.5.5-.5s.5.224.5.5v4.5c0 .276-.224.5-.5.5h-4.5c-.276 0-.5-.224-.5-.5z"/></svg>
                    </div>
                    <div class="value-display dual-value">
                        <div class="primary-value">
                            <span id="ch2-w" class="number">0</span>
                            <span class="unit">W</span>
                        </div>
                        <div class="secondary-value">
                            <span id="ch2-val" class="amp-number">0.00</span>
                            <span class="unit" style="font-size: 0.875rem;">A</span>
                        </div>
                    </div>
                    <div class="gauge-container">
                        <div id="ch2-gauge" class="gauge-bar"></div>
                    </div>
                    <div class="stats" style="justify-content: center;">
                        <span>Energy: <strong id="ch2-kwh">0.000</strong> kWh<span id="ch2-cost-wrap" style="display: none;"> (<strong id="ch2-cost" style="color: #34d399;">--</strong>)</span></span>
                    </div>
                </div>

                <!-- Sensor 3 -->
                <div class="card ch3">
                    <div class="card-header">
                        <span class="card-title">SCT Sensor 3</span>
                        <svg class="sensor-icon" width="20" height="20" viewBox="0 0 24 24"><path d="M13.5 2c-5.246 0-9.5 4.254-9.5 9.5s4.254 9.5 9.5 9.5 9.5-4.254 9.5-9.5-4.254-9.5-9.5-9.5zm0 17c-4.136 0-7.5-3.364-7.5-7.5s3.364-7.5 7.5-7.5 7.5 3.364 7.5 7.5-3.364 7.5-7.5 7.5zm-5.5-7.5c0-.276.224-.5.5-.5h4v-4c0-.276.224-.5.5-.5s.5.224.5.5v4.5c0 .276-.224.5-.5.5h-4.5c-.276 0-.5-.224-.5-.5z"/></svg>
                    </div>
                    <div class="value-display dual-value">
                        <div class="primary-value">
                            <span id="ch3-w" class="number">0</span>
                            <span class="unit">W</span>
                        </div>
                        <div class="secondary-value">
                            <span id="ch3-val" class="amp-number">0.00</span>
                            <span class="unit" style="font-size: 0.875rem;">A</span>
                        </div>
                    </div>
                    <div class="gauge-container">
                        <div id="ch3-gauge" class="gauge-bar"></div>
                    </div>
                    <div class="stats" style="justify-content: center;">
                        <span>Energy: <strong id="ch3-kwh">0.000</strong> kWh<span id="ch3-cost-wrap" style="display: none;"> (<strong id="ch3-cost" style="color: #34d399;">--</strong>)</span></span>
                    </div>
                </div>

                <!-- Sensor 4 -->
                <div class="card ch4">
                    <div class="card-header">
                        <span class="card-title">SCT Sensor 4</span>
                        <svg class="sensor-icon" width="20" height="20" viewBox="0 0 24 24"><path d="M13.5 2c-5.246 0-9.5 4.254-9.5 9.5s4.254 9.5 9.5 9.5 9.5-4.254 9.5-9.5-4.254-9.5-9.5-9.5zm0 17c-4.136 0-7.5-3.364-7.5-7.5s3.364-7.5 7.5-7.5 7.5 3.364 7.5 7.5-3.364 7.5-7.5 7.5zm-5.5-7.5c0-.276.224-.5.5-.5h4v-4c0-.276.224-.5.5-.5s.5.224.5.5v4.5c0 .276-.224.5-.5.5h-4.5c-.276 0-.5-.224-.5-.5z"/></svg>
                    </div>
                    <div class="value-display dual-value">
                        <div class="primary-value">
                            <span id="ch4-w" class="number">0</span>
                            <span class="unit">W</span>
                        </div>
                        <div class="secondary-value">
                            <span id="ch4-val" class="amp-number">0.00</span>
                            <span class="unit" style="font-size: 0.875rem;">A</span>
                        </div>
                    </div>
                    <div class="gauge-container">
                        <div id="ch4-gauge" class="gauge-bar"></div>
                    </div>
                    <div class="stats" style="justify-content: center;">
                        <span>Energy: <strong id="ch4-kwh">0.000</strong> kWh<span id="ch4-cost-wrap" style="display: none;"> (<strong id="ch4-cost" style="color: #34d399;">--</strong>)</span></span>
                    </div>
                </div>


                <!-- Temperature Card -->
                <div class="card temp-card">
                    <div class="card-header">
                        <span class="card-title">Temperature</span>
                        <svg class="sensor-icon" width="20" height="20" viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v8.17a5 5 0 1 0 6 0V5a3 3 0 0 0-3-3zm1 14.17V5a1 1 0 1 0-2 0v11.17a3 3 0 1 0 2 0z"/></svg>
                    </div>
                    <div class="value-display">
                        <span id="temp-val" class="number">---</span>
                        <span class="unit">°C</span>
                    </div>
                    <div class="gauge-container">
                        <div id="temp-gauge" class="gauge-bar"></div>
                    </div>
                    <div class="stats">
                        <span>Min: <strong id="temp-min">---</strong></span>
                        <span>Max: <strong id="temp-max">---</strong></span>
                    </div>
                </div>
            </div>

            <!-- Real time power load -->
            <div class="card chart-card">
                <div class="chart-header">
                    <span class="card-title">Real-Time Power Load</span>
                    <div class="chart-legend">
                        <div class="legend-item"><span class="legend-color" style="background: var(--ch1-color)"></span><span>Ch1</span></div>
                        <div class="legend-item"><span class="legend-color" style="background: var(--ch2-color)"></span><span>Ch2</span></div>
                        <div class="legend-item"><span class="legend-color" style="background: var(--ch3-color)"></span><span>Ch3</span></div>
                        <div class="legend-item"><span class="legend-color" style="background: var(--ch4-color)"></span><span>Ch4</span></div>
                    </div>
                </div>
                <div class="canvas-wrapper">
                    <canvas id="realtimeChart"></canvas>
                </div>
            </div>
        </main>

        <!-- VIEW 2: WI-FI SETUP -->
        <main id="view-wifi" class="view-content">
            <div class="card config-card">
                <span class="card-title">Device WiFi Setup</span>
                
                <div class="form-group">
                    <label for="wifi-ssid">SSID Network Name</label>
                    <input type="text" id="wifi-ssid" placeholder="Enter SSID or scan..." autocomplete="off">
                </div>

                <div class="form-group">
                    <label for="wifi-pass">SSID Password</label>
                    <input type="password" id="wifi-pass" placeholder="••••••••">
                </div>

                <div style="display: flex; gap: 0.5rem; flex-direction: column;">
                    <button id="btn-scan" class="btn btn-secondary">
                        <div id="scan-spinner" class="spinner"></div>
                        Scan Nearby Networks
                    </button>
                    
                    <button id="btn-connect" class="btn">
                        Apply & Connect WiFi
                    </button>
                </div>

                <div id="scan-results" class="network-list" style="display: none;">
                    <!-- Scan items injected dynamically -->
                </div>

                <div style="border-top: 1px solid var(--card-border); padding-top: 1rem; display: flex; justify-content: flex-end;">
                    <button id="btn-reset" class="btn btn-secondary" style="font-size: 0.8125rem; padding: 0.5rem 1rem;">Reset Credentials</button>
                </div>
            </div>
        </main>

        <!-- VIEW 3: SYSTEM SETTINGS (DIAGNOSTICS & FUTURE FEATURES) -->
        <main id="view-settings" class="view-content">
            <div class="settings-grid">
                <!-- Diagnostics card -->
                <div class="card">
                    <span class="card-title" style="display:block; margin-bottom:1rem;">System Diagnostics</span>
                    
                    <div class="diagnostic-row">
                        <span class="diagnostic-label">Board MCU</span>
                        <span class="diagnostic-value">ESP32-C3</span>
                    </div>
                    <div class="diagnostic-row" style="align-items: center;">
                        <span class="diagnostic-label">Device Serial</span>
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <span id="sys-serial" class="diagnostic-value">---</span>
                            <button id="btn-copy-serial" class="btn btn-secondary" style="font-size: 0.7rem; padding: 0.25rem 0.5rem; line-height: 1;">Copy</button>
                        </div>
                    </div>
                    <div class="diagnostic-row">
                        <span class="diagnostic-label">CPU Cores</span>
                        <span class="diagnostic-value">1 (RISC-V)</span>
                    </div>
                    <div class="diagnostic-row">
                        <span class="diagnostic-label">CPU Frequency</span>
                        <span class="diagnostic-value">160 MHz</span>
                    </div>
                    <div class="diagnostic-row">
                        <span class="diagnostic-label">Firmware SDK</span>
                        <span class="diagnostic-value">ESP-IDF v6.0.1</span>
                    </div>
                    <div class="diagnostic-row">
                        <span class="diagnostic-label">Free Heap Space</span>
                        <span id="sys-free-heap" class="diagnostic-value">--- KB</span>
                    </div>
                    <div class="diagnostic-row">
                        <span class="diagnostic-label">Min Free Heap</span>
                        <span id="sys-min-heap" class="diagnostic-value">--- KB</span>
                    </div>
                    <div style="margin-top: 1.25rem; padding-top: 0.75rem; border-top: 1px solid rgba(255, 255, 255, 0.05); display: flex; flex-direction: column; gap: 0.75rem;">
                        <button id="btn-reset-kwh" class="btn btn-secondary" style="width: 100%; font-size: 0.875rem; border-color: rgba(239, 68, 68, 0.2); color: #fca5a5;">Reset Energy counters (kWh)</button>
                        <button id="btn-factory-reset" class="btn">Factory Reset Device</button>
                    </div>
                </div>

                <!-- Device Scaling & Calibration Card -->
                <div class="card">
                    <span class="card-title" style="display:block; margin-bottom:1rem;">Device Scaling & Calibration</span>
                    <p style="font-size:0.9rem; color:var(--text-muted); line-height:1.5; margin-bottom:1rem;">
                        Calibrate current transformers dynamically. Adjust ratio parameters to fine-tune current calculations for different SCT models (e.g. SCT-013-030 default: 30.0).
                    </p>
                    <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                        <div class="form-group">
                            <label for="cal-ch1">SCT Sensor 1 Ratio (A/V)</label>
                            <input type="number" id="cal-ch1" step="0.1" min="0.1" value="30.0">
                        </div>
                        <div class="form-group">
                            <label for="cal-ch2">SCT Sensor 2 Ratio (A/V)</label>
                            <input type="number" id="cal-ch2" step="0.1" min="0.1" value="30.0">
                        </div>
                        <div class="form-group">
                            <label for="cal-ch3">SCT Sensor 3 Ratio (A/V)</label>
                            <input type="number" id="cal-ch3" step="0.1" min="0.1" value="30.0">
                        </div>
                        <div class="form-group">
                            <label for="cal-ch4">SCT Sensor 4 Ratio (A/V)</label>
                            <input type="number" id="cal-ch4" step="0.1" min="0.1" value="30.0">
                        </div>
                        <div class="form-group">
                            <label for="cal-voltage">Assumed Line Voltage (V)</label>
                            <input type="number" id="cal-voltage" step="1" min="80" max="300" value="220">
                        </div>
                        <div class="form-group">
                            <label for="cal-temp-offset">Temperature Offset (°C)</label>
                            <input type="number" id="cal-temp-offset" step="0.1" value="0.0" placeholder="e.g. -4.0 to reduce reading by 4°C">
                        </div>
                        <div class="form-group">
                            <label for="cal-kwh-rate">Electricity Rate (per kWh)</label>
                            <input type="number" id="cal-kwh-rate" step="0.01" min="0" placeholder="e.g. 1444.70 or leave empty">
                        </div>
                        <div class="form-group">
                            <label for="cal-currency">Currency</label>
                            <select id="cal-currency">
                                <option value="IDR" selected>IDR (Rp)</option>
                                <option value="USD">USD ($)</option>
                            </select>
                        </div>
                        <button id="btn-save-cal" class="btn" style="margin-top: 0.5rem;">
                            Save Calibration
                        </button>
                    </div>
                </div>

                <!-- Home Assistant Integration Card (REST Sensor) -->
                <div class="card">
                    <span class="card-title" style="display:block; margin-bottom:0.75rem;">Home Assistant Integration (REST API)</span>
                    <p style="font-size:0.9rem; color:var(--text-muted); line-height:1.5; margin-bottom:1rem;">
                        Integrate this device into Home Assistant by adding a REST sensor block to your <code>configuration.yaml</code>.
                    </p>
                    
                    <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--card-border); border-radius: 12px; padding: 1rem; margin-bottom: 1rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                            <span style="font-size:0.85rem; font-weight:600; color:var(--primary);">YAML Configuration</span>
                            <button id="btn-copy-yaml" class="btn btn-secondary" style="font-size:0.75rem; padding:0.3rem 0.75rem;">Copy YAML</button>
                        </div>
                        <pre id="ha-yaml-snippet" style="font-family:monospace; font-size:0.8rem; color:#a5b4fc; overflow-x:auto; white-space:pre-wrap; word-break:break-all; max-height:240px; line-height:1.4;">rest:
  - resource: http://&lt;DEVICE_IP&gt;/api/sensors
    scan_interval: 10
    sensor:
      - name: "CU100 Temperature"
        unique_id: "cu100_temperature"
        value_template: "{{ value_json.temperature | round(2) }}"
        unit_of_measurement: "°C"
        device_class: "temperature"
        state_class: "measurement"

      - name: "CU100 SCT Sensor 1 Current"
        unique_id: "cu100_current_ch1"
        value_template: "{{ value_json.current_ch1 | round(2) }}"
        unit_of_measurement: "A"
        device_class: "current"
        state_class: "measurement"

      - name: "CU100 SCT Sensor 2 Current"
        unique_id: "cu100_current_ch2"
        value_template: "{{ value_json.current_ch2 | round(2) }}"
        unit_of_measurement: "A"
        device_class: "current"
        state_class: "measurement"

      - name: "CU100 SCT Sensor 3 Current"
        unique_id: "cu100_current_ch3"
        value_template: "{{ value_json.current_ch3 | round(2) }}"
        unit_of_measurement: "A"
        device_class: "current"
        state_class: "measurement"

      - name: "CU100 SCT Sensor 4 Current"
        unique_id: "cu100_current_ch4"
        value_template: "{{ value_json.current_ch4 | round(2) }}"
        unit_of_measurement: "A"
        device_class: "current"
        state_class: "measurement"

      - name: "CU100 SCT Sensor 1 Power"
        unique_id: "cu100_power_ch1"
        value_template: "{{ value_json.power_ch1 | round(2) }}"
        unit_of_measurement: "W"
        device_class: "power"
        state_class: "measurement"

      - name: "CU100 SCT Sensor 2 Power"
        unique_id: "cu100_power_ch2"
        value_template: "{{ value_json.power_ch2 | round(2) }}"
        unit_of_measurement: "W"
        device_class: "power"
        state_class: "measurement"

      - name: "CU100 SCT Sensor 3 Power"
        unique_id: "cu100_power_ch3"
        value_template: "{{ value_json.power_ch3 | round(2) }}"
        unit_of_measurement: "W"
        device_class: "power"
        state_class: "measurement"

      - name: "CU100 SCT Sensor 4 Power"
        unique_id: "cu100_power_ch4"
        value_template: "{{ value_json.power_ch4 | round(2) }}"
        unit_of_measurement: "W"
        device_class: "power"
        state_class: "measurement"

      - name: "CU100 SCT Sensor 1 Energy"
        unique_id: "cu100_kwh_ch1"
        value_template: "{{ value_json.kwh_ch1 | round(3) }}"
        unit_of_measurement: "kWh"
        device_class: "energy"
        state_class: "total_increasing"

      - name: "CU100 SCT Sensor 2 Energy"
        unique_id: "cu100_kwh_ch2"
        value_template: "{{ value_json.kwh_ch2 | round(3) }}"
        unit_of_measurement: "kWh"
        device_class: "energy"
        state_class: "total_increasing"

      - name: "CU100 SCT Sensor 3 Energy"
        unique_id: "cu100_kwh_ch3"
        value_template: "{{ value_json.kwh_ch3 | round(3) }}"
        unit_of_measurement: "kWh"
        device_class: "energy"
        state_class: "total_increasing"

      - name: "CU100 SCT Sensor 4 Energy"
        unique_id: "cu100_kwh_ch4"
        value_template: "{{ value_json.kwh_ch4 | round(3) }}"
        unit_of_measurement: "kWh"
        device_class: "energy"
        state_class: "total_increasing"

rest_command:
  cu100_reset_kwh:
    url: http://&lt;DEVICE_IP&gt;/api/sensors/reset_kwh
    method: post</pre>
                    </div>

                    <div style="font-size:0.85rem; color:var(--text-muted); line-height:1.6;">
                        <strong style="color:var(--text-main);">Configuration Steps:</strong>
                        <ol style="margin-left: 1.25rem; margin-top: 0.35rem;">
                            <li>Click <strong>Copy YAML</strong> or select the text above.</li>
                            <li>Open your Home Assistant <code>configuration.yaml</code> file.</li>
                            <li>Ensure <code>&lt;DEVICE_IP&gt;</code> matches your device IP address (<span id="ha-ip-placeholder" style="color:var(--ch1-color); font-weight:600;">192.168.1.x</span>).</li>
                            <li>Save and reload REST entities in Home Assistant (<strong>Developer Tools &rarr; YAML &rarr; Reload REST Entities</strong>).</li>
                        </ol>
                    </div>
                </div>

                <!-- Cloud IoT Platform Configuration Card -->
                <div class="card">
                    <span class="card-title" style="display:block; margin-bottom:1rem;">Cloud IoT Sync</span>
                    <p style="font-size:0.9rem; color:var(--text-muted); line-height:1.5; margin-bottom:1rem;">
                        Sync real-time data with cloud brokers.
                    </p>
                    <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                            <input type="checkbox" id="cloud-enabled" style="width: 18px; height: 18px; cursor: pointer;">
                            <label for="cloud-enabled" style="font-size: 0.9rem; font-weight: 600; cursor: pointer;">Enable Cloud Sync</label>
                        </div>
                        <div class="form-group">
                            <label for="cloud-host">Cloud Broker Host URL</label>
                            <input type="text" id="cloud-host" placeholder="e.g. messages.currentusage.com">
                        </div>
                        <div class="form-group">
                            <label for="cloud-port">Cloud Port</label>
                            <input type="number" id="cloud-port" value="1883">
                        </div>
                        <div class="form-group">
                            <label for="cloud-user">Username / PSK ID</label>
                            <input type="text" id="cloud-user" placeholder="Credential Username or PSK identity">
                        </div>
                        <div class="form-group">
                            <label for="cloud-pass">Password / PSK Key</label>
                            <input type="password" id="cloud-pass" placeholder="•••••••• (Leave empty to keep saved secret)">
                        </div>
                        <div class="form-group">
                            <label for="cloud-topic">Custom Publish Topic (Optional)</label>
                            <input type="text" id="cloud-topic" placeholder="e.g. custom/topic/path (Default: currentusage/{MAC}/state)">
                        </div>
                        <div class="form-group">
                            <label for="cloud-cert">CA Certificate (PEM format - Optional)</label>
                            <textarea id="cloud-cert" rows="4" placeholder="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----" style="width:100%; background:rgba(255,255,255,0.04); border:1px solid var(--card-border); border-radius:10px; color:var(--text-main); font-family:monospace; font-size:0.8rem; padding:0.5rem; outline:none; resize:vertical;"></textarea>
                        </div>
                        <button id="btn-save-cloud" class="btn" style="margin-top: 0.5rem;">
                            Save Cloud Sync Settings
                        </button>
                    </div>
                </div>
            </div>
        </main>
        
        <!-- FOOTER -->
        <footer style="text-align: center; margin-top: 2rem; margin-bottom: 1rem; color: var(--text-muted); font-size: 0.875rem; border-top: 1px solid var(--card-border); padding-top: 1.5rem;">
            <p>CU Node 100</p>
            <p>currentusage.com</p>
        </footer>
    </div>

    <!-- REBOOT MODAL -->
    <div id="reboot-modal" class="reboot-overlay">
        <div class="reboot-dialog">
            <h3>Configuration Submitted</h3>
            <p>SSID credentials saved. The ESP32 is rebooting and attempting to connect to your Wi-Fi network.</p>
            <div class="circular-progress">
                <svg>
                    <circle class="bg" cx="40" cy="40" r="36" />
                    <circle id="progress-bar" class="val" cx="40" cy="40" r="36" />
                </svg>
            </div>
            <div style="margin-top: 1.5rem; font-size: 0.875rem; color: var(--text-muted);">
                Reconnecting in <span id="countdown">15</span> seconds...
            </div>
        </div>
    </div>

    <script>
        let minTemp = null;
        let maxTemp = null;
        let kwhRate = null;
        let kwhCurrency = 'IDR';

        function formatCost(cost, currency) {
            if (currency === 'USD') {
                return '$' + cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
            return 'Rp ' + cost.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        }
        
        // Dynamic Chart setup
        const canvas = document.getElementById('realtimeChart');
        const ctx = canvas.getContext('2d');
        
        // Chart data queues
        const maxDataPoints = 60;
        const chartData = [
            Array(maxDataPoints).fill(0),
            Array(maxDataPoints).fill(0),
            Array(maxDataPoints).fill(0),
            Array(maxDataPoints).fill(0)
        ];

        // View Switcher logic
        function switchView(viewId) {
            // Hide all views
            document.querySelectorAll('.view-content').forEach(view => {
                view.classList.remove('active');
            });
            // Deactivate all navigation items
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });

            // Show target view & activate nav button
            document.getElementById('view-' + viewId).classList.add('active');
            document.getElementById('nav-' + viewId).classList.add('active');

            // Force resize canvas if switching back to dashboard
            if (viewId === 'dashboard') {
                setTimeout(resizeCanvas, 50); // Small timeout to ensure display state is loaded
            }
        }

        // Resize Canvas dynamically
        function resizeCanvas() {
            // Skip resizing if dashboard is not currently visible (avoids 0-width collapse)
            if (!document.getElementById('view-dashboard').classList.contains('active')) {
                return;
            }
            canvas.width = canvas.parentElement.clientWidth;
            canvas.height = canvas.parentElement.clientHeight;
            drawChart();
        }
        window.addEventListener('resize', resizeCanvas);

        function drawChart() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            const width = canvas.width;
            const height = canvas.height;
            const paddingLeft = 45;
            const paddingRight = 20;
            const paddingTop = 20;
            const paddingBottom = 25;
            const graphHeight = height - paddingTop - paddingBottom;
            const graphWidth = width - paddingLeft - paddingRight;
            
            // Dynamic scaling for Watts (min 500W scale)
            let maxVal = 500;
            for (let ch = 0; ch < 4; ch++) {
                for (let i = 0; i < maxDataPoints; i++) {
                    if (chartData[ch][i] > maxVal) maxVal = chartData[ch][i];
                }
            }
            maxVal = Math.ceil(maxVal / 250) * 250;

            // Draw grid lines
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
            ctx.lineWidth = 1;
            for (let i = 0; i <= 4; i++) {
                const y = paddingTop + (graphHeight / 4) * i;
                ctx.beginPath();
                ctx.moveTo(paddingLeft, y);
                ctx.lineTo(width - paddingRight, y);
                ctx.stroke();

                // Draw labels (e.g. 0W, 125W, 250W, 375W, 500W) shifted inward
                ctx.fillStyle = '#9ca3af';
                ctx.font = '11px Outfit, sans-serif';
                ctx.textAlign = 'right';
                const labelVal = Math.round(maxVal - (maxVal / 4) * i) + 'W';
                ctx.fillText(labelVal, paddingLeft - 8, y + 4);
            }

            // Line colors
            const colors = ['#06b6d4', '#10b981', '#8b5cf6', '#f59e0b'];
            
            // Draw lines for each channel
            for (let ch = 0; ch < 4; ch++) {
                ctx.strokeStyle = colors[ch];
                ctx.lineWidth = 2.5;
                ctx.beginPath();

                for (let i = 0; i < maxDataPoints; i++) {
                    const val = chartData[ch][i];
                    const y = paddingTop + graphHeight - (val / maxVal) * graphHeight;
                    const x = paddingLeft + (graphWidth / (maxDataPoints - 1)) * i;

                    if (i === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
                ctx.stroke();

                // Fill underneath the lines with a subtle gradient
                ctx.fillStyle = colors[ch] + '0a'; // very low opacity
                ctx.lineTo(paddingLeft + graphWidth, paddingTop + graphHeight);
                ctx.lineTo(paddingLeft, paddingTop + graphHeight);
                ctx.closePath();
                ctx.fill();
            }
        }

        // Add reading to queues and redraw
        function pushChartData(ch0, ch1, ch2, ch3) {
            const vals = [ch0, ch1, ch2, ch3];
            for (let ch = 0; ch < 4; ch++) {
                chartData[ch].shift();
                chartData[ch].push(vals[ch]);
            }
            // Only draw if canvas is currently visible
            if (document.getElementById('view-dashboard').classList.contains('active')) {
                drawChart();
            }
        }

        // Fetch sensor and wifi state
        async function fetchSensorData() {
            try {
                const response = await fetch('/api/sensors');
                if (!response.ok) throw new Error('API error');
                
                const data = await response.json();
                
                // Update Badge State
                const dot = document.getElementById('status-dot');
                const stText = document.getElementById('status-text');
                
                if (data.mode === 'STA') {
                    dot.className = 'pulse-dot online';
                    if (data.ssid) {
                        stText.innerText = 'Connected: ' + data.ssid + ' (STA: ' + data.ip + ')';
                    } else {
                        stText.innerText = 'Connected (STA: ' + data.ip + ')';
                    }
                } else {
                    dot.className = 'pulse-dot ap-mode';
                    if (data.ssid) {
                        stText.innerText = 'Config Mode: ' + data.ssid + ' (AP: ' + data.ip + ')';
                    } else {
                        stText.innerText = 'Config Mode (AP: ' + data.ip + ')';
                    }
                }

                if (data.ip && data.ip !== '0.0.0.0') {
                    const ipEl = document.getElementById('ha-ip-placeholder');
                    if (ipEl) ipEl.innerText = data.ip;
                    const yamlEl = document.getElementById('ha-yaml-snippet');
                    if (yamlEl && yamlEl.innerText.includes('<DEVICE_IP>')) {
                        yamlEl.innerText = yamlEl.innerText.replaceAll('<DEVICE_IP>', data.ip);
                    }
                }

                // Update Cards and totals
                let totalWatts = 0;
                let totalKwhVal = 0;
                const wattVals = [0, 0, 0, 0];

                for (let i = 0; i < 4; i++) {
                    const chNum = i + 1;
                    const val = data.currents[i];
                    document.getElementById('ch' + chNum + '-val').innerText = val.toFixed(2);
                    
                    // Update Watt readings
                    let watt = 0;
                    if (data.watts && data.watts[i] !== undefined) {
                        watt = Math.max(0, Math.round(data.watts[i]));
                    } else {
                        watt = Math.max(0, Math.round(val * 220));
                    }
                    wattVals[i] = watt;
                    totalWatts += watt;
                    document.getElementById('ch' + chNum + '-w').innerText = watt;
                    
                    // Update kWh readings and cost
                    if (data.kwh) {
                        const kwhVal = Math.max(0.0, data.kwh[i]);
                        totalKwhVal += kwhVal;
                        document.getElementById('ch' + chNum + '-kwh').innerText = kwhVal.toFixed(3);
                        const costWrap = document.getElementById('ch' + chNum + '-cost-wrap');
                        if (kwhRate !== null && kwhRate > 0) {
                            const cost = kwhVal * kwhRate;
                            document.getElementById('ch' + chNum + '-cost').innerText = formatCost(cost, kwhCurrency);
                            costWrap.style.display = 'inline';
                        } else {
                            costWrap.style.display = 'none';
                        }
                    }
                    
                    // Update Gauge percentage (up to 30A)
                    const percent = Math.min((val / 30.0) * 100, 100);
                    document.getElementById('ch' + chNum + '-gauge').style.width = percent + '%';
                }

                // Update summary bar active load & kwh elements
                const totalPowerEl = document.getElementById('total-power-val');
                if (totalPowerEl) totalPowerEl.innerText = totalWatts;
                const totalKwhEl = document.getElementById('total-kwh-val');
                if (totalKwhEl) totalKwhEl.innerText = totalKwhVal.toFixed(3);

                // Update Diagnostic stats (heap memory size)
                if (data.free_heap) {
                    document.getElementById('sys-free-heap').innerText = (data.free_heap / 1024).toFixed(1) + ' KB';
                }
                if (data.min_heap) {
                    document.getElementById('sys-min-heap').innerText = (data.min_heap / 1024).toFixed(1) + ' KB';
                }
                if (data.serial) {
                    document.getElementById('sys-serial').innerText = data.serial;
                }

                // Update Temperature Card
                if (data.temperature !== undefined) {
                    const temp = data.temperature;
                    // Check for valid/startup reading
                    if (temp > -100.0) {
                        document.getElementById('temp-val').innerText = temp.toFixed(1);
                        
                        // Update Min/Max
                        if (minTemp === null || temp < minTemp) {
                            minTemp = temp;
                            document.getElementById('temp-min').innerText = minTemp.toFixed(1) + '°C';
                        }
                        if (maxTemp === null || temp > maxTemp) {
                            maxTemp = temp;
                            document.getElementById('temp-max').innerText = maxTemp.toFixed(1) + '°C';
                        }
                        
                        // Update Gauge percentage (e.g. 0°C to 100°C)
                        const tempPercent = Math.max(0, Math.min((temp / 100.0) * 100, 100));
                        document.getElementById('temp-gauge').style.width = tempPercent + '%';
                    } else {
                        document.getElementById('temp-val').innerText = '---';
                    }
                }
 
                pushChartData(wattVals[0], wattVals[1], wattVals[2], wattVals[3]);
            } catch (err) {
                console.error('Failed to fetch sensor readings:', err);
                const dot = document.getElementById('status-dot');
                const stText = document.getElementById('status-text');
                dot.className = 'pulse-dot';
                stText.innerText = 'Offline';
            }
        }

        // Scan WiFi networks
        document.getElementById('btn-scan').addEventListener('click', async () => {
            const spinner = document.getElementById('scan-spinner');
            const listDiv = document.getElementById('scan-results');
            
            spinner.style.display = 'inline-block';
            listDiv.style.display = 'none';
            listDiv.innerHTML = '';

            try {
                const res = await fetch('/api/wifi/scan');
                if (!res.ok) throw new Error('Scan failed');
                
                const networks = await res.json();
                
                if (networks.length === 0) {
                    listDiv.innerHTML = '<div class="network-item">No networks found</div>';
                } else {
                    networks.forEach(net => {
                        const item = document.createElement('div');
                        item.className = 'network-item';
                        item.innerHTML = `
                            <div class="network-info">
                                <span>${net.ssid}</span>
                            </div>
                            <span style="font-size: 0.8em; color: var(--text-muted);">${net.rssi} dBm ${net.secure ? '🔒' : '🔓'}</span>
                        `;
                        item.addEventListener('click', () => {
                            document.getElementById('wifi-ssid').value = net.ssid;
                            listDiv.style.display = 'none';
                        });
                        listDiv.appendChild(item);
                    });
                }
                listDiv.style.display = 'block';
            } catch (err) {
                listDiv.innerHTML = '<div class="network-item" style="color: #ef4444;">Scan error. Please try again.</div>';
                listDiv.style.display = 'block';
            } finally {
                spinner.style.display = 'none';
            }
        });

        // Submit Wi-Fi details
        document.getElementById('btn-connect').addEventListener('click', async () => {
            const ssid = document.getElementById('wifi-ssid').value.trim();
            const pass = document.getElementById('wifi-pass').value.trim();

            if (!ssid) {
                alert('SSID is required');
                return;
            }

            try {
                const response = await fetch('/api/wifi/connect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ssid, password: pass })
                });

                if (response.ok) {
                    showRebootProgress();
                } else {
                    alert('Failed to save configuration');
                }
            } catch (err) {
                alert('Connection error submitting config');
            }
        });

        // Reset WiFi credentials
        document.getElementById('btn-reset').addEventListener('click', async () => {
            if (confirm('Clear saved Wi-Fi credentials and reboot?')) {
                try {
                    const res = await fetch('/api/wifi/reset', { method: 'POST' });
                    if (res.ok) {
                        alert('Credentials cleared. Rebooting device.');
                        window.location.reload();
                    } else {
                        alert('Reset failed');
                    }
                } catch (e) {
                    alert('Network error trying to reset');
                }
            }
        });

        function showRebootProgress() {
            const modal = document.getElementById('reboot-modal');
            const countdownEl = document.getElementById('countdown');
            const pBar = document.getElementById('progress-bar');
            
            modal.style.display = 'flex';
            
            let timeLeft = 15;
            countdownEl.innerText = timeLeft;
            
            // Animate progress circle
            pBar.style.strokeDashoffset = 226;
            setTimeout(() => {
                pBar.style.strokeDashoffset = 0;
            }, 50);

            const interval = setInterval(() => {
                timeLeft--;
                countdownEl.innerText = timeLeft;
                
                if (timeLeft <= 0) {
                    clearInterval(interval);
                    // Attempt to redirect to landing page
                    window.location.href = 'http://' + window.location.hostname;
                }
            }, 1000);
        }

        // Fetch calibration settings
        async function fetchCalibrationData() {
            try {
                const response = await fetch('/api/calibration');
                if (!response.ok) throw new Error('API error');
                const data = await response.json();
                if (data.calibration && data.calibration.length === 4) {
                    for (let i = 0; i < 4; i++) {
                        document.getElementById('cal-ch' + (i + 1)).value = data.calibration[i].toFixed(1);
                    }
                }
                if (data.voltage) {
                    document.getElementById('cal-voltage').value = data.voltage;
                }
                if (data.temp_offset !== undefined) {
                    document.getElementById('cal-temp-offset').value = data.temp_offset.toFixed(1);
                }
                if (data.kwh_rate !== undefined && data.kwh_rate > 0) {
                    document.getElementById('cal-kwh-rate').value = data.kwh_rate.toFixed(2);
                    kwhRate = data.kwh_rate;
                } else {
                    document.getElementById('cal-kwh-rate').value = '';
                    kwhRate = null;
                }
                if (data.currency) {
                    document.getElementById('cal-currency').value = data.currency;
                    kwhCurrency = data.currency;
                }
            } catch (err) {
                console.error('Failed to fetch calibration data:', err);
            }
        }

        // Save calibration settings
        document.getElementById('btn-save-cal').addEventListener('click', async () => {
            const cal = [];
            for (let i = 0; i < 4; i++) {
                const val = parseFloat(document.getElementById('cal-ch' + (i + 1)).value);
                if (isNaN(val) || val <= 0) {
                    alert('Please enter valid positive numbers for all calibration fields.');
                    return;
                }
                cal.push(val);
            }
            const voltage = parseFloat(document.getElementById('cal-voltage').value);
            if (isNaN(voltage) || voltage <= 0) {
                alert('Please enter a valid positive line voltage reference.');
                return;
            }
            const temp_offset = parseFloat(document.getElementById('cal-temp-offset').value);
            if (isNaN(temp_offset)) {
                alert('Please enter a valid temperature calibration offset.');
                return;
            }
            const rateStr = document.getElementById('cal-kwh-rate').value.trim();
            let kwh_rate = null;
            if (rateStr !== '') {
                kwh_rate = parseFloat(rateStr);
                if (isNaN(kwh_rate) || kwh_rate < 0) {
                    alert('Please enter a valid rate per kWh (positive number) or leave it empty.');
                    return;
                }
                kwh_rate = Math.round(kwh_rate * 100) / 100;
            }
            const currency = document.getElementById('cal-currency').value;

            try {
                const response = await fetch('/api/calibration', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ calibration: cal, voltage: voltage, temp_offset: temp_offset, kwh_rate: kwh_rate, currency: currency })
                });

                if (response.ok) {
                    kwhRate = kwh_rate;
                    kwhCurrency = currency;
                    if (kwh_rate !== null) {
                        document.getElementById('cal-kwh-rate').value = kwh_rate.toFixed(2);
                    }
                    fetchSensorData();
                    alert('Calibration, voltage, temperature offset, and kWh rate/currency settings saved and applied dynamically.');
                } else {
                    const text = await response.text();
                    alert('Failed to save settings: ' + text);
                }
            } catch (err) {
                alert('Connection error saving calibration.');
            }
        });

        document.getElementById('cal-kwh-rate').addEventListener('blur', (e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val) && val >= 0) {
                e.target.value = val.toFixed(2);
            }
        });


        // Helper to copy text to clipboard with HTTP fallback and button feedback
        function copyTextToClipboard(text, btn) {
            const originalText = btn.innerText;
            const originalBg = btn.style.background;

            function showSuccess() {
                btn.innerText = 'Copied!';
                btn.style.background = '#10b981';
                btn.style.color = '#ffffff';
                setTimeout(() => {
                    btn.innerText = originalText;
                    btn.style.background = originalBg;
                    btn.style.color = '';
                }, 2000);
            }

            function fallbackCopy(textToCopy) {
                try {
                    const textArea = document.createElement('textarea');
                    textArea.value = textToCopy;
                    textArea.style.position = 'fixed';
                    textArea.style.left = '-999999px';
                    textArea.style.top = '-999999px';
                    document.body.appendChild(textArea);
                    textArea.focus();
                    textArea.select();
                    const successful = document.execCommand('copy');
                    document.body.removeChild(textArea);
                    if (successful) {
                        showSuccess();
                    } else {
                        alert('Please select and copy the text manually.');
                    }
                } catch (err) {
                    alert('Please select and copy the text manually.');
                }
            }

            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(text).then(showSuccess).catch(() => fallbackCopy(text));
            } else {
                fallbackCopy(text);
            }
        }

        // Copy Home Assistant YAML configuration
        const btnCopyYaml = document.getElementById('btn-copy-yaml');
        if (btnCopyYaml) {
            btnCopyYaml.addEventListener('click', (e) => {
                const yamlText = document.getElementById('ha-yaml-snippet').innerText;
                copyTextToClipboard(yamlText, e.currentTarget);
            });
        }

        // Copy Device Serial
        const btnCopySerial = document.getElementById('btn-copy-serial');
        if (btnCopySerial) {
            btnCopySerial.addEventListener('click', (e) => {
                const serialText = document.getElementById('sys-serial').innerText.trim();
                if (serialText && serialText !== '---') {
                    copyTextToClipboard(serialText, e.currentTarget);
                }
            });
        }

        // Fetch MQTT configurations
        async function fetchMqttData() {
            try {
                const response = await fetch('/api/mqtt');
                if (!response.ok) throw new Error('API error');
                const data = await response.json();

                // Populate Cloud settings
                if (data.cloud) {
                    document.getElementById('cloud-enabled').checked = data.cloud.enabled;
                    document.getElementById('cloud-host').value = data.cloud.host;
                    document.getElementById('cloud-port').value = data.cloud.port;
                    document.getElementById('cloud-user').value = data.cloud.user;
                    document.getElementById('cloud-pass').value = '';
                    document.getElementById('cloud-cert').value = data.cloud.cert;
                    document.getElementById('cloud-topic').value = data.cloud.topic || '';
                }
            } catch (err) {
                console.error('Failed to fetch Cloud MQTT configuration:', err);
            }
        }

        // Save Cloud Platform Settings
        document.getElementById('btn-save-cloud').addEventListener('click', async () => {
            const enabled = document.getElementById('cloud-enabled').checked;
            const host = document.getElementById('cloud-host').value.trim();
            const port = parseInt(document.getElementById('cloud-port').value);
            const user = document.getElementById('cloud-user').value.trim();
            const pass = document.getElementById('cloud-pass').value;
            const cert = document.getElementById('cloud-cert').value.trim();
            const topic = document.getElementById('cloud-topic').value.trim();

            if (enabled && !host) {
                alert('Cloud broker URL is required when cloud sync is enabled');
                return;
            }

            const payload = {
                cloud: { enabled, host, port, user, pass, cert, topic }
            };

            try {
                const response = await fetch('/api/mqtt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (response.ok) {
                    alert('Cloud sync settings saved and applied dynamically.');
                } else {
                    alert('Failed to save settings.');
                }
            } catch (err) {
                alert('Connection error saving MQTT settings.');
            }
        });

        // Reset Energy Counters
        document.getElementById('btn-reset-kwh').addEventListener('click', async () => {
            if (confirm('Are you sure you want to reset all accumulated energy (kWh) counters? This will erase historical data.')) {
                try {
                    const response = await fetch('/api/sensors/reset_kwh', { method: 'POST' });
                    if (response.ok) {
                        alert('Energy counters successfully reset!');
                        fetchSensorData();
                    } else {
                        alert('Failed to reset counters.');
                    }
                } catch (err) {
                    alert('Connection error resetting energy counters.');
                }
            }
        });

        // Factory Reset Device
        document.getElementById('btn-factory-reset').addEventListener('click', async () => {
            if (confirm('WARNING: This will completely erase all device configuration (Wi-Fi settings, calibration ratios, and energy counters) and restore the device to its factory defaults. Are you sure you want to proceed?')) {
                try {
                    const response = await fetch('/api/system/factory_reset', { method: 'POST' });
                    if (response.ok) {
                        alert('Factory reset successfully initiated! The device is now resetting to defaults and rebooting...');
                        setTimeout(() => {
                            window.location.href = 'http://192.168.4.1/';
                        }, 2000);
                    } else {
                        alert('Failed to initiate factory reset.');
                    }
                } catch (err) {
                    alert('Connection error initiating factory reset.');
                }
            }
        });

        // Initialize loops
        resizeCanvas();
        setInterval(fetchSensorData, 750);
        fetchSensorData();
        fetchCalibrationData();
        fetchMqttData();
    </script>
</body>
</html>
)rawhtml";

#endif // MAIN_WEB_ASSETS_H_
