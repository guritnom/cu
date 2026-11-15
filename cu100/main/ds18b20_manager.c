#include "ds18b20_manager.h"
#include "ds18b20.h"
#include "onewire_bus.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"
#include <string.h>

static const char *TAG = "DS18B20_Mgr";
#define NVS_TEMP_NAMESPACE "temp_calib"

static onewire_bus_handle_t ow_bus = NULL;
static ds18b20_device_handle_t ds_device = NULL;
static float latest_temp = -127.0f;
static float temp_offset = 0.0f;
static SemaphoreHandle_t temp_mutex = NULL;

static void ds18b20_load_offset(void)
{
    nvs_handle_t nvs_handle;
    if (nvs_open(NVS_TEMP_NAMESPACE, NVS_READONLY, &nvs_handle) == ESP_OK) {
        uint32_t raw_val = 0;
        if (nvs_get_u32(nvs_handle, "offset", &raw_val) == ESP_OK) {
            memcpy(&temp_offset, &raw_val, sizeof(float));
        } else {
            temp_offset = 0.0f;
        }
        nvs_close(nvs_handle);
    } else {
        temp_offset = 0.0f;
    }
    ESP_LOGI(TAG, "Loaded temperature calibration offset: %.2f C", temp_offset);
}

esp_err_t ds18b20_manager_save_offset(float offset)
{
    nvs_handle_t nvs_handle;
    esp_err_t err = nvs_open(NVS_TEMP_NAMESPACE, NVS_READWRITE, &nvs_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open NVS for temp offset save: %s", esp_err_to_name(err));
        return err;
    }

    uint32_t raw_val;
    memcpy(&raw_val, &offset, sizeof(float));
    err = nvs_set_u32(nvs_handle, "offset", raw_val);
    if (err == ESP_OK) {
        err = nvs_commit(nvs_handle);
    }
    nvs_close(nvs_handle);

    if (err == ESP_OK) {
        if (temp_mutex && xSemaphoreTake(temp_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            temp_offset = offset;
            xSemaphoreGive(temp_mutex);
        } else {
            temp_offset = offset;
        }
        ESP_LOGI(TAG, "Temperature offset saved successfully: %.2f C", offset);
    }
    return err;
}

float ds18b20_manager_get_offset(void)
{
    float offset = 0.0f;
    if (temp_mutex && xSemaphoreTake(temp_mutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        offset = temp_offset;
        xSemaphoreGive(temp_mutex);
    } else {
        offset = temp_offset;
    }
    return offset;
}

static void search_and_create_ds18b20_device(void)
{
    if (ds_device) {
        ds18b20_del_device(ds_device);
        ds_device = NULL;
    }

    onewire_device_iter_handle_t iter = NULL;
    onewire_device_t next_onewire_device;
    if (onewire_new_device_iter(ow_bus, &iter) == ESP_OK) {
        while (onewire_device_iter_get_next(iter, &next_onewire_device) == ESP_OK) {
            ds18b20_config_t ds_cfg = {};
            if (ds18b20_new_device_from_enumeration(&next_onewire_device, &ds_cfg, &ds_device) == ESP_OK) {
                onewire_device_address_t address;
                ds18b20_get_device_address(ds_device, &address);
                ESP_LOGI(TAG, "Found DS18B20 device via enumeration, address: %016llX", address);
                break;
            }
        }
        onewire_del_device_iter(iter);
    }

    if (!ds_device) {
        ds18b20_config_t ds_cfg = {};
        esp_err_t err = ds18b20_new_device_from_bus(ow_bus, &ds_cfg, &ds_device);
        if (err == ESP_OK) {
            ESP_LOGI(TAG, "Initialized fallback DS18B20 device handle from 1-Wire bus");
        } else {
            ESP_LOGE(TAG, "Failed to create fallback DS18B20 device: %s", esp_err_to_name(err));
        }
    }
}

static void ds18b20_task(void *pvParameters)
{
    ESP_LOGI(TAG, "DS18B20 background task started");
    int fail_count = 0;
    while (1) {
        if (!ds_device && ow_bus) {
            search_and_create_ds18b20_device();
        }

        if (ow_bus && ds_device) {
            // Trigger conversion for all devices on the bus
            esp_err_t err = ds18b20_trigger_temperature_conversion_for_all(ow_bus);
            if (err == ESP_OK) {
                float temp = -127.0f;
                err = ds18b20_get_temperature(ds_device, &temp);
                if (err == ESP_OK) {
                    fail_count = 0;
                    if (xSemaphoreTake(temp_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
                        if (latest_temp < -100.0f) {
                            // First valid reading: initialize EMA filter
                            latest_temp = temp;
                        } else {
                            // EMA smoothing filter (alpha = 0.2)
                            latest_temp = (0.2f * temp) + (0.8f * latest_temp);
                        }
                        xSemaphoreGive(temp_mutex);
                    }
                    ESP_LOGD(TAG, "Read raw temp: %.2f C, smoothed: %.2f C", temp, latest_temp);
                } else {
                    ESP_LOGW(TAG, "Failed to read temperature: %s", esp_err_to_name(err));
                    fail_count++;
                    if (fail_count >= 3) {
                        if (xSemaphoreTake(temp_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
                            latest_temp = -127.0f;
                            xSemaphoreGive(temp_mutex);
                        }
                        // Attempt to re-search/re-enumerate device on persistent failures
                        search_and_create_ds18b20_device();
                    }
                }
            } else {
                if (err == ESP_ERR_NOT_FOUND) {
                    ESP_LOGW(TAG, "No DS18B20 sensor detected on 1-Wire bus. Check GPIO wiring (VCC/GND/Data) and 4.7k ohm pull-up resistor.");
                } else {
                    ESP_LOGW(TAG, "Failed to trigger temperature conversion: %s", esp_err_to_name(err));
                }
                fail_count++;
                if (fail_count >= 3) {
                    if (xSemaphoreTake(temp_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
                        latest_temp = -127.0f;
                        xSemaphoreGive(temp_mutex);
                    }
                    search_and_create_ds18b20_device();
                }
                vTaskDelay(pdMS_TO_TICKS(2000));
            }
        } else {
            vTaskDelay(pdMS_TO_TICKS(5000));
        }
        
        // Wait 2 seconds before the next sampling loop
        vTaskDelay(pdMS_TO_TICKS(2000));
    }
}

esp_err_t ds18b20_manager_init(gpio_num_t pin)
{
    temp_mutex = xSemaphoreCreateMutex();
    if (!temp_mutex) {
        ESP_LOGE(TAG, "Failed to create mutex");
        return ESP_ERR_NO_MEM;
    }

    ds18b20_load_offset();

    ESP_LOGI(TAG, "Initializing 1-Wire bus on GPIO %d...", pin);
    
    // 1. Install 1-Wire bus
    onewire_bus_config_t bus_config = {
        .bus_gpio_num = pin,
        .flags.en_pull_up = true,
    };
    onewire_bus_rmt_config_t rmt_config = {
        .max_rx_bytes = 10,
    };
    
    esp_err_t err = onewire_new_bus_rmt(&bus_config, &rmt_config, &ow_bus);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to create RMT 1-Wire bus: %s", esp_err_to_name(err));
        return err;
    }

    // 2. Search and create DS18B20 device via 1-Wire enumeration
    search_and_create_ds18b20_device();

    // Create FreeRTOS background task for sampling
    xTaskCreate(
        ds18b20_task,
        "ds18b20_task",
        4096,
        NULL,
        4, // Normal priority
        NULL
    );

    return ESP_OK;
}

float ds18b20_manager_get_temperature(void)
{
    float temp = -127.0f;
    if (temp_mutex && xSemaphoreTake(temp_mutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        if (latest_temp > -100.0f) {
            temp = latest_temp + temp_offset;
        } else {
            temp = -127.0f;
        }
        xSemaphoreGive(temp_mutex);
    }
    return temp;
}
