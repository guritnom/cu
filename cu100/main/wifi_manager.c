#include "wifi_manager.h"
#include <string.h>
#include "esp_wifi.h"
#include "esp_event.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_netif.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "lwip/sockets.h"
#include "lwip/netdb.h"

static const char *TAG = "WiFiManager";

#define WIFI_NVS_NAMESPACE   "wifi_store"
#define WIFI_KEY_SSID        "ssid"
#define WIFI_KEY_PASS        "password"
#define STA_MAX_RETRIES      5
#define DNS_PORT             53
// Limit Wi-Fi TX Power to avoid voltage sags on weak custom board LDOs (units of 0.25 dBm: 34 = 8.5 dBm, the recommended sweet spot for ESP32-C3 Super Mini)
#define WIFI_TX_POWER_LIMIT  34

// DNS Header struct
typedef struct __attribute__((packed)) {
    uint16_t id;
    uint16_t flags;
    uint16_t qdcount;
    uint16_t ancount;
    uint16_t nscount;
    uint16_t arcount;
} dns_header_t;

// State Variables
static wifi_manager_mode_t current_mode = WIFI_MGR_MODE_DISCONNECTED;
static SemaphoreHandle_t wifi_mutex = NULL;
static esp_netif_t *sta_netif = NULL;
static esp_netif_t *ap_netif = NULL;
static int sta_retry_count = 0;
static bool start_ap_requested = false;
static bool sta_connect_allowed = false;
static TaskHandle_t dns_task_handle = NULL;

// Function prototypes
static void start_ap(void);
static void start_sta(const char* ssid, const char* pass);
static void dns_server_task(void *pvParameters);

// Get current Wi-Fi mode
wifi_manager_mode_t wifi_manager_get_mode(void)
{
    wifi_manager_mode_t mode;
    xSemaphoreTake(wifi_mutex, portMAX_DELAY);
    mode = current_mode;
    xSemaphoreGive(wifi_mutex);
    return mode;
}

// Set current Wi-Fi mode
static void set_wifi_mode(wifi_manager_mode_t mode)
{
    xSemaphoreTake(wifi_mutex, portMAX_DELAY);
    current_mode = mode;
    xSemaphoreGive(wifi_mutex);
}

// Check connection
bool wifi_manager_is_connected(void)
{
    return wifi_manager_get_mode() == WIFI_MGR_MODE_STA;
}

// Get STA IP
esp_err_t wifi_manager_get_sta_ip(char *ip_buf, size_t buf_len)
{
    if (wifi_manager_get_mode() != WIFI_MGR_MODE_STA) {
        return ESP_ERR_INVALID_STATE;
    }
    esp_netif_ip_info_t ip_info;
    esp_err_t err = esp_netif_get_ip_info(sta_netif, &ip_info);
    if (err == ESP_OK) {
        esp_ip4addr_ntoa(&ip_info.ip, ip_buf, buf_len);
    }
    return err;
}

// Get STA SSID
esp_err_t wifi_manager_get_sta_ssid(char *ssid_buf, size_t buf_len)
{
    if (wifi_manager_get_mode() != WIFI_MGR_MODE_STA) {
        return ESP_ERR_INVALID_STATE;
    }
    wifi_ap_record_t ap_info;
    esp_err_t err = esp_wifi_sta_get_ap_info(&ap_info);
    if (err == ESP_OK) {
        strncpy(ssid_buf, (char*)ap_info.ssid, buf_len - 1);
        ssid_buf[buf_len - 1] = '\0';
    }
    return err;
}

// Get AP SSID
esp_err_t wifi_manager_get_ap_ssid(char *ssid_buf, size_t buf_len)
{
    wifi_config_t ap_config;
    esp_err_t err = esp_wifi_get_config(WIFI_IF_AP, &ap_config);
    if (err == ESP_OK) {
        strncpy(ssid_buf, (char*)ap_config.ap.ssid, buf_len - 1);
        ssid_buf[buf_len - 1] = '\0';
    }
    return err;
}

