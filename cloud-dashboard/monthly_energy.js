const { queryGet, queryAll, queryRun } = require('./db');
const { getMonthlyTelemetryTotals } = require('./telemetry_db');

// In-memory cache for device settings (voltage, rate, currency)
// Map<cleanDeviceId, { voltage: number, electricity_rate: number, currency: string, cachedAt: number }>
const deviceConfigCache = new Map();

// In-memory energy trackers for active devices
// Map<cleanDeviceId, {
//   deviceId: string,
//   yearMonth: string,
//   lastTickTs: number,
//   kwh_ch1: number,
//   kwh_ch2: number,
//   kwh_ch3: number,
//   kwh_ch4: number,
//   kwh_total: number,
//   dirty: boolean
// }>
const energyTrackers = new Map();

let flushTimer = null;

function sanitizeDeviceId(deviceId) {
    return String(deviceId || '').toLowerCase().trim().replace(/^cu100_/, '');
}

function getYearMonth(date = new Date()) {
    const d = (date instanceof Date) ? date : new Date(date);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function getMonthName(yearMonth) {
    if (!yearMonth) return '';
    const parts = String(yearMonth).split('-');
    if (parts.length < 2) return yearMonth;
    let y = parseInt(parts[0], 10);
    let m = parseInt(parts[1], 10);
    if (isNaN(y) || isNaN(m) || m < 1 || m > 12) return yearMonth;
    const d = new Date(Date.UTC(y, m - 1, 1));
    return isNaN(d.getTime()) ? yearMonth : d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function getMonthBounds(yearMonth) {
    const parts = String(yearMonth || '').split('-');
    let y = parseInt(parts[0], 10);
    let m = parseInt(parts[1], 10);
    if (isNaN(y) || isNaN(m) || m < 1 || m > 12) {
        const now = new Date();
        y = now.getUTCFullYear();
        m = now.getUTCMonth() + 1;
    }
    const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0)).toISOString();
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    const end = new Date(Date.UTC(nextY, nextM - 1, 1, 0, 0, 0)).toISOString();
    return { start, end };
}

// Invalidate cached device settings when updated by user or admin
function invalidateDeviceConfig(deviceId) {
    const cleanId = sanitizeDeviceId(deviceId);
    deviceConfigCache.delete(cleanId);
}

// Fetch device config from SQLite or cache
async function getDeviceConfig(deviceId) {
    const cleanId = sanitizeDeviceId(deviceId);
    const now = Date.now();
    const cached = deviceConfigCache.get(cleanId);
    if (cached && (now - cached.cachedAt < 30000)) { // 30s cache
        return cached;
    }

    try {
        const row = await queryGet(
            `SELECT voltage, electricity_rate, currency FROM devices WHERE LOWER(device_id) = ?`,
            [cleanId]
        );
        const config = {
            voltage: (row && row.voltage != null && !isNaN(parseFloat(row.voltage)) && parseFloat(row.voltage) > 0)
                ? Number(row.voltage)
                : 220.0,
            electricity_rate: (row && row.electricity_rate != null && !isNaN(parseFloat(row.electricity_rate)))
                ? Number(row.electricity_rate)
                : 0.0,
            currency: (row && row.currency) ? row.currency : 'IDR',
            cachedAt: now
        };
        deviceConfigCache.set(cleanId, config);
        return config;
    } catch (err) {
        return { voltage: 220.0, electricity_rate: 0.0, currency: 'IDR', cachedAt: now };
    }
}

// Persist a single tracker record into SQLite monthly_energy table
async function persistTracker(tracker) {
    if (!tracker) return;
    try {
        const cfg = await getDeviceConfig(tracker.deviceId);
        const rate = cfg.electricity_rate || 0.0;
        const currency = cfg.currency || 'IDR';
        const costTotal = tracker.kwh_total * rate;

        await queryRun(`
            INSERT INTO monthly_energy (
                device_id, year_month, kwh_ch1, kwh_ch2, kwh_ch3, kwh_ch4, kwh_total, cost_total, currency, last_updated
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(device_id, year_month) DO UPDATE SET
                kwh_ch1 = excluded.kwh_ch1,
                kwh_ch2 = excluded.kwh_ch2,
                kwh_ch3 = excluded.kwh_ch3,
                kwh_ch4 = excluded.kwh_ch4,
                kwh_total = excluded.kwh_total,
                cost_total = excluded.cost_total,
                currency = excluded.currency,
                last_updated = CURRENT_TIMESTAMP
        `, [
            tracker.deviceId,
            tracker.yearMonth,
            Number(tracker.kwh_ch1.toFixed(4)),
            Number(tracker.kwh_ch2.toFixed(4)),
            Number(tracker.kwh_ch3.toFixed(4)),
            Number(tracker.kwh_ch4.toFixed(4)),
            Number(tracker.kwh_total.toFixed(4)),
            Number(costTotal.toFixed(2)),
            currency
        ]);
        tracker.dirty = false;
    } catch (err) {
        console.error(`[Monthly Energy] Failed to persist tracker for ${tracker.deviceId}:`, err.message);
    }
}

