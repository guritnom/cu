const duckdb = require('duckdb');
const path = require('path');
const fs = require('fs');

// Persist telemetry in DATA_DIR when set (Docker volume), else beside the app
const DATA_DIR = process.env.DATA_DIR;
if (DATA_DIR) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR || __dirname, 'cu100_telemetry.duckdb');

let db = null;
let conn = null;
let writeQueue = [];
let flushInterval = null;

// Promisified Helper Methods
function execQuery(sql) {
    return new Promise((resolve, reject) => {
        conn.exec(sql, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function queryAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        conn.all(sql, ...params, (err, rows) => {
            if (err) return reject(err);
            if (!rows) return resolve([]);
            // Convert any BigInt from DuckDB to Number so JSON.stringify never crashes
            const cleanRows = rows.map(row => {
                const cleaned = {};
                for (const [k, v] of Object.entries(row)) {
                    cleaned[k] = (typeof v === 'bigint') ? Number(v) : v;
                }
                return cleaned;
            });
            resolve(cleanRows);
        });
    });
}

// Parameterized DML (INSERT / UPDATE / DELETE) — prevents SQL injection
function execQueryParams(sql, params = []) {
    return new Promise((resolve, reject) => {
        conn.all(sql, ...params, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// Robust Date parser that safely handles numbers (ms or seconds), ISO strings, Date objects,
// and gracefully falls back to a default value if the input is invalid or NaN.
function safeParseDate(val, fallback = null) {
    if (val === null || val === undefined || val === '' || val === 'undefined' || val === 'null' || val === 'NaN') {
        return fallback;
    }
    if (val instanceof Date) {
        return isNaN(val.getTime()) ? fallback : val;
    }
    if (typeof val === 'number') {
        if (isNaN(val) || !isFinite(val)) return fallback;
        const ms = (val > 0 && val < 1e11) ? val * 1000 : val;
        const d = new Date(ms);
        return isNaN(d.getTime()) ? fallback : d;
    }
    if (typeof val === 'string') {
        const trimmed = val.trim();
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            const num = Number(trimmed);
            if (isNaN(num) || !isFinite(num)) return fallback;
            const ms = (num > 0 && num < 1e11) ? num * 1000 : num;
            const d = new Date(ms);
            return isNaN(d.getTime()) ? fallback : d;
        }
        const d = new Date(trimmed);
        return isNaN(d.getTime()) ? fallback : d;
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? fallback : d;
}

function safeToIsoString(val, fallbackIso = null) {
    const fallbackDate = fallbackIso ? safeParseDate(fallbackIso, null) : null;
    const d = safeParseDate(val, fallbackDate);
    return (d && !isNaN(d.getTime())) ? d.toISOString() : (fallbackIso || null);
}

// Initialize DuckDB Database Connection & Schema
async function initTelemetryDb() {
    console.log('[DuckDB] Connecting to Telemetry database at:', DB_PATH);
    
    await new Promise((resolve, reject) => {
        db = new duckdb.Database(DB_PATH, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });

    conn = db.connect();

    // Create telemetry table if not exists
    await execQuery(`
        CREATE TABLE IF NOT EXISTS telemetry (
            device_id VARCHAR NOT NULL,
            timestamp TIMESTAMP NOT NULL,
            v_rms DOUBLE,
            i_rms1 DOUBLE,
            i_rms2 DOUBLE,
            i_rms3 DOUBLE,
            i_rms4 DOUBLE,
            p_active DOUBLE,
            temp DOUBLE
        );
    `);

    // Ensure periodic flushing every 2 seconds
    if (!flushInterval) {
        flushInterval = setInterval(flushTelemetryBuffer, 2000);
    }

    console.log('[DuckDB] Telemetry schema initialized successfully.');
}

// Enqueue telemetry sample into batch buffer
function enqueueTelemetry(data) {
    if (!data || !data.device_id) return;

    const cleanDeviceId = String(data.device_id).toLowerCase().trim().replace(/^cu100_/, '');

    const record = {
        device_id: cleanDeviceId,
        timestamp: safeToIsoString(data.timestamp, new Date().toISOString()),
        v_rms: typeof data.v_rms === 'number' ? data.v_rms : 0,
        i_rms1: typeof data.i_rms1 === 'number' ? data.i_rms1 : 0,
        i_rms2: typeof data.i_rms2 === 'number' ? data.i_rms2 : 0,
        i_rms3: typeof data.i_rms3 === 'number' ? data.i_rms3 : 0,
        i_rms4: typeof data.i_rms4 === 'number' ? data.i_rms4 : 0,
        p_active: typeof data.p_active === 'number' ? data.p_active : 0,
        temp: typeof data.temp === 'number' ? data.temp : 0
    };

    writeQueue.push(record);

    // Flush immediately if buffer exceeds 100 items
    if (writeQueue.length >= 100) {
        flushTelemetryBuffer().catch(() => {});
    }
}

// Flush write buffer into DuckDB with lock & finalized promise
let isFlushing = false;
async function flushTelemetryBuffer() {
    if (writeQueue.length === 0 || !conn || isFlushing) return;

    isFlushing = true;
    const itemsToFlush = writeQueue.splice(0, writeQueue.length);
    
    try {
        const stmt = conn.prepare(`
            INSERT INTO telemetry 
            (device_id, timestamp, v_rms, i_rms1, i_rms2, i_rms3, i_rms4, p_active, temp) 
            VALUES (?, CAST(? AS TIMESTAMP), ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const item of itemsToFlush) {
            stmt.run(
                item.device_id,
                item.timestamp,
                item.v_rms,
                item.i_rms1,
                item.i_rms2,
                item.i_rms3,
                item.i_rms4,
                item.p_active,
                item.temp
            );
        }

        await new Promise((resolve, reject) => {
            stmt.finalize((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    } catch (err) {
        console.error('[DuckDB Flush Error]:', err.message);
        // Put unwritten items back into queue
        writeQueue.unshift(...itemsToFlush);
    } finally {
        isFlushing = false;
    }
}

// Query historical telemetry with aggregated time buckets
async function getTelemetryHistory(deviceId, startTimeMs, endTimeMs, resolution = 'raw', aggMode = 'avg') {
    if (!conn) throw new Error('DuckDB not connected');

    // Always ensure write buffer is flushed before reading
    await flushTelemetryBuffer();

    const cleanDeviceId = String(deviceId || '').toLowerCase().trim().replace(/^cu100_/, '');
    const prefixDeviceId = 'cu100_' + cleanDeviceId;

    const now = Date.now();
    let endD = safeParseDate(endTimeMs, new Date(now));
    if (!endD || isNaN(endD.getTime())) endD = new Date(now);

    let startD = safeParseDate(startTimeMs, new Date(endD.getTime() - 24 * 60 * 60 * 1000));
    if (!startD || isNaN(startD.getTime())) startD = new Date(endD.getTime() - 24 * 60 * 60 * 1000);

    // Ensure chronological order
    if (startD.getTime() > endD.getTime()) {
        const temp = startD;
        startD = endD;
        endD = temp;
    }

    const startDate = startD.toISOString();
    const endDate = endD.toISOString();
    const isMaxMode = String(aggMode).toLowerCase() === 'max';

    let bucketInterval = null;
    switch (resolution) {
        case '1m': bucketInterval = "INTERVAL '1 minute'"; break;
        case '5m': bucketInterval = "INTERVAL '5 minutes'"; break;
        case '15m': bucketInterval = "INTERVAL '15 minutes'"; break;
        case '1h': bucketInterval = "INTERVAL '1 hour'"; break;
        case '1d': bucketInterval = "INTERVAL '1 day'"; break;
        default: bucketInterval = null; break;
    }

    if (!bucketInterval) {
        // Raw data query — order DESC with limit 2000 to keep the most recent data, then order ASC for charting
        const sql = `
            SELECT * FROM (
                SELECT 
                    device_id,
                    timestamp,
                    ROUND(v_rms, 2) AS v_rms,
                    ROUND(i_rms1, 2) AS i_rms1,
                    ROUND(i_rms2, 2) AS i_rms2,
                    ROUND(i_rms3, 2) AS i_rms3,
                    ROUND(i_rms4, 2) AS i_rms4,
                    ROUND(p_active, 2) AS p_active,
                    ROUND(temp, 1) AS temp,
                    ROUND(v_rms, 2) AS v_rms_max,
                    ROUND(i_rms1, 2) AS i_rms1_max,
                    ROUND(i_rms2, 2) AS i_rms2_max,
                    ROUND(i_rms3, 2) AS i_rms3_max,
                    ROUND(i_rms4, 2) AS i_rms4_max,
                    ROUND(p_active, 2) AS p_active_max,
                    ROUND(temp, 1) AS temp_max
                FROM telemetry
                WHERE (LOWER(device_id) = ? OR LOWER(device_id) = ?)
                  AND timestamp >= CAST(? AS TIMESTAMP)
                  AND timestamp <= CAST(? AS TIMESTAMP)
                ORDER BY timestamp DESC
                LIMIT 2000
            ) sub
            ORDER BY timestamp ASC
        `;
        return await queryAll(sql, [cleanDeviceId, prefixDeviceId, startDate, endDate]);
    } else {
        // Aggregated time bucket query using DuckDB time_bucket
        const pActiveExpr = isMaxMode ? 'ROUND(MAX(p_active), 2)' : 'ROUND(AVG(p_active), 2)';
        const vRmsExpr = isMaxMode ? 'ROUND(MAX(v_rms), 2)' : 'ROUND(AVG(v_rms), 2)';
        const iRms1Expr = isMaxMode ? 'ROUND(MAX(i_rms1), 2)' : 'ROUND(AVG(i_rms1), 2)';
        const iRms2Expr = isMaxMode ? 'ROUND(MAX(i_rms2), 2)' : 'ROUND(AVG(i_rms2), 2)';
        const iRms3Expr = isMaxMode ? 'ROUND(MAX(i_rms3), 2)' : 'ROUND(AVG(i_rms3), 2)';
        const iRms4Expr = isMaxMode ? 'ROUND(MAX(i_rms4), 2)' : 'ROUND(AVG(i_rms4), 2)';
        const tempExpr = isMaxMode ? 'ROUND(MAX(temp), 1)' : 'ROUND(AVG(temp), 1)';

        const sql = `
            SELECT * FROM (
                SELECT 
                    ? AS device_id,
                    time_bucket(${bucketInterval}, timestamp) AS bucket_time,
                    ROUND(AVG(v_rms), 2) AS v_rms_avg,
                    ROUND(MAX(v_rms), 2) AS v_rms_max,
                    ${vRmsExpr} AS v_rms,
                    ROUND(AVG(i_rms1), 2) AS i_rms1_avg,
                    ROUND(MAX(i_rms1), 2) AS i_rms1_max,
                    ${iRms1Expr} AS i_rms1,
                    ROUND(AVG(i_rms2), 2) AS i_rms2_avg,
                    ROUND(MAX(i_rms2), 2) AS i_rms2_max,
                    ${iRms2Expr} AS i_rms2,
                    ROUND(AVG(i_rms3), 2) AS i_rms3_avg,
                    ROUND(MAX(i_rms3), 2) AS i_rms3_max,
                    ${iRms3Expr} AS i_rms3,
                    ROUND(AVG(i_rms4), 2) AS i_rms4_avg,
                    ROUND(MAX(i_rms4), 2) AS i_rms4_max,
                    ${iRms4Expr} AS i_rms4,
                    ROUND(AVG(p_active), 2) AS p_active_avg,
                    ROUND(MAX(p_active), 2) AS p_active_max,
                    ${pActiveExpr} AS p_active,
                    ROUND(AVG(temp), 1) AS temp_avg,
                    ROUND(MAX(temp), 1) AS temp_max,
                    ${tempExpr} AS temp,
                    ROUND(SUM(p_active * (1.0 / 3600.0)) / 1000.0, 4) AS kwh_est
                FROM telemetry
                WHERE (LOWER(device_id) = ? OR LOWER(device_id) = ?)
                  AND timestamp >= CAST(? AS TIMESTAMP)
                  AND timestamp <= CAST(? AS TIMESTAMP)
                GROUP BY bucket_time
                ORDER BY bucket_time DESC
                LIMIT 2000
            ) sub
            ORDER BY bucket_time ASC
        `;
        return await queryAll(sql, [cleanDeviceId, cleanDeviceId, prefixDeviceId, startDate, endDate]);
    }
}

// Get device telemetry bounds (earliest, latest, count)
async function getDeviceTelemetryBounds(deviceId) {
    if (!conn) return null;
    await flushTelemetryBuffer();
    const cleanDeviceId = String(deviceId || '').toLowerCase().trim().replace(/^cu100_/, '');
    const prefixDeviceId = 'cu100_' + cleanDeviceId;
    const rows = await queryAll(`
        SELECT 
            MIN(timestamp) AS earliest,
            MAX(timestamp) AS latest,
            COUNT(*) AS total_records
        FROM telemetry
        WHERE LOWER(device_id) = ? OR LOWER(device_id) = ?
    `, [cleanDeviceId, prefixDeviceId]);
    if (!rows || rows.length === 0 || !rows[0].total_records) return null;
    return {
        earliest: rows[0].earliest ? safeToIsoString(rows[0].earliest, null) : null,
        latest: rows[0].latest ? safeToIsoString(rows[0].latest, null) : null,
        total_records: Number(rows[0].total_records) || 0
    };
}

// Delete historical telemetry for a specific device older than a cutoff date
async function deleteDeviceTelemetryOlderThan(deviceId, cutoffMs) {
    if (!conn) throw new Error('DuckDB not connected');
    const cleanDeviceId = String(deviceId || '').toLowerCase().trim().replace(/^cu100_/, '');
    const prefixDeviceId = 'cu100_' + cleanDeviceId;
    const defaultCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const cutoffDate = safeParseDate(cutoffMs, defaultCutoff);
    const cutoffIso = (cutoffDate && !isNaN(cutoffDate.getTime())) ? cutoffDate.toISOString() : defaultCutoff.toISOString();

    // SECURITY FIX: use parameterized query to prevent SQL injection
    await execQueryParams(
        `DELETE FROM telemetry WHERE (LOWER(device_id) = ? OR LOWER(device_id) = ?) AND timestamp < CAST(? AS TIMESTAMP)`,
        [cleanDeviceId, prefixDeviceId, cutoffIso]
    );
}

// Bulk purge expired telemetry records based on per-device owner retention rules
async function purgeExpiredTelemetry(deviceRules = []) {
    if (!conn) return;
    const now = Date.now();
    const defaultCutoffMs = now - (7 * 24 * 60 * 60 * 1000); // 7 days default

    const processedDevices = new Set();

    if (Array.isArray(deviceRules)) {
        for (const rule of deviceRules) {
            if (!rule || !rule.device_id) continue;
            const deviceId = String(rule.device_id).toLowerCase().trim().replace(/^cu100_/, '');
            processedDevices.add(deviceId);

            let days = 7;
            if (rule.retention_period === '30d') days = 30;
            else if (rule.retention_period === '180d') days = 180;
            else days = 7;

            const cutoffMs = now - (days * 24 * 60 * 60 * 1000);
            try {
                await deleteDeviceTelemetryOlderThan(deviceId, cutoffMs);
            } catch (err) {
                console.error(`[DuckDB Purge Error for device ${deviceId}]:`, err.message);
            }
        }
    }

    // Purge unowned/orphaned device records (not in deviceRules) older than default 7-day cutoff
    try {
        const defaultCutoffIso = new Date(defaultCutoffMs).toISOString();
        if (processedDevices.size > 0) {
            // SECURITY FIX: validate each device ID is strictly alphanumeric before embedding
            // in NOT IN clause. Device IDs are always [a-z0-9] from sanitizeSerial(), but
            // we re-validate here as an extra layer of defence.
            const safeDevList = Array.from(processedDevices)
                .filter(d => /^[a-z0-9]+$/.test(d))
                .map(d => `'${d}'`)
                .join(',');
            if (safeDevList) {
                await execQuery(`DELETE FROM telemetry WHERE device_id NOT IN (${safeDevList}) AND timestamp < CAST('${defaultCutoffIso}' AS TIMESTAMP)`);
            } else {
                await execQuery(`DELETE FROM telemetry WHERE timestamp < CAST('${defaultCutoffIso}' AS TIMESTAMP)`);
            }
        } else {
            await execQuery(`DELETE FROM telemetry WHERE timestamp < CAST('${defaultCutoffIso}' AS TIMESTAMP)`);
        }
    } catch (err) {
        console.error('[DuckDB Default Retention Purge Error]:', err.message);
    }
}

// Compute total kWh per channel and active sum for a specific time range
async function getMonthlyTelemetryTotals(deviceId, startTimeIso, endTimeIso) {
    if (!conn) return null;
    await flushTelemetryBuffer();
    const cleanDeviceId = String(deviceId || '').toLowerCase().trim().replace(/^cu100_/, '');
    const prefixDeviceId = 'cu100_' + cleanDeviceId;
    const safeStartIso = safeToIsoString(startTimeIso, new Date().toISOString());
    const safeEndIso = safeToIsoString(endTimeIso, new Date().toISOString());
    const sql = `
        SELECT 
            ROUND(COALESCE(SUM(i_rms1 * v_rms * (1.0 / 3600.0)) / 1000.0, 0), 4) AS kwh_ch1,
            ROUND(COALESCE(SUM(i_rms2 * v_rms * (1.0 / 3600.0)) / 1000.0, 0), 4) AS kwh_ch2,
            ROUND(COALESCE(SUM(i_rms3 * v_rms * (1.0 / 3600.0)) / 1000.0, 0), 4) AS kwh_ch3,
            ROUND(COALESCE(SUM(i_rms4 * v_rms * (1.0 / 3600.0)) / 1000.0, 0), 4) AS kwh_ch4,
            ROUND(COALESCE(SUM(p_active * (1.0 / 3600.0)) / 1000.0, 0), 4) AS kwh_total,
            COUNT(*) AS sample_count
        FROM telemetry
        WHERE (LOWER(device_id) = ? OR LOWER(device_id) = ?)
          AND timestamp >= CAST(? AS TIMESTAMP)
          AND timestamp < CAST(? AS TIMESTAMP)
    `;
    const rows = await queryAll(sql, [cleanDeviceId, prefixDeviceId, safeStartIso, safeEndIso]);
    return rows && rows.length > 0 ? rows[0] : null;
}

module.exports = {
    initTelemetryDb,
    enqueueTelemetry,
    flushTelemetryBuffer,
    getTelemetryHistory,
    getDeviceTelemetryBounds,
    getMonthlyTelemetryTotals,
    deleteDeviceTelemetryOlderThan,
    purgeExpiredTelemetry,
    execQueryParams,
    safeParseDate,
    safeToIsoString
};

