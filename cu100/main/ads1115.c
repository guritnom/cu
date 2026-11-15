#include "ads1115.h"
#include "mqtt_manager.h"
#include <stdio.h>
#include <math.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "driver/i2c_master.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "esp_timer.h"

static const char *TAG = "ADS1115";

#define ADS1115_SAMPLE_COUNT 172 // ~200ms at 860 SPS (exactly 10 cycles of 50Hz, 12 cycles of 60Hz)
#define NO_LOAD_CUTOFF_A     0.08f // Ignore readings below 80mA (noise threshold)
#define NVS_CAL_NAMESPACE    "ads_calib"

// I2C Handles
static i2c_master_bus_handle_t i2c_bus_handle = NULL;
static i2c_master_dev_handle_t ads_dev_handle = NULL;

// Synchronization and Storage
static SemaphoreHandle_t alrt_sem = NULL;
static SemaphoreHandle_t readings_mutex = NULL;
static float latest_currents[4] = {0.0f, 0.0f, 0.0f, 0.0f};
static float calibration_factors[4] = {30.0f, 30.0f, 30.0f, 30.0f};
static int active_alrt_pin = -1;

#define ASSUMED_PF            1.0f
#define NVS_KWH_NAMESPACE     "ads_kwh"
#define NVS_WRITE_INTERVAL_US 300000000LL // 5 minutes in microseconds

static float assumed_voltage = 220.0f;
static float kwh_rate = 0.0f;
static char kwh_currency[8] = "IDR";
static float latest_kwh[4] = {0.0f, 0.0f, 0.0f, 0.0f};
static double accumulated_ws[4] = {0.0, 0.0, 0.0, 0.0};
static int64_t last_sample_time = 0;
static int64_t last_nvs_write_time = 0;

static void ads1115_load_calibration(void);
static void ads1115_load_kwh(void);
static void ads1115_save_kwh(void);
static void ads1115_load_voltage(void);
static void ads1115_load_kwh_rate(void);
static void ads1115_load_currency(void);

// ISR Handler
static void IRAM_ATTR alrt_gpio_isr_handler(void* arg)
{
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;
    xSemaphoreGiveFromISR(alrt_sem, &xHigherPriorityTaskWoken);
    if (xHigherPriorityTaskWoken == pdTRUE) {
        portYIELD_FROM_ISR();
    }
}

// I2C Register Write Helper
static esp_err_t ads1115_write_reg(uint8_t reg, uint16_t value)
{
    if (!ads_dev_handle) return ESP_ERR_INVALID_STATE;
    uint8_t data[3] = { reg, (uint8_t)(value >> 8), (uint8_t)(value & 0xFF) };
    return i2c_master_transmit(ads_dev_handle, data, 3, 100);
}

// I2C Register Read Helper
static esp_err_t ads1115_read_reg(uint8_t reg, uint16_t *value)
{
    if (!ads_dev_handle) return ESP_ERR_INVALID_STATE;
    uint8_t data[2] = { 0 };
    esp_err_t err = i2c_master_transmit_receive(ads_dev_handle, &reg, 1, data, 2, 100);
    if (err == ESP_OK) {
        *value = (data[0] << 8) | data[1];
    }
    return err;
}

