# 🚀 Postman API Documentation — CU100 Cloud Energy Monitor

Welcome to the **CU100 Cloud Energy Monitor REST API Documentation**. 

This repository includes a ready-to-import **Postman Collection v2.1.0** file:
📄 [`cu100_postman_collection.json`](./cu100_postman_collection.json)

---

## 📥 Quickstart: Import into Postman

1. Open **Postman**.
2. Click the **Import** button (top-left).
3. Choose **File** and select [`cu100_postman_collection.json`](./cu100_postman_collection.json).
4. In Postman, click on the **CU100 Cloud Energy Monitor API** collection, go to the **Variables** tab, and configure:
   - `baseUrl`: `http://localhost:3000` *(or your production server URL)*
   - `apiKey`: `cu100_sk_...` *(your Personal API Token generated from the dashboard UI)*
   - `deviceId`: `cu100-demo` *(or your physical device serial number)*

---

## 🔑 Authentication Methods

The API supports three authentication mechanisms:

1. **Personal API Token (Recommended for Postman & Scripts)**:
   - Header: `Authorization: Bearer cu100_sk_a1b2c3d4...`
   - Header: `X-API-Key: cu100_sk_a1b2c3d4...`
2. **Session Cookie**:
   - `Cookie: cu100_auth=<JWT_TOKEN>` *(sent automatically by web browsers)*
3. **Anonymous Access (Public Devices)**:
   - Public devices can be queried without any headers or tokens.

---

## 📊 Endpoints Summary

### 1. Telemetry Historical Data (DuckDB)

#### `GET /api/telemetry/history`
Retrieves historical telemetry metrics (voltage, 4-channel active currents/power, temperature, and calculated kWh).

- **Query Parameters**:
  - `device_id` *(Required)*: Serial number of the CU100 device.
  - `resolution` *(Optional)*: Aggregation bucket size:
    - `raw`: High-frequency raw data (Up to 2,000 points).
    - `1m`: 1-minute averaged/peak rollups + kWh estimate.
    - `5m`: 5-minute averaged/peak rollups + kWh estimate.
    - `1h`: 1-hour averaged/peak rollups + kWh estimate.
    - `1d`: 1-day averaged/peak rollups + kWh estimate.
  - `agg` *(Optional)*: Metric aggregation mode:
    - `avg`: Average values across bucket interval (Default).
    - `max`: Peak / Maximum values across bucket interval (detects load spikes).
  - `start` *(Optional)*: Start timestamp in milliseconds.
  - `end` *(Optional)*: End timestamp in milliseconds.

**Sample Request**:
```http
GET /api/telemetry/history?device_id=cu100-demo&resolution=5m&agg=max HTTP/1.1
Host: localhost:3000
Authorization: Bearer cu100_sk_a1b2c3d4e5f6...
```

**Sample Response (`200 OK`)**:
```json
{
  "device_id": "cu100-demo",
  "count": 1,
  "start": 1700000000000,
  "end": 1700086400000,
  "resolution": "5m",
  "aggregation": "max",
  "data": [
    {
      "device_id": "cu100-demo",
      "bucket_time": "2026-08-25T08:00:00.000Z",
      "v_rms": 224.1,
      "v_rms_avg": 220.4,
      "v_rms_max": 224.1,
      "i_rms1": 12.50,
      "i_rms1_avg": 4.12,
      "i_rms1_max": 12.50,
      "p_active": 2800.0,
      "p_active_avg": 1359.8,
      "p_active_max": 2800.0,
      "temp": 34.2,
      "temp_avg": 32.5,
      "temp_max": 34.2,
      "kwh_est": 0.1133
    }
  ]
}
```

- **Response Fields Reference (`data[]` record)**:

| Field | Type | Unit | Description |
| :--- | :--- | :--- | :--- |
| `device_id` | String | - | Unique hardware serial number / MAC address of the device (e.g. `"e83dc19c35c0"`). |
| `bucket_time` | String (ISO UTC) | - | Start timestamp of the aggregated interval (e.g. `"2026-08-24T03:20:00.000Z"`). Present when `resolution` is set (`1m`, `5m`, `1h`, `1d`). |
| `timestamp` | String (ISO UTC) | - | Timestamp of individual record. Present when `resolution=raw`. |
| `v_rms` | Number | Volts (**V**) | Selected metric value (Average or MAX depending on `agg` parameter). |
| `v_rms_max` / `v_rms_avg` | Number | Volts (**V**) | Peak (MAX) and Average AC Root Mean Square Line Voltage. |
| `i_rms1` .. `4` | Number | Amperes (**A**) | Selected AC current metric drawn by load on Channel 1..4. |
| `i_rms1_max` .. `4_max` | Number | Amperes (**A**) | Peak (MAX) AC current spike during the bucket interval. |
| `p_active` | Number | Watts (**W**) | Selected total active real power metric across channels. |
| `p_active_max` | Number | Watts (**W**) | Peak (MAX) active power spike during the bucket interval. |
| `temp` / `temp_max` | Number | Celsius (**°C**) | Average and Peak (MAX) ambient enclosure temperature. |
| `kwh_est` | Number | **kWh** | Estimated energy consumption during this interval. |

---

### 2. Personal API Tokens

#### `GET /api/user/tokens`
Lists active Personal API tokens for the logged-in user.

#### `POST /api/user/tokens`
Generates a new Personal API token. Secret is returned **once**.
- **Body**:
  ```json
  {
    "name": "Postman Analytics Key"
  }
  ```
- **Response**:
  ```json
  {
    "message": "API token generated successfully",
    "token": {
      "id": 1,
      "name": "Postman Analytics Key",
      "token_prefix": "cu100_sk_a1b2...",
      "secret": "cu100_sk_a1b2c3d4e5f6...",
      "created_at": "2026-08-25T09:40:00.000Z"
    }
  }
  ```

#### `DELETE /api/user/tokens/:id`
Revokes an API token by ID.

---

### 3. Authentication & Profile

#### `GET /api/auth/config`
Retrieves public authentication configuration.
- **Response**:
  ```json
  {
    "recaptchaSiteKey": "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI",
    "recaptchaEnabled": true
  }
  ```

#### `POST /api/auth/login`
Logs in user or admin.
- **Body**:
  ```json
  {
    "username": "user@example.com",
    "password": "your_password",
    "recaptchaToken": "03AFcWeA7..." // Required when reCAPTCHA is enabled
  }
  ```

#### `GET /api/auth/me`
Gets current logged-in user profile.

#### `POST /api/auth/logout`
Clears session cookie.

---

### 4. Device Management

#### `GET /api/devices`
Lists devices owned by the user.

#### `GET /api/devices/check-access/:deviceId`
Checks if device serial is registered and public/private status.

#### `POST /api/devices`
Registers new device.
- **Body**:
  ```json
  {
    "device_id": "a4cf1289b0c4",
    "name": "Main Panel CT",
    "location": "Basement",
    "visibility": "public"
  }
  ```

#### `PUT /api/devices/:id`
Updates device details or visibility (`public` / `private`).

#### `DELETE /api/devices/:id`
Deletes a device.

---

### 5. Admin Back-Office (Admin Role Required)

- `GET /api/admin/users`: List all users.
- `GET /api/admin/audit-log`: View security audit log.
- `GET /api/admin/retention`: View system data retention policy.
- `PUT /api/admin/retention`: Update retention policy (`7d`, `30d`, `180d`).
- `POST /api/admin/purge-retention`: Trigger manual data retention purge.