// Flush all dirty in-memory trackers to SQLite
async function flushMonthlyEnergy() {
    for (const tracker of energyTrackers.values()) {
        if (tracker.dirty) {
            await persistTracker(tracker);
        }
    }
}

// Load or initialize monthly tracker for device and month
async function getOrCreateTracker(deviceId, yearMonth) {
    const cleanId = sanitizeDeviceId(deviceId);
    let tracker = energyTrackers.get(cleanId);

    // If tracker exists and matches month, return it
    if (tracker && tracker.yearMonth === yearMonth) {
        return tracker;
    }

    // If month changed, flush old month tracker first
    if (tracker && tracker.yearMonth !== yearMonth) {
        if (tracker.dirty) {
            await persistTracker(tracker);
        }
        console.log(`[Monthly Energy] Device ${cleanId} rolled over from ${tracker.yearMonth} to ${yearMonth}. Resetting counter.`);
    }

    // Try loading existing record from SQLite
    let row = null;
    try {
        row = await queryGet(
            `SELECT * FROM monthly_energy WHERE LOWER(device_id) = ? AND year_month = ?`,
            [cleanId, yearMonth]
        );
    } catch (err) { }

    let kwh_ch1 = 0.0;
    let kwh_ch2 = 0.0;
    let kwh_ch3 = 0.0;
    let kwh_ch4 = 0.0;
    let kwh_total = 0.0;

    if (row) {
        kwh_ch1 = Number(row.kwh_ch1) || 0.0;
        kwh_ch2 = Number(row.kwh_ch2) || 0.0;
        kwh_ch3 = Number(row.kwh_ch3) || 0.0;
        kwh_ch4 = Number(row.kwh_ch4) || 0.0;
        kwh_total = Number(row.kwh_total) || 0.0;
    } else {
        // Check DuckDB for any pre-existing telemetry in this month
        try {
            const bounds = getMonthBounds(yearMonth);
            const totals = await getMonthlyTelemetryTotals(cleanId, bounds.start, bounds.end);
            if (totals && totals.kwh_total > 0) {
                kwh_ch1 = Number(totals.kwh_ch1) || 0.0;
                kwh_ch2 = Number(totals.kwh_ch2) || 0.0;
                kwh_ch3 = Number(totals.kwh_ch3) || 0.0;
                kwh_ch4 = Number(totals.kwh_ch4) || 0.0;
                kwh_total = Number(totals.kwh_total) || 0.0;
                console.log(`[Monthly Energy] Backfilled ${cleanId} for ${yearMonth} from DuckDB: ${kwh_total} kWh`);
            }
        } catch (e) { }
    }

    tracker = {
        deviceId: cleanId,
        yearMonth,
        lastTickTs: 0,
        kwh_ch1,
        kwh_ch2,
        kwh_ch3,
        kwh_ch4,
        kwh_total,
        dirty: false
    };

    energyTrackers.set(cleanId, tracker);
    return tracker;
}

/**
 * Ingest live telemetry tick, calculate cloud power & monthly energy
 * @param {string} deviceId 
 * @param {Array<number>} currents [ch1, ch2, ch3, ch4] in Amperes
 * @param {number} timestampMs
 */
async function processTelemetryEnergy(deviceId, currents = [0, 0, 0, 0], timestampMs = Date.now()) {
    const cleanId = sanitizeDeviceId(deviceId);
    const config = await getDeviceConfig(cleanId);
    const voltage = config.voltage || 220.0;

    const i1 = Math.max(0, Number(currents[0]) || 0);
    const i2 = Math.max(0, Number(currents[1]) || 0);
    const i3 = Math.max(0, Number(currents[2]) || 0);
    const i4 = Math.max(0, Number(currents[3]) || 0);

    // Calculate Power in Watts (P = V * I)
    const p1 = Math.round((i1 * voltage) * 100) / 100;
    const p2 = Math.round((i2 * voltage) * 100) / 100;
    const p3 = Math.round((i3 * voltage) * 100) / 100;
    const p4 = Math.round((i4 * voltage) * 100) / 100;
    const pActive = Math.round((p1 + p2 + p3 + p4) * 100) / 100;

    const currentYearMonth = getYearMonth(timestampMs);
    const tracker = await getOrCreateTracker(cleanId, currentYearMonth);

    // Delta time in seconds between measurement ticks
    let deltaSec = 1.0;
    if (tracker.lastTickTs > 0) {
        deltaSec = (timestampMs - tracker.lastTickTs) / 1000.0;
    }
    tracker.lastTickTs = timestampMs;

    // Numerical integration: Watts * seconds / (3600 * 1000) = kWh
    // Guard against large gaps when offline (cap at 10 seconds per tick)
    if (deltaSec > 0 && deltaSec <= 10.0) {
        const dKwh1 = (p1 * deltaSec) / 3600000.0;
        const dKwh2 = (p2 * deltaSec) / 3600000.0;
        const dKwh3 = (p3 * deltaSec) / 3600000.0;
        const dKwh4 = (p4 * deltaSec) / 3600000.0;

        tracker.kwh_ch1 += dKwh1;
        tracker.kwh_ch2 += dKwh2;
        tracker.kwh_ch3 += dKwh3;
        tracker.kwh_ch4 += dKwh4;
        tracker.kwh_total = tracker.kwh_ch1 + tracker.kwh_ch2 + tracker.kwh_ch3 + tracker.kwh_ch4;
        tracker.dirty = true;
    }

    const rate = config.electricity_rate || 0.0;
    const currency = config.currency || 'IDR';
    const costTotal = tracker.kwh_total * rate;

    return {
        deviceId: cleanId,
        voltage,
        rate,
        currency,
        power_ch1: p1,
        power_ch2: p2,
        power_ch3: p3,
        power_ch4: p4,
        p_active: pActive,
        current_ch1: i1,
        current_ch2: i2,
        current_ch3: i3,
        current_ch4: i4,
        // Cloud-calculated monthly energy (resets monthly)
        kwh_ch1: Number(tracker.kwh_ch1.toFixed(4)),
        kwh_ch2: Number(tracker.kwh_ch2.toFixed(4)),
        kwh_ch3: Number(tracker.kwh_ch3.toFixed(4)),
        kwh_ch4: Number(tracker.kwh_ch4.toFixed(4)),
        kwh_total: Number(tracker.kwh_total.toFixed(4)),
        cost_total: Number(costTotal.toFixed(2)),
        year_month: currentYearMonth
    };
}