// Get AP IP
esp_err_t wifi_manager_get_ap_ip(char *ip_buf, size_t buf_len)
{
    esp_netif_ip_info_t ip_info;
    esp_err_t err = esp_netif_get_ip_info(ap_netif, &ip_info);
    if (err == ESP_OK) {
        esp_ip4addr_ntoa(&ip_info.ip, ip_buf, buf_len);
    } else {
        strncpy(ip_buf, "192.168.4.1", buf_len);
    }
    return err;
}

// Event Handler
static void wifi_event_handler(void* arg, esp_event_base_t event_base,
                                int32_t event_id, void* event_data)
{
    if (event_base == WIFI_EVENT) {
        switch (event_id) {
            case WIFI_EVENT_STA_START:
                if (sta_connect_allowed) {
                    ESP_LOGI(TAG, "STA start, connecting...");
                    esp_wifi_connect();
                } else {
                    ESP_LOGI(TAG, "STA start, AP-only mode, skipping connect.");
                }
                break;
            case WIFI_EVENT_STA_DISCONNECTED: {
                wifi_event_sta_disconnected_t* event = (wifi_event_sta_disconnected_t*) event_data;
                ESP_LOGW(TAG, "STA disconnected, reason: %d", event->reason);
                if (wifi_manager_get_mode() != WIFI_MGR_MODE_AP) {
                    if (sta_retry_count < STA_MAX_RETRIES) {
                        sta_retry_count++;
                        ESP_LOGI(TAG, "Retrying STA connection (%d/%d)...", sta_retry_count, STA_MAX_RETRIES);
                        esp_wifi_connect();
                    } else {
                        ESP_LOGW(TAG, "STA connection failed after max retries. Falling back to AP mode.");
                        set_wifi_mode(WIFI_MGR_MODE_DISCONNECTED);
                        sta_connect_allowed = false;
                        start_ap_requested = true; // Flag to trigger AP startup outside of ISR context
                    }
                } else {
                    sta_connect_allowed = false;
                }
                break;
            }
            case WIFI_EVENT_AP_START:
                ESP_LOGI(TAG, "AP started successfully");
                set_wifi_mode(WIFI_MGR_MODE_AP);
                // Start Captive Portal DNS Server
                if (dns_task_handle == NULL) {
                    xTaskCreate(dns_server_task, "dns_server", 4096, NULL, 4, &dns_task_handle);
                }
                break;
            case WIFI_EVENT_AP_STOP:
                ESP_LOGI(TAG, "AP stopped");
                break;
            default:
                break;
        }
    } else if (event_base == IP_EVENT) {
        if (event_id == IP_EVENT_STA_GOT_IP) {
            ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
            char ip_str[16];
            esp_ip4addr_ntoa(&event->ip_info.ip, ip_str, sizeof(ip_str));
            ESP_LOGI(TAG, "STA connected! Got IP: %s", ip_str);
            sta_retry_count = 0;
            set_wifi_mode(WIFI_MGR_MODE_STA);
        }
    }
}

// Start AP mode
static void start_ap(void)
{
    sta_connect_allowed = false;
    ESP_LOGI(TAG, "Initializing Access Point...");
    esp_wifi_stop();
    
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    
    char ap_ssid[32];
    snprintf(ap_ssid, sizeof(ap_ssid), "%s-%02x%02x%02x", WIFI_AP_SSID_DEFAULT, mac[3], mac[4], mac[5]);
    ESP_LOGI(TAG, "Configuring SoftAP SSID: %s", ap_ssid);
    
    wifi_config_t ap_config = {
        .ap = {
            .password = WIFI_AP_PASS_DEFAULT,
            .channel = 1,
            .authmode = WIFI_AUTH_WPA2_PSK,
            .max_connection = 4,
        },
    };
    
    strncpy((char*)ap_config.ap.ssid, ap_ssid, sizeof(ap_config.ap.ssid));
    ap_config.ap.ssid_len = strlen(ap_ssid);

    if (strlen(WIFI_AP_PASS_DEFAULT) == 0) {
        ap_config.ap.authmode = WIFI_AUTH_OPEN;
    }

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "Limiting Wi-Fi Max TX Power to %d (%.2f dBm) to prevent board voltage sag",
             WIFI_TX_POWER_LIMIT, (float)WIFI_TX_POWER_LIMIT * 0.25f);
    esp_wifi_set_max_tx_power(WIFI_TX_POWER_LIMIT);
}

