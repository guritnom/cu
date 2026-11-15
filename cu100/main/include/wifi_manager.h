#ifndef MAIN_WIFI_MANAGER_H_
#define MAIN_WIFI_MANAGER_H_

#include "esp_err.h"
#include <stdbool.h>

#define WIFI_AP_SSID_DEFAULT     "CurrentUsage"
#define WIFI_AP_PASS_DEFAULT     "password"
#define WIFI_MAX_SCAN_AP         15

typedef enum {
    WIFI_MGR_MODE_DISCONNECTED,
    WIFI_MGR_MODE_AP,   // Access Point configuration mode
    WIFI_MGR_MODE_STA   // Station connected mode
} wifi_manager_mode_t;

typedef struct {
    char ssid[33];
    int8_t rssi;
    uint8_t secure; // 0 = open, 1 = wpa/wpa2/wpa3
} wifi_scan_ap_t;

/**
 * @brief Initialize NVS, configure and start the Wi-Fi interface.
 *        Attempts STA connection if credentials exist.
 *        Falls back to AP configuration mode and starts captive portal DNS if connection fails.
 */
void wifi_manager_init(void);

/**
 * @brief Thread-safe check if Wi-Fi has successfully connected to STA.
 * 
 * @return true If connected and has IP address
 * @return false Otherwise
 */
bool wifi_manager_is_connected(void);

/**
 * @brief Get the current Wi-Fi manager mode (AP, STA, or Disconnected).
 */
wifi_manager_mode_t wifi_manager_get_mode(void);

/**
 * @brief Get the station IP address as string.
 */
esp_err_t wifi_manager_get_sta_ip(char *ip_buf, size_t buf_len);

/**
 * @brief Get the AP IP address as string (defaults to 192.168.4.1).
 */
esp_err_t wifi_manager_get_ap_ip(char *ip_buf, size_t buf_len);

/**
 * @brief Save WiFi credentials to NVS.
 */
esp_err_t wifi_manager_save_credentials(const char *ssid, const char *password);

/**
 * @brief Clear Wi-Fi credentials in NVS.
 */
esp_err_t wifi_manager_clear_credentials(void);

/**
 * @brief Triggers a Wi-Fi scan and populates the results array.
 * 
 * @param ap_list Pointer to array of wifi_scan_ap_t
 * @param max_aps Size of the ap_list array
 * @return int Number of networks found (up to max_aps)
 */
int wifi_manager_scan(wifi_scan_ap_t *ap_list, int max_aps);

/**
 * @brief Get the station connected SSID.
 */
esp_err_t wifi_manager_get_sta_ssid(char *ssid_buf, size_t buf_len);

/**
 * @brief Get the access point SSID.
 */
esp_err_t wifi_manager_get_ap_ssid(char *ssid_buf, size_t buf_len);

/**
 * @brief Attempt to reconnect to the stored Wi-Fi credentials in the background.
 * 
 * @return esp_err_t ESP_OK if reconnection started, ESP_ERR_NOT_FOUND if credentials do not exist, or connection failure code.
 */
esp_err_t wifi_manager_reconnect(void);

/**
 * @brief Restarts the MCU. Used after configuration updates to apply new credentials.
 */
void wifi_manager_reboot(void);

#endif // MAIN_WIFI_MANAGER_H_