// Initialize I2C and GPIO
esp_err_t ads1115_init(gpio_num_t scl_pin, gpio_num_t sda_pin, gpio_num_t alrt_pin)
{
    active_alrt_pin = alrt_pin;

    // 1. Create Semaphores
    alrt_sem = xSemaphoreCreateBinary();
    readings_mutex = xSemaphoreCreateMutex();
    if (!alrt_sem || !readings_mutex) {
        ESP_LOGE(TAG, "Failed to create semaphores");
        return ESP_ERR_NO_MEM;
    }

    // 2. Configure I2C Master Bus
    i2c_master_bus_config_t bus_config = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = sda_pin,
        .scl_io_num = scl_pin,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    esp_err_t err = i2c_new_master_bus(&bus_config, &i2c_bus_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to initialize I2C master bus: %s", esp_err_to_name(err));
        return err;
    }

    // 3. Add ADS1115 Device to the Bus
    i2c_device_config_t dev_config = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = ADS1115_I2C_ADDR,
        .scl_speed_hz = 100000, // 100 kHz Standard Mode (more stable with weak pull-ups)
    };
    err = i2c_master_bus_add_device(i2c_bus_handle, &dev_config, &ads_dev_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to add ADS1115 to I2C bus: %s", esp_err_to_name(err));
        return err;
    }

    // 4. Configure ALRT GPIO
    gpio_config_t io_conf = {
        .intr_type = GPIO_INTR_NEGEDGE, // Falling edge triggers when conversion is ready
        .pin_bit_mask = (1ULL << alrt_pin),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE, // ADS1115 ALRT pin is open-drain, requires pull-up
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
    };
    err = gpio_config(&io_conf);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to configure ALRT GPIO: %s", esp_err_to_name(err));
        return err;
    }

    // 5. Install GPIO ISR Service and Add Handler
    err = gpio_install_isr_service(0);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "Failed to install GPIO ISR service: %s", esp_err_to_name(err));
        return err;
    }
    
    err = gpio_isr_handler_add(alrt_pin, alrt_gpio_isr_handler, (void*)(uint32_t)alrt_pin);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to add GPIO ISR handler: %s", esp_err_to_name(err));
        return err;
    }

    // Load calibration factors from NVS
    ads1115_load_calibration();
    ads1115_load_kwh();
    ads1115_load_voltage();
    ads1115_load_kwh_rate();
    ads1115_load_currency();

    ESP_LOGI(TAG, "I2C and ALRT GPIO successfully initialized");
    return ESP_OK;
}