// Start STA mode
static void start_sta(const char* ssid, const char* pass)
{
    sta_connect_allowed = true;
    ESP_LOGI(TAG, "Connecting to SSID: %s (APSTA mode)", ssid);
    esp_wifi_stop();

    wifi_config_t sta_config = {0};
    strncpy((char*)sta_config.sta.ssid, ssid, sizeof(sta_config.sta.ssid));
    strncpy((char*)sta_config.sta.password, pass, sizeof(sta_config.sta.password));
    sta_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;

    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    
    char ap_ssid[32];
    snprintf(ap_ssid, sizeof(ap_ssid), "%s-%02x%02x%02x", WIFI_AP_SSID_DEFAULT, mac[3], mac[4], mac[5]);
    ESP_LOGI(TAG, "Configuring SoftAP SSID: %s", ap_ssid);
    
    wifi_config_t ap_config = {
        .ap = {
            .password = WIFI_AP_PASS_DEFAULT,
            .channel = 1,
            .authmode = WIFI_AUTH_WPA2_PSK,
            .max_connection = 4,
        },
    };
    
    strncpy((char*)ap_config.ap.ssid, ap_ssid, sizeof(ap_config.ap.ssid));
    ap_config.ap.ssid_len = strlen(ap_ssid);

    if (strlen(WIFI_AP_PASS_DEFAULT) == 0) {
        ap_config.ap.authmode = WIFI_AUTH_OPEN;
    }

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &sta_config));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap_config));
    
    sta_retry_count = 0;
    set_wifi_mode(WIFI_MGR_MODE_DISCONNECTED);
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "Limiting Wi-Fi Max TX Power to %d (%.2f dBm) to prevent board voltage sag",
             WIFI_TX_POWER_LIMIT, (float)WIFI_TX_POWER_LIMIT * 0.25f);
    esp_wifi_set_max_tx_power(WIFI_TX_POWER_LIMIT);
}

// Save WiFi credentials to NVS
esp_err_t wifi_manager_save_credentials(const char *ssid, const char *password)
{
    nvs_handle_t nvs_handle;
    esp_err_t err = nvs_open(WIFI_NVS_NAMESPACE, NVS_READWRITE, &nvs_handle);
    if (err != ESP_OK) return err;

    err = nvs_set_str(nvs_handle, WIFI_KEY_SSID, ssid);
    if (err == ESP_OK) {
        err = nvs_set_str(nvs_handle, WIFI_KEY_PASS, password);
    }
    
    if (err == ESP_OK) {
        err = nvs_commit(nvs_handle);
    }
    
    nvs_close(nvs_handle);
    ESP_LOGI(TAG, "Saved WiFi credentials for SSID: %s", ssid);
    return err;
}

// Clear Wi-Fi credentials in NVS
esp_err_t wifi_manager_clear_credentials(void)
{
    nvs_handle_t nvs_handle;
    esp_err_t err = nvs_open(WIFI_NVS_NAMESPACE, NVS_READWRITE, &nvs_handle);
    if (err != ESP_OK) return err;

    err = nvs_erase_key(nvs_handle, WIFI_KEY_SSID);
    if (err == ESP_OK || err == ESP_ERR_NVS_NOT_FOUND) {
        err = nvs_erase_key(nvs_handle, WIFI_KEY_PASS);
    }

    if (err == ESP_OK || err == ESP_ERR_NVS_NOT_FOUND) {
        err = nvs_commit(nvs_handle);
    }

    nvs_close(nvs_handle);
    ESP_LOGI(TAG, "Cleared stored WiFi credentials");
    return err;
}

