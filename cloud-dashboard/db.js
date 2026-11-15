const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'cu100_cloud.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('[DB] Failed to connect to SQLite database:', err.message);
    } else {
        console.log(`[DB] Connected to SQLite database at: ${DB_PATH}`);
    }
});

// Promisified helper methods
function queryGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function queryAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function queryRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

// Database Initialization & Migrations
async function initDb() {
    console.log('[DB] Initializing Database Schema...');

    // 1. Users Table
    await queryRun(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT CHECK(role IN ('admin', 'user')) DEFAULT 'user',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 2. Devices Table
    await queryRun(`
        CREATE TABLE IF NOT EXISTS devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            location TEXT NOT NULL,
            owner_id INTEGER,
            visibility TEXT CHECK(visibility IN ('public', 'private')) DEFAULT 'public',
            electricity_rate REAL DEFAULT 0.00,
            currency TEXT CHECK(currency IN ('IDR', 'USD')) DEFAULT 'IDR',
            voltage REAL DEFAULT 220.0,
            ch1_label TEXT DEFAULT 'Channel 1',
            ch2_label TEXT DEFAULT 'Channel 2',
            ch3_label TEXT DEFAULT 'Channel 3',
            ch4_label TEXT DEFAULT 'Channel 4',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
        )
    `);

    // 3. Monthly Energy History Table (Cloud-calculated, reset monthly)
    await queryRun(`
        CREATE TABLE IF NOT EXISTS monthly_energy (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            year_month TEXT NOT NULL,
            kwh_ch1 REAL DEFAULT 0.0,
            kwh_ch2 REAL DEFAULT 0.0,
            kwh_ch3 REAL DEFAULT 0.0,
            kwh_ch4 REAL DEFAULT 0.0,
            kwh_total REAL DEFAULT 0.0,
            cost_total REAL DEFAULT 0.0,
            currency TEXT DEFAULT 'IDR',
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(device_id, year_month)
        )
    `);

    // 4. System Settings Table
    await queryRun(`
        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `);
    await queryRun(`INSERT OR IGNORE INTO system_settings (key, value) VALUES ('retention_period', '7d')`);

    // 5. Admin Audit Log Table
    await queryRun(`
        CREATE TABLE IF NOT EXISTS admin_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            admin_username TEXT NOT NULL,
            action TEXT NOT NULL,
            target_type TEXT,
            target_id TEXT,
            details TEXT,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 6. API Tokens Table
    await queryRun(`
        CREATE TABLE IF NOT EXISTS api_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            token_prefix TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at DATETIME,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // 7. Password Reset Tokens Table
    await queryRun(`
        CREATE TABLE IF NOT EXISTS password_resets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT UNIQUE NOT NULL,
            expires_at DATETIME NOT NULL,
            used INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    await queryRun(`CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash)`);


    // --- Column Migrations (safe ALTER TABLE, ignore if already exists) ---
    try { await queryRun(`ALTER TABLE users ADD COLUMN mqtt_user TEXT`); } catch (e) {}
    try { await queryRun(`ALTER TABLE users ADD COLUMN mqtt_pass TEXT`); } catch (e) {}
    try { await queryRun(`ALTER TABLE users ADD COLUMN mqtt_pass_hash TEXT`); } catch (e) {}
    try { await queryRun(`ALTER TABLE users ADD COLUMN retention_period TEXT DEFAULT '7d'`); } catch (e) {}
    try { await queryRun(`ALTER TABLE devices ADD COLUMN electricity_rate REAL DEFAULT 0.00`); } catch (e) {}
    try { await queryRun(`ALTER TABLE devices ADD COLUMN currency TEXT DEFAULT 'IDR'`); } catch (e) {}
    try { await queryRun(`ALTER TABLE devices ADD COLUMN voltage REAL DEFAULT 220.0`); } catch (e) {}
    try { await queryRun(`ALTER TABLE devices ADD COLUMN ch1_label TEXT DEFAULT 'Channel 1'`); } catch (e) {}
    try { await queryRun(`ALTER TABLE devices ADD COLUMN ch2_label TEXT DEFAULT 'Channel 2'`); } catch (e) {}
    try { await queryRun(`ALTER TABLE devices ADD COLUMN ch3_label TEXT DEFAULT 'Channel 3'`); } catch (e) {}
    try { await queryRun(`ALTER TABLE devices ADD COLUMN ch4_label TEXT DEFAULT 'Channel 4'`); } catch (e) {}

    // 5. Seed Default Admin User if no admin exists
    const adminUser = await queryGet(`SELECT * FROM users WHERE role = 'admin'`);
    if (!adminUser) {
        // SECURITY: Use ADMIN_INIT_PASSWORD env var or generate a strong random password
        const defaultPassword = process.env.ADMIN_INIT_PASSWORD || (() => {
            const generated = 'adm_' + crypto.randomBytes(12).toString('hex');
            console.warn('\n⚠️  [DB SECURITY] No ADMIN_INIT_PASSWORD env var set.');
            console.warn(`⚠️  [DB SECURITY] Generated one-time admin password: "${generated}"`);
            console.warn('⚠️  [DB SECURITY] SAVE THIS NOW — it will not be shown again.\n');
            return generated;
        })();

        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(defaultPassword, salt);
        const { mqttUser, mqttPass } = generateMqttCredentials('admin');
        const mqttPassHash = bcrypt.hashSync(mqttPass, 10);

        await queryRun(
            `INSERT INTO users (username, email, password_hash, role, mqtt_user, mqtt_pass, mqtt_pass_hash) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ['admin', 'admin@currentusage.com', hash, 'admin', mqttUser, mqttPass, mqttPassHash]
        );
        console.log('[DB] Default Admin User created: username="admin"');
    }

    // 6. Migrate existing users: generate mqtt_pass_hash for any missing it
    const usersNeedingHash = await queryAll(
        `SELECT id, username, mqtt_pass FROM users WHERE (mqtt_pass_hash IS NULL OR mqtt_pass_hash = '') AND mqtt_pass IS NOT NULL AND mqtt_pass != ''`
    );
    for (const u of usersNeedingHash) {
        const hash = bcrypt.hashSync(u.mqtt_pass, 10);
        await queryRun(`UPDATE users SET mqtt_pass_hash = ? WHERE id = ?`, [hash, u.id]);
        console.log(`[DB] Migrated MQTT password to bcrypt hash for user: ${u.username}`);
    }

    // 7. Auto-generate MQTT credentials for users missing them entirely
    const unprovisionedUsers = await queryAll(`SELECT id, username FROM users WHERE mqtt_user IS NULL OR mqtt_user = ''`);
    for (const u of unprovisionedUsers) {
        const { mqttUser, mqttPass } = generateMqttCredentials(u.username);
        const mqttPassHash = bcrypt.hashSync(mqttPass, 10);
        await queryRun(`UPDATE users SET mqtt_user = ?, mqtt_pass = ?, mqtt_pass_hash = ? WHERE id = ?`, [mqttUser, mqttPass, mqttPassHash, u.id]);
    }
}

function generateMqttCredentials(username) {
    const cleanUser = (username || 'user').toLowerCase().replace(/[^a-z0-9]/g, '');
    const mqttUser = `dev_${cleanUser}`;
    const mqttPass = 'mq_' + crypto.randomBytes(8).toString('hex');
    return { mqttUser, mqttPass };
}

module.exports = {
    db,
    initDb,
    queryGet,
    queryAll,
    queryRun,
    generateMqttCredentials
};
