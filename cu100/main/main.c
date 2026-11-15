#include "ads1115.h"
#include "driver/gpio.h"
#include "ds18b20_manager.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mqtt_manager.h"
#include "nvs_flash.h"
#include "web_server.h"
#include "wifi_manager.h"
#include <stdio.h>

static const char *TAG = "MainApp";

// GPIO pins assigned as per requirements
#define I2C_SCL_PIN GPIO_NUM_3
#define I2C_SDA_PIN GPIO_NUM_10
#define ADS_ALRT_PIN GPIO_NUM_0
#define DS18B20_PIN GPIO_NUM_1
#define RESET_BUTTON_PIN GPIO_NUM_9

static void factory_reset_button_task(void *pvParameters) {
  gpio_config_t io_conf = {.pin_bit_mask = (1ULL << RESET_BUTTON_PIN),
                           .mode = GPIO_MODE_INPUT,
                           .pull_up_en = GPIO_PULLUP_ENABLE,
                           .pull_down_en = GPIO_PULLDOWN_DISABLE,
                           .intr_type = GPIO_INTR_DISABLE};
  gpio_config(&io_conf);

  int hold_time_ms = 0;
  const int trigger_hold_time_ms = 5000; // 5 seconds
  const int poll_interval_ms = 100;

  while (1) {
    if (gpio_get_level(RESET_BUTTON_PIN) == 0) {
      hold_time_ms += poll_interval_ms;
      if (hold_time_ms % 1000 == 0) {
        ESP_LOGI("ResetButton", "Factory reset button held for %d seconds...",
                 hold_time_ms / 1000);
      }
      if (hold_time_ms >= trigger_hold_time_ms) {
        ESP_LOGW("ResetButton",
                 "Button held for 5 seconds! Performing factory reset...");
        nvs_flash_deinit();
        nvs_flash_erase();
        esp_restart();
      }
    } else {
      hold_time_ms = 0;
    }
    vTaskDelay(pdMS_TO_TICKS(poll_interval_ms));
  }
}

void app_main(void) {
  ESP_LOGI(TAG, "==================================================");
  ESP_LOGI(TAG, "  CU Node 100 starting up...");
  ESP_LOGI(TAG, "  Target: ESP32-C3");
  ESP_LOGI(TAG, "  Framework: ESP-IDF v6.0.1");
  ESP_LOGI(TAG, "==================================================");

  // 1. Initialize NVS (Non-Volatile Storage)
  // Erase flash first if NVS partition was resized or format changed
  esp_err_t ret = nvs_flash_init();
  if (ret == ESP_ERR_NVS_NO_FREE_PAGES ||
      ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    ESP_LOGW(TAG, "NVS partition corrupted or updated. Erasing NVS flash...");
    ESP_ERROR_CHECK(nvs_flash_erase());
    ret = nvs_flash_init();
  }
  ESP_ERROR_CHECK(ret);

  // 2. Initialize default event loop (required by Wi-Fi manager)
  ESP_ERROR_CHECK(esp_event_loop_create_default());

  // 3. Initialize Wi-Fi Manager (AP/STA state machine)
  wifi_manager_init();

  // 4. Start HTTP Server for API and Dashboard
  ESP_ERROR_CHECK(start_web_server());

  // Initialize MQTT clients for HA and Cloud IoT
  mqtt_manager_init();

  // 5. Initialize I2C Master and ADS1115 Device
  ESP_LOGI(TAG,
           "Initializing ADS1115 (SCL=GPIO %d, SDA=GPIO %d, ALRT=GPIO %d)...",
           I2C_SCL_PIN, I2C_SDA_PIN, ADS_ALRT_PIN);
  ret = ads1115_init(I2C_SCL_PIN, I2C_SDA_PIN, ADS_ALRT_PIN);
  if (ret == ESP_OK) {
    // Start background high-speed ADC sampling task
    ads1115_start_sampling_task();
    ESP_LOGI(TAG, "ADS1115 sampling loop running successfully.");
  } else {
    ESP_LOGE(TAG, "Failed to initialize ADS1115: %s. Monitoring disabled.",
             esp_err_to_name(ret));
  }

  // 6. Initialize DS18B20 Temperature Sensor
  ESP_LOGI(TAG, "Initializing DS18B20 on GPIO %d...", DS18B20_PIN);
  ret = ds18b20_manager_init(DS18B20_PIN);
  if (ret == ESP_OK) {
    ESP_LOGI(TAG, "DS18B20 manager initialized successfully.");
  } else {
    ESP_LOGE(TAG, "Failed to initialize DS18B20 manager: %s",
             esp_err_to_name(ret));
  }

  // 7. Start physical factory reset button monitor task
  xTaskCreate(factory_reset_button_task, "reset_btn_task", 3072, NULL, 3, NULL);

  ESP_LOGI(TAG, "System initialization completed successfully.");
}