// Reconnect to saved Wi-Fi if credentials exist
esp_err_t wifi_manager_reconnect(void)
{
    nvs_handle_t nvs_handle;
    char saved_ssid[33] = {0};
    char saved_pass[64] = {0};
    size_t ssid_len = sizeof(saved_ssid);
    size_t pass_len = sizeof(saved_pass);
    bool has_credentials = false;

    esp_err_t err = nvs_open(WIFI_NVS_NAMESPACE, NVS_READONLY, &nvs_handle);
    if (err == ESP_OK) {
        esp_err_t err_ssid = nvs_get_str(nvs_handle, WIFI_KEY_SSID, saved_ssid, &ssid_len);
        esp_err_t err_pass = nvs_get_str(nvs_handle, WIFI_KEY_PASS, saved_pass, &pass_len);
        if (err_ssid == ESP_OK && err_pass == ESP_OK) {
            has_credentials = true;
        }
        nvs_close(nvs_handle);
    }

    if (!has_credentials || strlen(saved_ssid) == 0) {
        ESP_LOGD(TAG, "No Wi-Fi credentials found. Reconnection skipped.");
        return ESP_ERR_NOT_FOUND;
    }

    sta_connect_allowed = true;
    ESP_LOGI(TAG, "Attempting background reconnect to SSID: %s (APSTA mode)", saved_ssid);

    wifi_config_t sta_config = {0};
    strncpy((char*)sta_config.sta.ssid, saved_ssid, sizeof(sta_config.sta.ssid));
    strncpy((char*)sta_config.sta.password, saved_pass, sizeof(sta_config.sta.password));
    sta_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;

    sta_retry_count = 0;

    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &sta_config));
    esp_err_t conn_err = esp_wifi_connect();
    if (conn_err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start background Wi-Fi connection: %s", esp_err_to_name(conn_err));
        return conn_err;
    }

    return ESP_OK;
}

// Watchdog task for fallback to AP and periodic reconnection
static void wifi_watchdog_task(void *pvParameters)
{
    int reconnect_counter = 0;
    // 30 seconds interval = 300 * 100ms
    const int reconnect_interval = 300;

    while (1) {
        if (start_ap_requested) {
            start_ap_requested = false;
            start_ap();
        }

        // Periodically attempt reconnection if in AP mode
        if (wifi_manager_get_mode() == WIFI_MGR_MODE_AP) {
            reconnect_counter++;
            if (reconnect_counter >= reconnect_interval) {
                reconnect_counter = 0;
                wifi_manager_reconnect();
            }
        } else {
            reconnect_counter = 0;
        }

        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

// Initialize Wi-Fi Manager
void wifi_manager_init(void)
{
    wifi_mutex = xSemaphoreCreateMutex();
    
    // Initialize networking stack
    ESP_ERROR_CHECK(esp_netif_init());
    
    // Create STA and AP netifs
    sta_netif = esp_netif_create_default_wifi_sta();
    ap_netif = esp_netif_create_default_wifi_ap();

    // Initialize Wi-Fi with default configs
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    // Register event handlers
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT,
                                                        ESP_EVENT_ANY_ID,
                                                        &wifi_event_handler,
                                                        NULL,
                                                        NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT,
                                                        IP_EVENT_STA_GOT_IP,
                                                        &wifi_event_handler,
                                                        NULL,
                                                        NULL));

    // Set Wi-Fi storage to RAM (we persist credentials manually in NVS)
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));

    // Start background watchdog task for AP fallback handling
    xTaskCreate(wifi_watchdog_task, "wifi_wdog", 2048, NULL, 3, NULL);

    // Try reading credentials from NVS
    nvs_handle_t nvs_handle;
    char saved_ssid[33] = {0};
    char saved_pass[64] = {0};
    size_t ssid_len = sizeof(saved_ssid);
    size_t pass_len = sizeof(saved_pass);
    bool has_credentials = false;

    esp_err_t err = nvs_open(WIFI_NVS_NAMESPACE, NVS_READONLY, &nvs_handle);
    if (err == ESP_OK) {
        esp_err_t err_ssid = nvs_get_str(nvs_handle, WIFI_KEY_SSID, saved_ssid, &ssid_len);
        esp_err_t err_pass = nvs_get_str(nvs_handle, WIFI_KEY_PASS, saved_pass, &pass_len);
        if (err_ssid == ESP_OK && err_pass == ESP_OK) {
            has_credentials = true;
        }
        nvs_close(nvs_handle);
    }

    if (has_credentials && strlen(saved_ssid) > 0) {
        start_sta(saved_ssid, saved_pass);
    } else {
        ESP_LOGI(TAG, "No Wi-Fi credentials found. Booting directly into AP mode.");
        start_ap();
    }
}

