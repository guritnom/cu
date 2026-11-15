#ifndef DS18B20_MANAGER_H
#define DS18B20_MANAGER_H

#include "esp_err.h"
#include "driver/gpio.h"

/**
 * @brief Initialize the 1-Wire bus on the specified pin, detect the DS18B20 sensor,
 *        and launch a background task to periodically sample the temperature.
 * 
 * @param pin The GPIO pin connected to the DS18B20 data line.
 * @return esp_err_t ESP_OK on success, or an error code.
 */
esp_err_t ds18b20_manager_init(gpio_num_t pin);

/**
 * @brief Retrieve the latest successfully read temperature in Celsius.
 * 
 * @return float The temperature in Celsius, or -127.0f if no reading is available yet.
 */
float ds18b20_manager_get_temperature(void);

/**
 * @brief Save temperature calibration offset in Celsius to NVS and update in memory.
 * 
 * @param offset Temperature offset in degrees Celsius (e.g. -4.0f to subtract 4°C).
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t ds18b20_manager_save_offset(float offset);

/**
 * @brief Retrieve current temperature calibration offset in Celsius.
 * 
 * @return float Offset in degrees Celsius.
 */
float ds18b20_manager_get_offset(void);

#endif // DS18B20_MANAGER_H
