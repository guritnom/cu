#ifndef MAIN_ADS1115_H_
#define MAIN_ADS1115_H_

#include "driver/gpio.h"
#include "esp_err.h"

// ADS1115 I2C Address (ADDR pin connected to GND)
#define ADS1115_I2C_ADDR            0x48

// ADS1115 Registers
#define ADS1115_REG_CONVERSION      0x00
#define ADS1115_REG_CONFIG          0x01
#define ADS1115_REG_LO_THRESH       0x02
#define ADS1115_REG_HI_THRESH       0x03

// Config Register Bitfields
#define ADS1115_OS_START            (1 << 15) // Start single-shot conversion / read status
#define ADS1115_OS_BUSY             (0 << 15) // Conversion in progress
#define ADS1115_OS_READY            (1 << 15) // Conversion complete / not active

// Input Multiplexer Configuration (Single-ended inputs relative to GND)
#define ADS1115_MUX_AIN0            (0x4 << 12) // AINp = AIN0, AINn = GND
#define ADS1115_MUX_AIN1            (0x5 << 12) // AINp = AIN1, AINn = GND
#define ADS1115_MUX_AIN2            (0x6 << 12) // AINp = AIN2, AINn = GND
#define ADS1115_MUX_AIN3            (0x7 << 12) // AINp = AIN3, AINn = GND

// Programmable Gain Amplifier Configuration (PGA)
#define ADS1115_PGA_6_144V          (0x0 << 9)  // FS = +/-6.144V
#define ADS1115_PGA_4_096V          (0x1 << 9)  // FS = +/-4.096V
#define ADS1115_PGA_2_048V          (0x2 << 9)  // FS = +/-2.048V
#define ADS1115_PGA_1_024V          (0x3 << 9)  // FS = +/-1.024V
#define ADS1115_PGA_0_512V          (0x4 << 9)  // FS = +/-0.512V
#define ADS1115_PGA_0_256V          (0x5 << 9)  // FS = +/-0.256V

// Device Operating Mode
#define ADS1115_MODE_CONTINUOUS     (0x0 << 8)  // Continuous-conversion mode
#define ADS1115_MODE_SINGLE         (0x1 << 8)  // Single-shot mode / power-down

// Data Rate (SPS)
#define ADS1115_DR_8SPS             (0x0 << 5)
#define ADS1115_DR_16SPS            (0x1 << 5)
#define ADS1115_DR_32SPS            (0x2 << 5)
#define ADS1115_DR_64SPS            (0x3 << 5)
#define ADS1115_DR_128SPS           (0x4 << 5)
#define ADS1115_DR_250SPS           (0x5 << 5)
#define ADS1115_DR_475SPS           (0x6 << 5)
#define ADS1115_DR_860SPS           (0x7 << 5)

// Comparator Mode
#define ADS1115_COMP_MODE_TRAD      (0x0 << 4)  // Traditional comparator with hysteresis
#define ADS1115_COMP_MODE_WINDOW    (0x1 << 4)  // Window comparator

// Comparator Polarity
#define ADS1115_COMP_POL_ACTVLOW    (0x0 << 3)  // Active low
#define ADS1115_COMP_POL_ACTVHIGH   (0x1 << 3)  // Active high

// Latching Comparator
#define ADS1115_COMP_LAT_NONLAT     (0x0 << 2)  // Nonlatching comparator
#define ADS1115_COMP_LAT_LAT        (0x1 << 2)  // Latching comparator

// Comparator Queue (controls ALRT pin behavior)
#define ADS1115_COMP_QUE_1CONV      (0x0 << 0)  // Assert ALRT after one conversion
#define ADS1115_COMP_QUE_2CONV      (0x1 << 0)  // Assert ALRT after two conversions
#define ADS1115_COMP_QUE_4CONV      (0x2 << 0)  // Assert ALRT after four conversions
#define ADS1115_COMP_QUE_DISABLE    (0x3 << 0)  // Disable comparator (ALRT high-z)

/**
 * @brief Initialize the I2C master bus and add the ADS1115 device.
 *        Configures the ALRT pin as an input.
 * 
 * @param scl_pin GPIO number for I2C SCL
 * @param sda_pin GPIO number for I2C SDA
 * @param alrt_pin GPIO number for ADS1115 ALRT/RDY pin
 * @return esp_err_t ESP_OK on success, error code otherwise
 */
esp_err_t ads1115_init(gpio_num_t scl_pin, gpio_num_t sda_pin, gpio_num_t alrt_pin);

/**
 * @brief Starts the background task to sample ADS1115 and compute RMS currents.
 */
void ads1115_start_sampling_task(void);

/**
 * @brief Thread-safe API to retrieve the latest computed RMS current for a channel.
 * 
 * @param channel Channel index (0 to 3)
 * @return float Computed RMS current in Amperes
 */
float ads1115_get_current(int channel);

/**
 * @brief Thread-safe API to retrieve the latest computed power for a channel.
 * 
 * @param channel Channel index (0 to 3)
 * @return float Computed power in Watts
 */
float ads1115_get_watts(int channel);

/**
 * @brief Save the calibration factors (in A/V ratio) to NVS and update them in memory.
 * 
 * @param factors Pointer to float array of size 4 containing the factors
 * @return esp_err_t ESP_OK on success
 */
esp_err_t ads1115_save_calibration(const float *factors);

/**
 * @brief Get the current calibration factors from memory.
 * 
 * @param factors Pointer to float array of size 4 to store the factors
 */
void ads1115_get_calibration(float *factors);

/**
 * @brief Thread-safe API to retrieve the latest computed accumulated kWh for a channel.
 * 
 * @param channel Channel index (0 to 3)
 * @return float Computed accumulated energy in kWh
 */
float ads1115_get_kwh(int channel);

/**
 * @brief Reset the accumulated energy (kWh) counters for all channels.
 */
void ads1115_reset_kwh(void);

/**
 * @brief Get the current assumed voltage reference.
 * 
 * @return float Assumed line voltage in Volts
 */
float ads1115_get_voltage(void);

/**
 * @brief Save the assumed voltage reference to NVS and update in memory.
 * 
 * @param voltage Reference voltage in Volts
 * @return esp_err_t ESP_OK on success
 */
esp_err_t ads1115_save_voltage(float voltage);

/**
 * @brief Get the configured kWh rate cost setting.
 * 
 * @return float Rate per kWh (0.0f if not configured)
 */
float ads1115_get_kwh_rate(void);

/**
 * @brief Save the kWh rate setting to NVS and update in memory.
 * 
 * @param rate Rate per kWh
 * @return esp_err_t ESP_OK on success
 */
esp_err_t ads1115_save_kwh_rate(float rate);

/**
 * @brief Get the configured currency setting ("IDR" or "USD").
 * 
 * @param out_curr Buffer to store currency string
 * @param max_len Size of destination buffer
 */
void ads1115_get_currency(char *out_curr, size_t max_len);

/**
 * @brief Save the currency setting ("IDR" or "USD") to NVS and update in memory.
 * 
 * @param currency Pointer to currency string ("IDR" or "USD")
 * @return esp_err_t ESP_OK on success
 */
esp_err_t ads1115_save_currency(const char *currency);

#endif // MAIN_ADS1115_H_