// Scan Wi-Fi APs
int wifi_manager_scan(wifi_scan_ap_t *ap_list, int max_aps)
{
    // Check if we are currently connected or AP is running
    wifi_mode_t current_wifi_mode;
    if (esp_wifi_get_mode(&current_wifi_mode) != ESP_OK) {
        return 0;
    }

    // Set scan configs
    wifi_scan_config_t scan_config = {
        .ssid = 0,
        .bssid = 0,
        .channel = 0,
        .show_hidden = false
    };

    ESP_LOGI(TAG, "Starting Wi-Fi scan...");
    
    // Start scan (blocking mode)
    esp_err_t err = esp_wifi_scan_start(&scan_config, true);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start Wi-Fi scan: %s", esp_err_to_name(err));
        return 0;
    }

    uint16_t ap_count = 0;
    esp_wifi_scan_get_ap_num(&ap_count);
    
    if (ap_count == 0) {
        ESP_LOGI(TAG, "No APs found");
        return 0;
    }

    if (ap_count > max_aps) {
        ap_count = max_aps;
    }

    wifi_ap_record_t *ap_records = malloc(sizeof(wifi_ap_record_t) * ap_count);
    if (!ap_records) {
        ESP_LOGE(TAG, "Memory allocation failed for AP records");
        return 0;
    }

    err = esp_wifi_scan_get_ap_records(&ap_count, ap_records);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to retrieve AP records: %s", esp_err_to_name(err));
        free(ap_records);
        return 0;
    }

    int valid_ap_count = 0;
    for (int i = 0; i < ap_count; i++) {
        // Skip duplicate SSIDs
        bool is_dup = false;
        for (int j = 0; j < valid_ap_count; j++) {
            if (strcmp(ap_list[j].ssid, (char*)ap_records[i].ssid) == 0) {
                is_dup = true;
                break;
            }
        }
        if (is_dup || strlen((char*)ap_records[i].ssid) == 0) {
            continue;
        }

        strncpy(ap_list[valid_ap_count].ssid, (char*)ap_records[i].ssid, sizeof(ap_list[valid_ap_count].ssid) - 1);
        ap_list[valid_ap_count].ssid[sizeof(ap_list[valid_ap_count].ssid) - 1] = '\0';
        ap_list[valid_ap_count].rssi = ap_records[i].rssi;
        ap_list[valid_ap_count].secure = (ap_records[i].authmode != WIFI_AUTH_OPEN) ? 1 : 0;
        
        valid_ap_count++;
        if (valid_ap_count >= max_aps) {
            break;
        }
    }

    free(ap_records);
    ESP_LOGI(TAG, "Wi-Fi scan completed. Found %d unique networks.", valid_ap_count);
    return valid_ap_count;
}

// Reboot
void wifi_manager_reboot(void)
{
    ESP_LOGW(TAG, "Rebooting device in 1 second...");
    vTaskDelay(pdMS_TO_TICKS(1000));
    esp_restart();
}