// Background Sampling Task
static void ads1115_sampling_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Sampling task started");
    uint16_t samples[ADS1115_SAMPLE_COUNT];

    // Array of channel multiplexer values
    const uint16_t mux_channels[4] = {
        ADS1115_MUX_AIN0,
        ADS1115_MUX_AIN1,
        ADS1115_MUX_AIN2,
        ADS1115_MUX_AIN3
    };

    while (1) {
        int64_t now = esp_timer_get_time();
        if (last_sample_time == 0) {
            last_sample_time = now;
        }
        float dt = (float)(now - last_sample_time) / 1000000.0f;
        last_sample_time = now;

        for (int ch = 0; ch < 4; ch++) {
            // 1. Set Threshold Registers to configure ALRT/RDY as conversion ready pin
            // Write MSB=0 to Lo_thresh and MSB=1 to Hi_thresh
            esp_err_t err_lo = ads1115_write_reg(ADS1115_REG_LO_THRESH, 0x0000);
            esp_err_t err_hi = ads1115_write_reg(ADS1115_REG_HI_THRESH, 0x8000);
            if (err_lo != ESP_OK || err_hi != ESP_OK) {
                ESP_LOGE(TAG, "Failed to configure conversion-ready thresholds. Lo err: %s, Hi err: %s", 
                         esp_err_to_name(err_lo), esp_err_to_name(err_hi));
                vTaskDelay(pdMS_TO_TICKS(1000));
                continue;
            }

            // 2. Configure and start continuous conversion on selected channel
            // MUX: selected channel, PGA: +/-4.096V, Mode: Continuous, DR: 860SPS
            // Queue: Assert after 1 conversion (enables ALRT/RDY pin)
            uint16_t config = mux_channels[ch] | 
                              ADS1115_PGA_4_096V | 
                              ADS1115_MODE_CONTINUOUS | 
                              ADS1115_DR_860SPS | 
                              ADS1115_COMP_QUE_1CONV;
            
            if (ads1115_write_reg(ADS1115_REG_CONFIG, config) != ESP_OK) {
                ESP_LOGE(TAG, "Failed to write config for channel %d", ch);
                vTaskDelay(pdMS_TO_TICKS(1000));
                continue;
            }

            // Drain any pending semaphores before beginning sampling
            xSemaphoreTake(alrt_sem, 0);

            // 3. Collect samples using ALRT pin triggers
            bool sampling_error = false;
            for (int i = 0; i < ADS1115_SAMPLE_COUNT; i++) {
                // Wait for ALRT pin falling edge (max 20ms timeout)
                if (xSemaphoreTake(alrt_sem, pdMS_TO_TICKS(20)) == pdTRUE) {
                    uint16_t raw_val = 0;
                    if (ads1115_read_reg(ADS1115_REG_CONVERSION, &raw_val) == ESP_OK) {
                        samples[i] = raw_val;
                    } else {
                        sampling_error = true;
                        ESP_LOGE(TAG, "Error reading conversion register at index %d", i);
                        break;
                    }
                } else {
                    sampling_error = true;
                    ESP_LOGE(TAG, "Timeout waiting for conversion on channel %d", ch);
                    break;
                }
            }

            // 4. Power down the device temporarily while calculating (stops continuous conversion)
            uint16_t pd_config = mux_channels[ch] | 
                                 ADS1115_PGA_4_096V | 
                                 ADS1115_MODE_SINGLE | 
                                 ADS1115_DR_128SPS | 
                                 ADS1115_COMP_QUE_DISABLE;
            ads1115_write_reg(ADS1115_REG_CONFIG, pd_config);

            if (sampling_error) {
                // Skip calculation for this channel if sampling failed
                vTaskDelay(pdMS_TO_TICKS(100));
                continue;
            }

            // 5. Compute RMS Current
            // Calculate Average (DC Bias)
            double sum = 0.0;
            for (int i = 0; i < ADS1115_SAMPLE_COUNT; i++) {
                // Convert uint16_t to signed int16_t
                int16_t signed_val = (int16_t)samples[i];
                sum += signed_val;
            }
            double avg = sum / ADS1115_SAMPLE_COUNT;

            // Calculate Mean of Squares of the AC component
            double sum_sq = 0.0;
            for (int i = 0; i < ADS1115_SAMPLE_COUNT; i++) {
                int16_t signed_val = (int16_t)samples[i];
                double diff = (double)signed_val - avg;
                sum_sq += diff * diff;
            }
            double rms_counts = sqrt(sum_sq / ADS1115_SAMPLE_COUNT);

            // Convert RMS raw counts to Current (Amperes)
            // LSB = 4.096V / 32768 = 125uV = 0.000125V
            // Current = (rms_counts * 0.000125) * calibration_factor
            float rms_current = (float)(rms_counts * 0.000125 * calibration_factors[ch]);

            // Apply low-load current cutoff (creep threshold) to filter noise
            if (rms_current < NO_LOAD_CUTOFF_A) {
                rms_current = 0.0f;
            }

            // Save the reading and accumulate energy thread-safely
            if (xSemaphoreTake(readings_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
                latest_currents[ch] = rms_current;
                
                // Calculate energy integration (kWh)
                double power_w = (double)(assumed_voltage * rms_current * ASSUMED_PF);
                accumulated_ws[ch] += power_w * (double)dt;
                latest_kwh[ch] = (float)(accumulated_ws[ch] / 3600000.0);
                
                xSemaphoreGive(readings_mutex);
            }

            // Brief delay between channel switching to settle the input multiplexer
            vTaskDelay(pdMS_TO_TICKS(20));
        }
        
        // Publish current readings to local HA and Cloud platforms
        float currents_data[4];
        for (int i = 0; i < 4; i++) {
            currents_data[i] = ads1115_get_current(i);
        }
        mqtt_manager_publish_currents(currents_data);

        // Periodically write accumulated energy to NVS
        if (now - last_nvs_write_time > NVS_WRITE_INTERVAL_US) {
            last_nvs_write_time = now;
            ads1115_save_kwh();
        }
        
        // Sleep for a short while before starting the next measurement sweep
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

void ads1115_start_sampling_task(void)
{
    xTaskCreate(
        ads1115_sampling_task,
        "ads1115_sample",
        4096,
        NULL,
        5, // High priority to ensure stable sampling intervals
        NULL
    );
}

float ads1115_get_current(int channel)
{
    if (channel < 0 || channel >= 4) return 0.0f;
    float current = 0.0f;
    if (readings_mutex && xSemaphoreTake(readings_mutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        current = latest_currents[channel];
        xSemaphoreGive(readings_mutex);
    }
    return current;
}

float ads1115_get_watts(int channel)
{
    if (channel < 0 || channel >= 4) return 0.0f;
    float watts = 0.0f;
    if (readings_mutex && xSemaphoreTake(readings_mutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        watts = latest_currents[channel] * assumed_voltage * ASSUMED_PF;
        xSemaphoreGive(readings_mutex);
    } else {
        watts = latest_currents[channel] * assumed_voltage * ASSUMED_PF;
    }
    return watts;
}

static void ads1115_load_calibration(void)
{
    nvs_handle_t nvs_handle;
    esp_err_t err = nvs_open(NVS_CAL_NAMESPACE, NVS_READONLY, &nvs_handle);
    if (err == ESP_OK) {
        for (int i = 0; i < 4; i++) {
            char key[8];
            snprintf(key, sizeof(key), "cal_%d", i);
            uint32_t raw_val;
            if (nvs_get_u32(nvs_handle, key, &raw_val) == ESP_OK) {
                memcpy(&calibration_factors[i], &raw_val, sizeof(float));
            } else {
                calibration_factors[i] = 30.0f;
            }
        }
        nvs_close(nvs_handle);
    } else {
        for (int i = 0; i < 4; i++) {
            calibration_factors[i] = 30.0f;
        }
    }
    ESP_LOGI(TAG, "Loaded calibration factors: %.2f, %.2f, %.2f, %.2f",
             calibration_factors[0], calibration_factors[1], calibration_factors[2], calibration_factors[3]);
}

esp_err_t ads1115_save_calibration(const float *factors)
{
    nvs_handle_t nvs_handle;
    esp_err_t err = nvs_open(NVS_CAL_NAMESPACE, NVS_READWRITE, &nvs_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open NVS for calibration save: %s", esp_err_to_name(err));
        return err;
    }

    for (int i = 0; i < 4; i++) {
        char key[8];
        snprintf(key, sizeof(key), "cal_%d", i);
        uint32_t raw_val;
        memcpy(&raw_val, &factors[i], sizeof(float));
        err = nvs_set_u32(nvs_handle, key, raw_val);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "Failed to write key %s: %s", key, esp_err_to_name(err));
            break;
        }
    }
    
    if (err == ESP_OK) {
        err = nvs_commit(nvs_handle);
    }
    nvs_close(nvs_handle);
    
    if (err == ESP_OK) {
        // Update in memory dynamically
        if (readings_mutex && xSemaphoreTake(readings_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            for (int i = 0; i < 4; i++) {
                calibration_factors[i] = factors[i];
            }
            xSemaphoreGive(readings_mutex);
        }
        ESP_LOGI(TAG, "Dynamic calibration saved successfully");
    }
    return err;
}

void ads1115_get_calibration(float *factors)
{
    if (readings_mutex && xSemaphoreTake(readings_mutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        for (int i = 0; i < 4; i++) {
            factors[i] = calibration_factors[i];
        }
        xSemaphoreGive(readings_mutex);
    } else {
        // Fallback if mutex is locked
        for (int i = 0; i < 4; i++) {
            factors[i] = calibration_factors[i];
        }
    }
}

static void ads1115_load_kwh(void)
{
    nvs_handle_t nvs_handle;
    if (nvs_open(NVS_KWH_NAMESPACE, NVS_READONLY, &nvs_handle) == ESP_OK) {
        for (int i = 0; i < 4; i++) {
            char key[16];
            snprintf(key, sizeof(key), "kwh_%d", i);
            uint32_t raw_val = 0;
            if (nvs_get_u32(nvs_handle, key, &raw_val) == ESP_OK) {
                float temp_kwh;
                memcpy(&temp_kwh, &raw_val, sizeof(float));
                latest_kwh[i] = temp_kwh;
                accumulated_ws[i] = (double)temp_kwh * 3600000.0;
            }
        }
        nvs_close(nvs_handle);
    }
    ESP_LOGI(TAG, "Loaded accumulated kWh: %.3f, %.3f, %.3f, %.3f",
             latest_kwh[0], latest_kwh[1], latest_kwh[2], latest_kwh[3]);
}

static void ads1115_save_kwh(void)
{
    nvs_handle_t nvs_handle;
    if (nvs_open(NVS_KWH_NAMESPACE, NVS_READWRITE, &nvs_handle) == ESP_OK) {
        for (int i = 0; i < 4; i++) {
            char key[16];
            snprintf(key, sizeof(key), "kwh_%d", i);
            uint32_t raw_val;
            float temp_kwh = latest_kwh[i];
            memcpy(&raw_val, &temp_kwh, sizeof(float));
            nvs_set_u32(nvs_handle, key, raw_val);
        }
        nvs_commit(nvs_handle);
        nvs_close(nvs_handle);
        ESP_LOGI(TAG, "Saved kWh values to NVS");
    }
}

float ads1115_get_kwh(int channel)
{
    if (channel < 0 || channel >= 4) return 0.0f;
    float kwh = 0.0f;
    if (readings_mutex && xSemaphoreTake(readings_mutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        kwh = latest_kwh[channel];
        xSemaphoreGive(readings_mutex);
    } else {
        kwh = latest_kwh[channel];
    }
    if (kwh <= 0.0f || isnan(kwh)) {
        kwh = 0.0f;
    }
    return kwh;
}

void ads1115_reset_kwh(void)
{
    if (readings_mutex && xSemaphoreTake(readings_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        for (int i = 0; i < 4; i++) {
            latest_kwh[i] = 0.0f;
            accumulated_ws[i] = 0.0;
        }
        xSemaphoreGive(readings_mutex);
        ads1115_save_kwh();
        ESP_LOGI(TAG, "Reset energy (kWh) counters for all channels");
    }
}

static void ads1115_load_voltage(void)
{
    nvs_handle_t nvs_handle;
    if (nvs_open(NVS_CAL_NAMESPACE, NVS_READONLY, &nvs_handle) == ESP_OK) {
        uint32_t raw_val = 0;
        if (nvs_get_u32(nvs_handle, "vol_ref", &raw_val) == ESP_OK) {
            memcpy(&assumed_voltage, &raw_val, sizeof(float));
        } else {
            assumed_voltage = 220.0f;
        }
        nvs_close(nvs_handle);
    } else {
        assumed_voltage = 220.0f;
    }
    ESP_LOGI(TAG, "Loaded assumed voltage: %.1fV", assumed_voltage);
}

esp_err_t ads1115_save_voltage(float voltage)
{
    if (voltage <= 0.0f) {
        return ESP_ERR_INVALID_ARG;
    }
    nvs_handle_t nvs_handle;
    esp_err_t err = nvs_open(NVS_CAL_NAMESPACE, NVS_READWRITE, &nvs_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open NVS for voltage save: %s", esp_err_to_name(err));
        return err;
    }

    uint32_t raw_val;
    memcpy(&raw_val, &voltage, sizeof(float));
    err = nvs_set_u32(nvs_handle, "vol_ref", raw_val);
    if (err == ESP_OK) {
        err = nvs_commit(nvs_handle);
    }
    nvs_close(nvs_handle);

    if (err == ESP_OK) {
        if (readings_mutex && xSemaphoreTake(readings_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            assumed_voltage = voltage;
            xSemaphoreGive(readings_mutex);
        } else {
            assumed_voltage = voltage;
        }
        ESP_LOGI(TAG, "Assumed voltage saved successfully: %.1fV", voltage);
    }
    return err;
}

float ads1115_get_voltage(void)
{
    float voltage = 220.0f;
    if (readings_mutex && xSemaphoreTake(readings_mutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        voltage = assumed_voltage;
        xSemaphoreGive(readings_mutex);
    } else {
        voltage = assumed_voltage;
    }
    return voltage;
}

static void ads1115_load_kwh_rate(void)
{
    nvs_handle_t nvs_handle;
    if (nvs_open(NVS_CAL_NAMESPACE, NVS_READONLY, &nvs_handle) == ESP_OK) {
        uint32_t raw_val = 0;
        if (nvs_get_u32(nvs_handle, "kwh_rate", &raw_val) == ESP_OK) {
            memcpy(&kwh_rate, &raw_val, sizeof(float));
        } else {
            kwh_rate = 0.0f;
        }
        nvs_close(nvs_handle);
    } else {
        kwh_rate = 0.0f;
    }
    ESP_LOGI(TAG, "Loaded kWh rate: %.2f", kwh_rate);
}

static void ads1115_load_currency(void)
{
    nvs_handle_t nvs_handle;
    if (nvs_open(NVS_CAL_NAMESPACE, NVS_READONLY, &nvs_handle) == ESP_OK) {
        size_t required_len = sizeof(kwh_currency);
        if (nvs_get_str(nvs_handle, "currency", kwh_currency, &required_len) != ESP_OK) {
            strncpy(kwh_currency, "IDR", sizeof(kwh_currency) - 1);
        }
        nvs_close(nvs_handle);
    } else {
        strncpy(kwh_currency, "IDR", sizeof(kwh_currency) - 1);
    }
    ESP_LOGI(TAG, "Loaded currency: %s", kwh_currency);
}

esp_err_t ads1115_save_kwh_rate(float rate)
{
    if (rate < 0.0f) {
        rate = 0.0f;
    }
    nvs_handle_t nvs_handle;
    esp_err_t err = nvs_open(NVS_CAL_NAMESPACE, NVS_READWRITE, &nvs_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open NVS for kWh rate save: %s", esp_err_to_name(err));
        return err;
    }

    uint32_t raw_val;
    memcpy(&raw_val, &rate, sizeof(float));
    err = nvs_set_u32(nvs_handle, "kwh_rate", raw_val);
    if (err == ESP_OK) {
        err = nvs_commit(nvs_handle);
    }
    nvs_close(nvs_handle);

    if (err == ESP_OK) {
        if (readings_mutex && xSemaphoreTake(readings_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            kwh_rate = rate;
            xSemaphoreGive(readings_mutex);
        } else {
            kwh_rate = rate;
        }
        ESP_LOGI(TAG, "kWh rate saved successfully: %.2f", rate);
    }
    return err;
}

float ads1115_get_kwh_rate(void)
{
    float rate = 0.0f;
    if (readings_mutex && xSemaphoreTake(readings_mutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        rate = kwh_rate;
        xSemaphoreGive(readings_mutex);
    } else {
        rate = kwh_rate;
    }
    return rate;
}

esp_err_t ads1115_save_currency(const char *currency)
{
    if (!currency || (strcmp(currency, "IDR") != 0 && strcmp(currency, "USD") != 0)) {
        currency = "IDR";
    }
    nvs_handle_t nvs_handle;
    esp_err_t err = nvs_open(NVS_CAL_NAMESPACE, NVS_READWRITE, &nvs_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open NVS for currency save: %s", esp_err_to_name(err));
        return err;
    }

    err = nvs_set_str(nvs_handle, "currency", currency);
    if (err == ESP_OK) {
        err = nvs_commit(nvs_handle);
    }
    nvs_close(nvs_handle);

    if (err == ESP_OK) {
        if (readings_mutex && xSemaphoreTake(readings_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            strncpy(kwh_currency, currency, sizeof(kwh_currency) - 1);
            kwh_currency[sizeof(kwh_currency) - 1] = '\0';
            xSemaphoreGive(readings_mutex);
        } else {
            strncpy(kwh_currency, currency, sizeof(kwh_currency) - 1);
            kwh_currency[sizeof(kwh_currency) - 1] = '\0';
        }
        ESP_LOGI(TAG, "Currency saved successfully: %s", currency);
    }
    return err;
}

void ads1115_get_currency(char *out_curr, size_t max_len)
{
    if (!out_curr || max_len == 0) return;
    if (readings_mutex && xSemaphoreTake(readings_mutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        strncpy(out_curr, kwh_currency, max_len - 1);
        out_curr[max_len - 1] = '\0';
        xSemaphoreGive(readings_mutex);
    } else {
        strncpy(out_curr, kwh_currency, max_len - 1);
        out_curr[max_len - 1] = '\0';
    }
}

