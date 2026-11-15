# CU100 ESP32-C3 Firmware

[![Board](https://img.shields.io/badge/ESP32--C3-SoC-blue)](https://www.espressif.com/en/products/socs/esp32-c3)
[![Framework](https://img.shields.io/badge/ESP--IDF-v5.0%2B%20%7C%20v6.0-red)](https://github.com/espressif/esp-idf)

Firmware for the **CU100 Multi-Channel Smart Energy Monitor**, built on the Espressif ESP32-C3 RISC-V microcontroller.

---

## ⚡ Hardware & Peripherals

- **Microcontroller**: ESP32-C3 (Single-core RISC-V @ 160MHz, 2.4GHz Wi-Fi + BLE 5)
- **ADC**: ADS1115 (16-bit I2C ADC) monitoring 4x Split-Core CT Current Sensors (SCT-013)
- **Temperature**: DS18B20 1-Wire digital thermometer
- **Connectivity**: Wi-Fi 802.11 b/g/n, MQTT over TCP (port 1883) with LWT support

### Default Pinout
| Function | ESP32-C3 GPIO | Peripheral / Protocol |
|---|---|---|
| I2C SDA | GPIO 4 | ADS1115 I2C Data |
| I2C SCL | GPIO 5 | ADS1115 I2C Clock |
| 1-Wire Data | GPIO 6 | DS18B20 Data (4.7kΩ pull-up to 3.3V) |
| Status LED | GPIO 8 | Activity / Connection Indicator |

---

## 🚀 Quick Start

### 1. Prerequisites
Install [ESP-IDF](https://docs.espressif.com/projects/esp-idf/en/latest/esp32c3/get-started/index.html) (v5.0 or later).

### 2. Build & Flash

```bash
# Set target to ESP32-C3 (first-time only)
idf.py set-target esp32c3

# Build firmware (or run ./idf.sh build)
idf.py build

# Flash to board & monitor serial output
idf.py -p /dev/ttyUSB0 flash monitor
```

> [!TIP]
> A helper script `idf.sh` is provided in this directory to automatically source the local ESP-IDF environment:
> ```bash
> ./idf.sh build
> ./idf.sh -p /dev/ttyUSB0 flash monitor
> ```

---

## 📡 MQTT Telemetry Format

The device publishes telemetry payloads every sampling interval to:
- **Topic**: `cu100/<SERIAL_NUMBER>/state`
- **Status (LWT)**: `cu100/<SERIAL_NUMBER>/status` (`online` / `offline`)

### Sample Payload
```json
{
  "serial": "a4cf1289b0c4",
  "v_rms": 230.5,
  "i_rms1": 1.25,
  "i_rms2": 0.45,
  "i_rms3": 3.80,
  "i_rms4": 0.12,
  "p_active": 1295.4,
  "temp": 28.5,
  "rssi": -62,
  "uptime": 3600
}
```

---

## 🏠 Home Assistant Integration

A sample REST integration configuration is provided in [`home_assistant_rest.yaml`](./home_assistant_rest.yaml) for polling real-time metrics directly from the device's local web server API.