// DNS Server Task for Captive Portal (UDP redirect)
static void dns_server_task(void *pvParameters)
{
    char rx_buffer[128];
    char tx_buffer[256];
    struct sockaddr_in server_addr;
    server_addr.sin_addr.s_addr = htonl(INADDR_ANY);
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(DNS_PORT);

    int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
    if (sock < 0) {
        ESP_LOGE(TAG, "Failed to create socket for DNS: %d", errno);
        dns_task_handle = NULL;
        vTaskDelete(NULL);
        return;
    }

    // Bind to the port
    int err = bind(sock, (struct sockaddr *)&server_addr, sizeof(server_addr));
    if (err < 0) {
        ESP_LOGE(TAG, "Failed to bind DNS socket: %d", errno);
        close(sock);
        dns_task_handle = NULL;
        vTaskDelete(NULL);
        return;
    }

    ESP_LOGI(TAG, "DNS Redirect Server running on port %d...", DNS_PORT);

    // Run only while in AP mode
    while (wifi_manager_get_mode() == WIFI_MGR_MODE_AP) {
        struct sockaddr_in source_addr;
        socklen_t addr_len = sizeof(source_addr);
        
        // Receive packet (blocking with a timeout to allow checking wifi mode)
        struct timeval tv;
        tv.tv_sec = 1;
        tv.tv_usec = 0;
        setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

        int len = recvfrom(sock, rx_buffer, sizeof(rx_buffer) - 1, 0, (struct sockaddr *)&source_addr, &addr_len);

        if (len < 0) {
            if (errno == EWOULDBLOCK || errno == EAGAIN) {
                continue; // Socket timeout, check while condition
            }
            ESP_LOGE(TAG, "DNS recv failed: %d", errno);
            vTaskDelay(pdMS_TO_TICKS(100));
            continue;
        }

        if (len < sizeof(dns_header_t)) {
            continue; // Packet too short
        }

        dns_header_t *dns_header = (dns_header_t *)rx_buffer;
        
        uint16_t flags = ntohs(dns_header->flags);
        uint16_t qdcount = ntohs(dns_header->qdcount);

        // Standard Query?
        if (((flags & 0x8000) == 0) && (qdcount > 0)) {
            dns_header_t *resp_header = (dns_header_t *)tx_buffer;
            resp_header->id = dns_header->id;
            resp_header->flags = htons(0x8400); // QR=1 (Response), AA=1 (Authoritative), RCODE=0
            resp_header->qdcount = htons(1);
            resp_header->ancount = htons(1);
            resp_header->nscount = 0;
            resp_header->arcount = 0;

            char *query_start = rx_buffer + sizeof(dns_header_t);
            char *resp_ptr = tx_buffer + sizeof(dns_header_t);

            // Navigate query domain name labels to copy it
            char *p = query_start;
            while (*p != 0) {
                p += *p + 1;
                if ((p - rx_buffer) > len) {
                    break;
                }
            }
            if ((p - rx_buffer) > len) {
                continue; // Malformed query
            }
            p++; // Include the termination zero

            int name_len = p - query_start;
            memcpy(resp_ptr, query_start, name_len);
            resp_ptr += name_len;

            // Copy QTYPE (2 bytes) and QCLASS (2 bytes)
            memcpy(resp_ptr, p, 4);
            resp_ptr += 4;

            // Append Answer Section
            // Compression pointer pointing back to the query name (offset 12 = 0xc00c)
            *resp_ptr++ = 0xc0;
            *resp_ptr++ = 0x0c;

            // TYPE A (IPv4) : 0x0001
            *resp_ptr++ = 0x00;
            *resp_ptr++ = 0x01;

            // CLASS IN (Internet) : 0x0001
            *resp_ptr++ = 0x00;
            *resp_ptr++ = 0x01;

            // TTL (10 seconds) : 0x0000000A
            *resp_ptr++ = 0x00;
            *resp_ptr++ = 0x00;
            *resp_ptr++ = 0x00;
            *resp_ptr++ = 0x0a;

            // Data length : 0x0004 (4 bytes)
            *resp_ptr++ = 0x00;
            *resp_ptr++ = 0x04;

            // IP Address: 192.168.4.1 (ESP32 AP IP address)
            *resp_ptr++ = 192;
            *resp_ptr++ = 168;
            *resp_ptr++ = 4;
            *resp_ptr++ = 1;

            int resp_len = resp_ptr - tx_buffer;
            sendto(sock, tx_buffer, resp_len, 0, (struct sockaddr *)&source_addr, sizeof(source_addr));
        }
    }

    ESP_LOGI(TAG, "DNS Redirect Server shutting down");
    close(sock);
    dns_task_handle = NULL;
    vTaskDelete(NULL);
}
