#include "web_server.h"
#include <stdio.h>
#include <string.h>
#include <math.h>
#include "esp_http_server.h"
#include "esp_log.h"
#include "cJSON.h"
#include "wifi_manager.h"
#include "ads1115.h"
#include "web_assets.h"
#include "mqtt_manager.h"
#include "ds18b20_manager.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_system.h"
#include "esp_mac.h"
#include "nvs_flash.h"

static const char *TAG = "WebServer";
static httpd_handle_t server_handle = NULL;

// Helper to launch reboot task in the background
static void deferred_reboot_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Initiating deferred system reboot...");
    vTaskDelay(pdMS_TO_TICKS(1500)); // Delay to allow HTTP response to flush
    esp_restart();
}

// Helper to launch MQTT restart task in the background
static void deferred_mqtt_restart_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Initiating deferred MQTT clients reload...");
    vTaskDelay(pdMS_TO_TICKS(500)); // Delay to allow HTTP response to flush
    mqtt_manager_restart();
    vTaskDelete(NULL);
}

// 1. GET / - Serves Dashboard HTML
static esp_err_t index_get_handler(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html");
    httpd_resp_send(req, INDEX_HTML, HTTPD_RESP_USE_STRLEN);
    return ESP_OK;
}

// 2. GET /api/sensors - Returns live readings and Wi-Fi status
static esp_err_t sensors_get_handler(httpd_req_t *req)
{
    cJSON *root = cJSON_CreateObject();
    
    // Add current readings
    float c0 = ads1115_get_current(0);
    float c1 = ads1115_get_current(1);
    float c2 = ads1115_get_current(2);
    float c3 = ads1115_get_current(3);
    cJSON *currents_arr = cJSON_CreateFloatArray((float[]){c0, c1, c2, c3}, 4);
    cJSON_AddItemToObject(root, "currents", currents_arr);

    // Add power (watts) readings
    float w0 = ads1115_get_watts(0);
    float w1 = ads1115_get_watts(1);
    float w2 = ads1115_get_watts(2);
    float w3 = ads1115_get_watts(3);
    cJSON *watts_arr = cJSON_CreateFloatArray((float[]){w0, w1, w2, w3}, 4);
    cJSON_AddItemToObject(root, "watts", watts_arr);

    // Add kWh readings
    float k0 = ads1115_get_kwh(0);
    float k1 = ads1115_get_kwh(1);
    float k2 = ads1115_get_kwh(2);
    float k3 = ads1115_get_kwh(3);
    cJSON *kwh_arr = cJSON_CreateFloatArray((float[]){k0, k1, k2, k3}, 4);
    cJSON_AddItemToObject(root, "kwh", kwh_arr);

    // Add 1-indexed channel fields for direct REST mapping
    cJSON_AddNumberToObject(root, "current_ch1", round(c0 * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "kwh_ch1", round(k0 * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "power_ch1", round(w0 * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "current_ch2", round(c1 * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "kwh_ch2", round(k1 * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "power_ch2", round(w1 * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "current_ch3", round(c2 * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "kwh_ch3", round(k2 * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "power_ch3", round(w2 * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "current_ch4", round(c3 * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "kwh_ch4", round(k3 * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "power_ch4", round(w3 * 100.0) / 100.0);
    
    // Add Temperature reading
    cJSON_AddNumberToObject(root, "temperature", ds18b20_manager_get_temperature());

    // Add Wi-Fi mode
    wifi_manager_mode_t mode = wifi_manager_get_mode();
    char ip_str[32] = {0};
    if (mode == WIFI_MGR_MODE_STA) {
        cJSON_AddStringToObject(root, "mode", "STA");
        wifi_manager_get_sta_ip(ip_str, sizeof(ip_str));
        char ssid_str[33] = {0};
        if (wifi_manager_get_sta_ssid(ssid_str, sizeof(ssid_str)) == ESP_OK) {
            cJSON_AddStringToObject(root, "ssid", ssid_str);
        }
    } else {
        cJSON_AddStringToObject(root, "mode", "AP");
        wifi_manager_get_ap_ip(ip_str, sizeof(ip_str));
        char ssid_str[33] = {0};
        if (wifi_manager_get_ap_ssid(ssid_str, sizeof(ssid_str)) == ESP_OK) {
            cJSON_AddStringToObject(root, "ssid", ssid_str);
        }
    }
    cJSON_AddStringToObject(root, "ip", ip_str);
    cJSON_AddNumberToObject(root, "free_heap", esp_get_free_heap_size());
    cJSON_AddNumberToObject(root, "min_heap", esp_get_minimum_free_heap_size());

    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char mac_str[13];
    snprintf(mac_str, sizeof(mac_str), "%02x%02x%02x%02x%02x%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    cJSON_AddStringToObject(root, "serial", mac_str);

    const char *sys_json = cJSON_PrintUnformatted(root);
    httpd_resp_set_type(req, "application/json");
    // Prevent client caching for dynamic stats
    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_sendstr(req, sys_json);

    free((void*)sys_json);
    cJSON_Delete(root);
    return ESP_OK;
}

// 2.5 POST /api/sensors/reset_kwh - Resets accumulated energy (kWh)
static esp_err_t reset_kwh_post_handler(httpd_req_t *req)
{
    ads1115_reset_kwh();
    httpd_resp_sendstr(req, "{\"status\":\"success\"}");
    return ESP_OK;
}

// 3. GET /api/wifi/scan - Performs a Wi-Fi scan and returns AP list
static esp_err_t wifi_scan_get_handler(httpd_req_t *req)
{
    wifi_scan_ap_t ap_list[WIFI_MAX_SCAN_AP];
    memset(ap_list, 0, sizeof(ap_list));
    
    int num_aps = wifi_manager_scan(ap_list, WIFI_MAX_SCAN_AP);
    
    cJSON *root = cJSON_CreateArray();
    for (int i = 0; i < num_aps; i++) {
        cJSON *ap = cJSON_CreateObject();
        cJSON_AddStringToObject(ap, "ssid", ap_list[i].ssid);
        cJSON_AddNumberToObject(ap, "rssi", ap_list[i].rssi);
        cJSON_AddNumberToObject(ap, "secure", ap_list[i].secure);
        cJSON_AddItemToArray(root, ap);
    }

    const char *scan_json = cJSON_PrintUnformatted(root);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    httpd_resp_sendstr(req, scan_json);

    free((void*)scan_json);
    cJSON_Delete(root);
    return ESP_OK;
}

// 4. POST /api/wifi/connect - Saves SSID & Password and schedules a reboot
static esp_err_t wifi_connect_post_handler(httpd_req_t *req)
{
    char rx_buf[256];
    int total_len = req->content_len;
    
    if (total_len >= sizeof(rx_buf)) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Payload too large");
        return ESP_FAIL;
    }

    int received = 0;
    int cur_len = 0;
    while (cur_len < total_len) {
        received = httpd_req_recv(req, rx_buf + cur_len, total_len - cur_len);
        if (received <= 0) {
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Receive failed");
            return ESP_FAIL;
        }
        cur_len += received;
    }
    rx_buf[total_len] = '\0';

    cJSON *root = cJSON_Parse(rx_buf);
    if (!root) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid JSON");
        return ESP_FAIL;
    }

    cJSON *ssid_item = cJSON_GetObjectItem(root, "ssid");
    cJSON *pass_item = cJSON_GetObjectItem(root, "password");

    if (!ssid_item || !cJSON_IsString(ssid_item)) {
        cJSON_Delete(root);
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Missing SSID");
        return ESP_FAIL;
    }

    const char *ssid = ssid_item->valuestring;
    const char *password = (pass_item && cJSON_IsString(pass_item)) ? pass_item->valuestring : "";

    esp_err_t err = wifi_manager_save_credentials(ssid, password);
    cJSON_Delete(root);

    if (err == ESP_OK) {
        httpd_resp_sendstr(req, "{\"status\":\"success\"}");
        // Spawn background task to reboot after response completes
        xTaskCreate(deferred_reboot_task, "def_reboot", 2048, NULL, 2, NULL);
    } else {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to save configuration");
    }

    return ESP_OK;
}

// 5. POST /api/wifi/reset - Clears credentials and schedules a reboot
static esp_err_t wifi_reset_post_handler(httpd_req_t *req)
{
    esp_err_t err = wifi_manager_clear_credentials();
    if (err == ESP_OK) {
        httpd_resp_sendstr(req, "{\"status\":\"success\"}");
        xTaskCreate(deferred_reboot_task, "def_reboot", 2048, NULL, 2, NULL);
    } else {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to clear credentials");
    }
    return ESP_OK;
}

// 5.5 POST /api/system/factory_reset - Deletes all custom NVS data and restarts
static void deferred_factory_reset_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Initiating deferred factory reset...");
    vTaskDelay(pdMS_TO_TICKS(1500)); // Delay to allow HTTP response to flush
    nvs_flash_deinit();
    nvs_flash_erase();
    esp_restart();
}

static esp_err_t factory_reset_post_handler(httpd_req_t *req)
{
    httpd_resp_sendstr(req, "{\"status\":\"success\"}");
    xTaskCreate(deferred_factory_reset_task, "def_factory_reset", 3072, NULL, 2, NULL);
    return ESP_OK;
}


// 6. GET /api/calibration - Returns current calibration factors
static esp_err_t calibration_get_handler(httpd_req_t *req)
{
    float cal[4];
    ads1115_get_calibration(cal);

    cJSON *root = cJSON_CreateObject();
    cJSON *cal_arr = cJSON_CreateFloatArray(cal, 4);
    cJSON_AddItemToObject(root, "calibration", cal_arr);
    cJSON_AddNumberToObject(root, "voltage", ads1115_get_voltage());
    cJSON_AddNumberToObject(root, "temp_offset", ds18b20_manager_get_offset());
    cJSON_AddNumberToObject(root, "kwh_rate", ads1115_get_kwh_rate());
    char curr_str[8] = {0};
    ads1115_get_currency(curr_str, sizeof(curr_str));
    cJSON_AddStringToObject(root, "currency", curr_str);

    const char *json_str = cJSON_PrintUnformatted(root);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_sendstr(req, json_str);

    free((void*)json_str);
    cJSON_Delete(root);
    return ESP_OK;
}

// 7. POST /api/calibration - Updates calibration factors dynamically
static esp_err_t calibration_post_handler(httpd_req_t *req)
{
    char rx_buf[256];
    int total_len = req->content_len;
    
    if (total_len >= sizeof(rx_buf)) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Payload too large");
        return ESP_FAIL;
    }

    int received = 0;
    int cur_len = 0;
    while (cur_len < total_len) {
        received = httpd_req_recv(req, rx_buf + cur_len, total_len - cur_len);
        if (received <= 0) {
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Receive failed");
            return ESP_FAIL;
        }
        cur_len += received;
    }
    rx_buf[total_len] = '\0';

    cJSON *root = cJSON_Parse(rx_buf);
    if (!root) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid JSON");
        return ESP_FAIL;
    }

    cJSON *cal_arr = cJSON_GetObjectItem(root, "calibration");
    if (!cal_arr || !cJSON_IsArray(cal_arr) || cJSON_GetArraySize(cal_arr) != 4) {
        cJSON_Delete(root);
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Missing or invalid calibration array");
        return ESP_FAIL;
    }

    float new_cal[4];
    for (int i = 0; i < 4; i++) {
        cJSON *item = cJSON_GetArrayItem(cal_arr, i);
        if (!cJSON_IsNumber(item)) {
            cJSON_Delete(root);
            httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Calibration values must be numbers");
            return ESP_FAIL;
        }
        new_cal[i] = (float)item->valuedouble;
        if (new_cal[i] <= 0.0f) {
            cJSON_Delete(root);
            httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Calibration values must be positive numbers");
            return ESP_FAIL;
        }
    }

    esp_err_t err = ads1115_save_calibration(new_cal);

    // Save assumed voltage reference if provided in the request payload
    cJSON *vol_item = cJSON_GetObjectItem(root, "voltage");
    if (vol_item && cJSON_IsNumber(vol_item)) {
        float new_vol = (float)vol_item->valuedouble;
        if (new_vol > 0.0f) {
            esp_err_t vol_err = ads1115_save_voltage(new_vol);
            if (err == ESP_OK) {
                err = vol_err;
            }
        }
    }

    // Save temperature calibration offset if provided in the request payload
    cJSON *temp_off_item = cJSON_GetObjectItem(root, "temp_offset");
    if (temp_off_item && cJSON_IsNumber(temp_off_item)) {
        float new_temp_off = (float)temp_off_item->valuedouble;
        esp_err_t temp_err = ds18b20_manager_save_offset(new_temp_off);
        if (err == ESP_OK) {
            err = temp_err;
        }
    }

    // Save kWh rate if provided in the request payload
    cJSON *rate_item = cJSON_GetObjectItem(root, "kwh_rate");
    if (rate_item) {
        if (cJSON_IsNumber(rate_item)) {
            float new_rate = (float)rate_item->valuedouble;
            esp_err_t rate_err = ads1115_save_kwh_rate(new_rate);
            if (err == ESP_OK) {
                err = rate_err;
            }
        } else if (cJSON_IsNull(rate_item)) {
            esp_err_t rate_err = ads1115_save_kwh_rate(0.0f);
            if (err == ESP_OK) {
                err = rate_err;
            }
        }
    }

    // Save currency if provided in the request payload
    cJSON *curr_item = cJSON_GetObjectItem(root, "currency");
    if (curr_item && cJSON_IsString(curr_item)) {
        esp_err_t curr_err = ads1115_save_currency(curr_item->valuestring);
        if (err == ESP_OK) {
            err = curr_err;
        }
    }

    cJSON_Delete(root);

    if (err == ESP_OK) {
        httpd_resp_sendstr(req, "{\"status\":\"success\"}");
    } else {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to save calibration factors");
    }

    return ESP_OK;
}
// 8. GET /api/mqtt - Returns HA and Cloud MQTT configurations
static esp_err_t mqtt_get_handler(httpd_req_t *req)
{
    mqtt_ha_config_t ha_cfg;
    mqtt_cloud_config_t *cloud_cfg = calloc(1, sizeof(mqtt_cloud_config_t));
    if (!cloud_cfg) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Out of memory");
        return ESP_FAIL;
    }
    
    mqtt_manager_load_ha_config(&ha_cfg);
    mqtt_manager_load_cloud_config(cloud_cfg);

    cJSON *root = cJSON_CreateObject();
    
    cJSON *ha_obj = cJSON_CreateObject();
    cJSON_AddBoolToObject(ha_obj, "enabled", ha_cfg.enabled);
    cJSON_AddStringToObject(ha_obj, "host", ha_cfg.host);
    cJSON_AddNumberToObject(ha_obj, "port", ha_cfg.port);
    cJSON_AddStringToObject(ha_obj, "user", ha_cfg.user);
    cJSON_AddItemToObject(root, "ha", ha_obj);

    cJSON *cloud_obj = cJSON_CreateObject();
    cJSON_AddBoolToObject(cloud_obj, "enabled", cloud_cfg->enabled);
    cJSON_AddStringToObject(cloud_obj, "host", cloud_cfg->host);
    cJSON_AddNumberToObject(cloud_obj, "port", cloud_cfg->port);
    cJSON_AddStringToObject(cloud_obj, "user", cloud_cfg->user);
    cJSON_AddStringToObject(cloud_obj, "cert", cloud_cfg->cert);
    cJSON_AddStringToObject(cloud_obj, "topic", cloud_cfg->topic);
    cJSON_AddItemToObject(root, "cloud", cloud_obj);

    free(cloud_cfg);

    const char *json_str = cJSON_PrintUnformatted(root);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_sendstr(req, json_str);

    free((void*)json_str);
    cJSON_Delete(root);
    return ESP_OK;
}

// 9. POST /api/mqtt - Saves both MQTT settings and reloads the clients
static esp_err_t mqtt_post_handler(httpd_req_t *req)
{
    char *rx_buf = malloc(2048);
    if (!rx_buf) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Out of memory");
        return ESP_FAIL;
    }

    int total_len = req->content_len;
    if (total_len >= 2048) {
        free(rx_buf);
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Payload too large");
        return ESP_FAIL;
    }

    int received = 0;
    int cur_len = 0;
    while (cur_len < total_len) {
        received = httpd_req_recv(req, rx_buf + cur_len, total_len - cur_len);
        if (received <= 0) {
            free(rx_buf);
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Receive failed");
            return ESP_FAIL;
        }
        cur_len += received;
    }
    rx_buf[total_len] = '\0';

    cJSON *root = cJSON_Parse(rx_buf);
    free(rx_buf);
    if (!root) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid JSON");
        return ESP_FAIL;
    }

    cJSON *ha_obj = cJSON_GetObjectItem(root, "ha");
    cJSON *cloud_obj = cJSON_GetObjectItem(root, "cloud");

    if (ha_obj) {
        mqtt_ha_config_t ha_cfg = {0};
        cJSON *en = cJSON_GetObjectItem(ha_obj, "enabled");
        cJSON *ho = cJSON_GetObjectItem(ha_obj, "host");
        cJSON *po = cJSON_GetObjectItem(ha_obj, "port");
        cJSON *us = cJSON_GetObjectItem(ha_obj, "user");
        cJSON *pa = cJSON_GetObjectItem(ha_obj, "pass");

        ha_cfg.enabled = en ? cJSON_IsTrue(en) : false;
        if (ho && cJSON_IsString(ho)) strncpy(ha_cfg.host, ho->valuestring, sizeof(ha_cfg.host) - 1);
        ha_cfg.port = (po && cJSON_IsNumber(po)) ? po->valueint : 1883;
        if (us && cJSON_IsString(us)) strncpy(ha_cfg.user, us->valuestring, sizeof(ha_cfg.user) - 1);
        
        if (pa && cJSON_IsString(pa) && strlen(pa->valuestring) > 0) {
            strncpy(ha_cfg.pass, pa->valuestring, sizeof(ha_cfg.pass) - 1);
        } else {
            mqtt_ha_config_t existing;
            mqtt_manager_load_ha_config(&existing);
            strncpy(ha_cfg.pass, existing.pass, sizeof(ha_cfg.pass) - 1);
        }

        mqtt_manager_save_ha_config(&ha_cfg);
    }

    if (cloud_obj) {
        mqtt_cloud_config_t *cloud_cfg = calloc(1, sizeof(mqtt_cloud_config_t));
        if (!cloud_cfg) {
            cJSON_Delete(root);
            return ESP_FAIL;
        }
        cJSON *en = cJSON_GetObjectItem(cloud_obj, "enabled");
        cJSON *ho = cJSON_GetObjectItem(cloud_obj, "host");
        cJSON *po = cJSON_GetObjectItem(cloud_obj, "port");
        cJSON *us = cJSON_GetObjectItem(cloud_obj, "user");
        cJSON *pa = cJSON_GetObjectItem(cloud_obj, "pass");
        cJSON *ce = cJSON_GetObjectItem(cloud_obj, "cert");
        cJSON *to = cJSON_GetObjectItem(cloud_obj, "topic");

        cloud_cfg->enabled = en ? cJSON_IsTrue(en) : false;
        if (ho && cJSON_IsString(ho)) strncpy(cloud_cfg->host, ho->valuestring, sizeof(cloud_cfg->host) - 1);
        cloud_cfg->port = (po && cJSON_IsNumber(po)) ? po->valueint : 8883;
        if (us && cJSON_IsString(us)) strncpy(cloud_cfg->user, us->valuestring, sizeof(cloud_cfg->user) - 1);
        
        if (pa && cJSON_IsString(pa) && strlen(pa->valuestring) > 0) {
            strncpy(cloud_cfg->pass, pa->valuestring, sizeof(cloud_cfg->pass) - 1);
        } else {
            mqtt_cloud_config_t *existing = calloc(1, sizeof(mqtt_cloud_config_t));
            if (existing) {
                mqtt_manager_load_cloud_config(existing);
                strncpy(cloud_cfg->pass, existing->pass, sizeof(cloud_cfg->pass) - 1);
                free(existing);
            }
        }

        if (ce && cJSON_IsString(ce)) strncpy(cloud_cfg->cert, ce->valuestring, sizeof(cloud_cfg->cert) - 1);
        if (to && cJSON_IsString(to)) strncpy(cloud_cfg->topic, to->valuestring, sizeof(cloud_cfg->topic) - 1);

        mqtt_manager_save_cloud_config(cloud_cfg);
        free(cloud_cfg);
    }

    cJSON_Delete(root);

    // Dynamic Client reload (deferred to background task to allow HTTP response to flush first)
    xTaskCreate(deferred_mqtt_restart_task, "mqtt_restart", 4096, NULL, 3, NULL);

    httpd_resp_sendstr(req, "{\"status\":\"success\"}");
    return ESP_OK;
}

// Captive Portal redirect handler for unknown URIs (404)
static esp_err_t captive_portal_redirect_handler(httpd_req_t *req, httpd_err_code_t err)
{
    // If we are in AP mode, redirect any unknown request to our root configuration page
    if (wifi_manager_get_mode() == WIFI_MGR_MODE_AP) {
        ESP_LOGI(TAG, "Redirecting client request for '%s' to landing page", req->uri);
        httpd_resp_set_status(req, "302 Found");
        httpd_resp_set_hdr(req, "Location", "http://192.168.4.1/");
        httpd_resp_send(req, NULL, 0);
        return ESP_OK;
    }
    // Otherwise, return standard 404
    httpd_resp_send_err(req, HTTPD_404_NOT_FOUND, "Not Found");
    return ESP_FAIL;
}

// Start Server
esp_err_t start_web_server(void)
{
    if (server_handle != NULL) {
        return ESP_OK; // Server already running
    }

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_uri_handlers = 12;
    config.lru_purge_enable = true;

    ESP_LOGI(TAG, "Starting HTTP Server on port %d...", config.server_port);
    esp_err_t err = httpd_start(&server_handle, &config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start HTTP server: %s", esp_err_to_name(err));
        return err;
    }

    // URI Registration
    httpd_uri_t index_uri = {
        .uri      = "/",
        .method   = HTTP_GET,
        .handler  = index_get_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server_handle, &index_uri);

    httpd_uri_t sensors_uri = {
        .uri      = "/api/sensors",
        .method   = HTTP_GET,
        .handler  = sensors_get_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server_handle, &sensors_uri);

    httpd_uri_t reset_kwh_uri = {
        .uri      = "/api/sensors/reset_kwh",
        .method   = HTTP_POST,
        .handler  = reset_kwh_post_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server_handle, &reset_kwh_uri);

    httpd_uri_t scan_uri = {
        .uri      = "/api/wifi/scan",
        .method   = HTTP_GET,
        .handler  = wifi_scan_get_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server_handle, &scan_uri);

    httpd_uri_t connect_uri = {
        .uri      = "/api/wifi/connect",
        .method   = HTTP_POST,
        .handler  = wifi_connect_post_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server_handle, &connect_uri);

    httpd_uri_t reset_uri = {
        .uri      = "/api/wifi/reset",
        .method   = HTTP_POST,
        .handler  = wifi_reset_post_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server_handle, &reset_uri);

    httpd_uri_t factory_reset_uri = {
        .uri      = "/api/system/factory_reset",
        .method   = HTTP_POST,
        .handler  = factory_reset_post_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server_handle, &factory_reset_uri);

    httpd_uri_t calibration_get_uri = {
        .uri      = "/api/calibration",
        .method   = HTTP_GET,
        .handler  = calibration_get_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server_handle, &calibration_get_uri);

    httpd_uri_t calibration_post_uri = {
        .uri      = "/api/calibration",
        .method   = HTTP_POST,
        .handler  = calibration_post_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server_handle, &calibration_post_uri);

    httpd_uri_t mqtt_get_uri = {
        .uri      = "/api/mqtt",
        .method   = HTTP_GET,
        .handler  = mqtt_get_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server_handle, &mqtt_get_uri);

    httpd_uri_t mqtt_post_uri = {
        .uri      = "/api/mqtt",
        .method   = HTTP_POST,
        .handler  = mqtt_post_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server_handle, &mqtt_post_uri);

    // Register captive portal error handler for 404 errors
    httpd_register_err_handler(server_handle, HTTPD_404_NOT_FOUND, captive_portal_redirect_handler);

    ESP_LOGI(TAG, "Web server started and URIs registered");
    return ESP_OK;
}

// Stop Server
void stop_web_server(void)
{
    if (server_handle != NULL) {
        httpd_stop(server_handle);
        server_handle = NULL;
        ESP_LOGI(TAG, "Web server stopped");
    }
}