// Get monthly energy summary and history for a device
async function getDeviceMonthlyEnergy(deviceId) {
    const cleanId = sanitizeDeviceId(deviceId);
    const config = await getDeviceConfig(cleanId);
    const currentYearMonth = getYearMonth();

    // Ensure tracker is loaded for current month
    const tracker = await getOrCreateTracker(cleanId, currentYearMonth);
    const rate = config.electricity_rate || 0.0;
    const currency = config.currency || 'IDR';

    // Query historical records from SQLite
    let rows = [];
    try {
        rows = await queryAll(
            `SELECT year_month, kwh_ch1, kwh_ch2, kwh_ch3, kwh_ch4, kwh_total, cost_total, currency, last_updated
             FROM monthly_energy
             WHERE LOWER(device_id) = ?
             ORDER BY year_month DESC`,
            [cleanId]
        );
    } catch (e) {
        console.error(`[Monthly Energy Query Error]:`, e.message);
    }

    // Build history map with live current month merged
    const historyMap = new Map();
    for (const r of rows) {
        historyMap.set(r.year_month, {
            year_month: r.year_month,
            month_name: getMonthName(r.year_month),
            kwh_ch1: Number(r.kwh_ch1) || 0.0,
            kwh_ch2: Number(r.kwh_ch2) || 0.0,
            kwh_ch3: Number(r.kwh_ch3) || 0.0,
            kwh_ch4: Number(r.kwh_ch4) || 0.0,
            kwh_total: Number(r.kwh_total) || 0.0,
            cost_total: Number(r.cost_total) || 0.0,
            currency: r.currency || currency,
            status: r.year_month === currentYearMonth ? 'in_progress' : 'completed',
            last_updated: r.last_updated
        });
    }

    // Always include current month with real-time in-memory tracker values
    const currentCost = tracker.kwh_total * rate;
    const currentMonthObj = {
        year_month: currentYearMonth,
        month_name: getMonthName(currentYearMonth),
        kwh_ch1: Number(tracker.kwh_ch1.toFixed(4)),
        kwh_ch2: Number(tracker.kwh_ch2.toFixed(4)),
        kwh_ch3: Number(tracker.kwh_ch3.toFixed(4)),
        kwh_ch4: Number(tracker.kwh_ch4.toFixed(4)),
        kwh_total: Number(tracker.kwh_total.toFixed(4)),
        cost_total: Number(currentCost.toFixed(2)),
        currency: currency,
        status: 'in_progress',
        last_updated: new Date().toISOString()
    };
    historyMap.set(currentYearMonth, currentMonthObj);

    // Sort descending by year_month
    const history = Array.from(historyMap.values()).sort((a, b) => b.year_month.localeCompare(a.year_month));

    return {
        device_id: cleanId,
        voltage: config.voltage,
        electricity_rate: rate,
        currency,
        current_month: currentMonthObj,
        history
    };
}

// Initialize periodic background flushing
function initMonthlyEnergy() {
    if (!flushTimer) {
        flushTimer = setInterval(flushMonthlyEnergy, 5000);
        console.log('[Monthly Energy] In-memory accumulator and periodic flush initialized (5s interval).');
    }
}

module.exports = {
    initMonthlyEnergy,
    getDeviceConfig,
    invalidateDeviceConfig,
    processTelemetryEnergy,
    getDeviceMonthlyEnergy,
    flushMonthlyEnergy,
    getMonthName,
    getYearMonth
};
