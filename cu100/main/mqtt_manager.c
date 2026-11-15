#include "mqtt_manager.h"
#include <stdio.h>
#include <string.h>
#include <math.h>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "mqtt_client.h"
#include "cJSON.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "ads1115.h"
#include "ds18b20_manager.h"

static const char *TAG = "MQTT_MGR";

#define NVS_HA_NAMESPACE      "ha_mqtt"
#define NVS_CLOUD_NAMESPACE   "cloud_mqtt"

static esp_mqtt_client_handle_t ha_client = NULL;
static esp_mqtt_client_handle_t cloud_client = NULL;
static SemaphoreHandle_t mqtt_mutex = NULL;

static mqtt_ha_config_t ha_config = {0};
static mqtt_cloud_config_t cloud_config = {0};

static void publish_ha_discovery(void);

// NVS helpers
static esp_err_t nvs_read_str_helper(nvs_handle_t handle, const char *key, char *out_val, size_t max_len, const char *default_val)
{
    size_t required_len = max_len;
    esp_err_t err = nvs_get_str(handle, key, out_val, &required_len);
    if (err != ESP_OK) {
        strncpy(out_val, default_val, max_len);
        out_val[max_len - 1] = '\0';
    }
    return err;
}

esp_err_t mqtt_manager_load_ha_config(mqtt_ha_config_t *cfg)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_HA_NAMESPACE, NVS_READONLY, &handle);
    if (err != ESP_OK) {
        cfg->enabled = false;
        cfg->host[0] = '\0';
        cfg->port = 1883;
        cfg->user[0] = '\0';
        cfg->pass[0] = '\0';
        return err;
    }

    uint8_t enabled_val = 0;
    nvs_get_u8(handle, "enabled", &enabled_val);
    cfg->enabled = (enabled_val == 1);

    uint16_t port_val = 1883;
    nvs_get_u16(handle, "port", &port_val);
    cfg->port = port_val;

    nvs_read_str_helper(handle, "host", cfg->host, sizeof(cfg->host), "");
    nvs_read_str_helper(handle, "user", cfg->user, sizeof(cfg->user), "");
    nvs_read_str_helper(handle, "pass", cfg->pass, sizeof(cfg->pass), "");

    nvs_close(handle);
    return ESP_OK;
}

esp_err_t mqtt_manager_save_ha_config(const mqtt_ha_config_t *cfg)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_HA_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;

    nvs_set_u8(handle, "enabled", cfg->enabled ? 1 : 0);
    nvs_set_u16(handle, "port", cfg->port);
    nvs_set_str(handle, "host", cfg->host);
    nvs_set_str(handle, "user", cfg->user);
    nvs_set_str(handle, "pass", cfg->pass);

    err = nvs_commit(handle);
    nvs_close(handle);
    return err;
}

esp_err_t mqtt_manager_load_cloud_config(mqtt_cloud_config_t *cfg)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_CLOUD_NAMESPACE, NVS_READONLY, &handle);
    if (err != ESP_OK) {
        cfg->enabled = true;
        strncpy(cfg->host, "messages.currentusage.com", sizeof(cfg->host) - 1);
        cfg->port = 1883;
        cfg->user[0] = '\0';
        cfg->pass[0] = '\0';
        cfg->cert[0] = '\0';
        cfg->topic[0] = '\0';
        return err;
    }

    uint8_t enabled_val = 1;
    nvs_get_u8(handle, "enabled", &enabled_val);
    cfg->enabled = (enabled_val == 1);

    uint16_t port_val = 1883;
    nvs_get_u16(handle, "port", &port_val);
    cfg->port = port_val;

    nvs_read_str_helper(handle, "host", cfg->host, sizeof(cfg->host), "messages.currentusage.com");
    nvs_read_str_helper(handle, "user", cfg->user, sizeof(cfg->user), "");
    nvs_read_str_helper(handle, "pass", cfg->pass, sizeof(cfg->pass), "");
    nvs_read_str_helper(handle, "cert", cfg->cert, sizeof(cfg->cert), "");
    nvs_read_str_helper(handle, "topic", cfg->topic, sizeof(cfg->topic), "");

    nvs_close(handle);
    return ESP_OK;
}

esp_err_t mqtt_manager_save_cloud_config(const mqtt_cloud_config_t *cfg)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_CLOUD_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;

    nvs_set_u8(handle, "enabled", cfg->enabled ? 1 : 0);
    nvs_set_u16(handle, "port", cfg->port);
    nvs_set_str(handle, "host", cfg->host);
    nvs_set_str(handle, "user", cfg->user);
    nvs_set_str(handle, "pass", cfg->pass);
    nvs_set_str(handle, "cert", cfg->cert);
    nvs_set_str(handle, "topic", cfg->topic);

    err = nvs_commit(handle);
    nvs_close(handle);
    return err;
}

static void ha_mqtt_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    switch ((esp_mqtt_event_id_t)event_id) {
        case MQTT_EVENT_CONNECTED:
            ESP_LOGI(TAG, "HA MQTT Client connected successfully!");
            publish_ha_discovery();
            break;
        case MQTT_EVENT_DISCONNECTED:
            ESP_LOGW(TAG, "HA MQTT Client disconnected");
            break;
        case MQTT_EVENT_ERROR:
            ESP_LOGE(TAG, "HA MQTT Client encountered error");
            break;
        default:
            break;
    }
}

static char cloud_status_topic[64] = {0};

static void cloud_mqtt_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    switch ((esp_mqtt_event_id_t)event_id) {
        case MQTT_EVENT_CONNECTED:
            ESP_LOGI(TAG, "Cloud MQTT Client connected successfully!");
            if (cloud_client && strlen(cloud_status_topic) > 0) {
                esp_mqtt_client_publish(cloud_client, cloud_status_topic, "{\"status\":\"online\"}", 0, 1, 1);
            }
            break;
        case MQTT_EVENT_DISCONNECTED:
            ESP_LOGW(TAG, "Cloud MQTT Client disconnected");
            break;
        case MQTT_EVENT_ERROR:
            ESP_LOGE(TAG, "Cloud MQTT Client encountered error");
            break;
        default:
            break;
    }
}

static void publish_ha_discovery(void)
{
    if (!ha_client) return;

    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char mac_str[13];
    snprintf(mac_str, sizeof(mac_str), "%02x%02x%02x%02x%02x%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    char dev_id[32];
    snprintf(dev_id, sizeof(dev_id), "cu100_%s", mac_str);

    for (int ch = 0; ch < 4; ch++) {
        cJSON *root = cJSON_CreateObject();
        char name_buf[32];
        snprintf(name_buf, sizeof(name_buf), "SCT Sensor %d Current", ch + 1);
        cJSON_AddStringToObject(root, "name", name_buf);

        char state_topic[64];
        snprintf(state_topic, sizeof(state_topic), "cu100/%s/state", mac_str);
        cJSON_AddStringToObject(root, "stat_t", state_topic);

        char tpl_buf[32];
        snprintf(tpl_buf, sizeof(tpl_buf), "{{ value_json.current_ch%d }}", ch + 1);
        cJSON_AddStringToObject(root, "val_tpl", tpl_buf);

        cJSON_AddStringToObject(root, "unit_of_meas", "A");
        cJSON_AddStringToObject(root, "device_class", "current");
        cJSON_AddStringToObject(root, "state_class", "measurement");

        char uniq_id_buf[64];
        snprintf(uniq_id_buf, sizeof(uniq_id_buf), "cu100_%s_ch%d", mac_str, ch + 1);
        cJSON_AddStringToObject(root, "uniq_id", uniq_id_buf);

        cJSON *dev = cJSON_CreateObject();
        cJSON *ids = cJSON_CreateArray();
        cJSON_AddItemToArray(ids, cJSON_CreateString(dev_id));
        cJSON_AddItemToObject(dev, "ids", ids);
        cJSON_AddStringToObject(dev, "name", "CU100 Energy Monitor");
        cJSON_AddStringToObject(dev, "mdl", "CU100");
        cJSON_AddStringToObject(dev, "mf", "Custom");
        cJSON_AddItemToObject(root, "dev", dev);

        char *payload = cJSON_PrintUnformatted(root);
        
        char topic[128];
        snprintf(topic, sizeof(topic), "homeassistant/sensor/cu100_%s_ch%d/config", mac_str, ch + 1);
        
        ESP_LOGI(TAG, "Publishing HA Discovery topic: %s", topic);
        esp_mqtt_client_publish(ha_client, topic, payload, 0, 1, 1);

        free(payload);
        cJSON_Delete(root);

        // 2. Publish Energy (kWh) Auto-Discovery
        cJSON *root_kwh = cJSON_CreateObject();
        char name_kwh[40];
        snprintf(name_kwh, sizeof(name_kwh), "SCT Sensor %d Energy", ch + 1);
        cJSON_AddStringToObject(root_kwh, "name", name_kwh);
        cJSON_AddStringToObject(root_kwh, "stat_t", state_topic);

        char tpl_kwh[40];
        snprintf(tpl_kwh, sizeof(tpl_kwh), "{{ value_json.kwh_ch%d }}", ch + 1);
        cJSON_AddStringToObject(root_kwh, "val_tpl", tpl_kwh);

        cJSON_AddStringToObject(root_kwh, "unit_of_meas", "kWh");
        cJSON_AddStringToObject(root_kwh, "device_class", "energy");
        cJSON_AddStringToObject(root_kwh, "state_class", "total_increasing");

        char uniq_id_kwh[64];
        snprintf(uniq_id_kwh, sizeof(uniq_id_kwh), "cu100_%s_kwh_ch%d", mac_str, ch + 1);
        cJSON_AddStringToObject(root_kwh, "uniq_id", uniq_id_kwh);

        cJSON *dev_kwh = cJSON_CreateObject();
        cJSON *ids_kwh = cJSON_CreateArray();
        cJSON_AddItemToArray(ids_kwh, cJSON_CreateString(dev_id));
        cJSON_AddItemToObject(dev_kwh, "ids", ids_kwh);
        cJSON_AddStringToObject(dev_kwh, "name", "CU100 Energy Monitor");
        cJSON_AddStringToObject(dev_kwh, "mdl", "CU100");
        cJSON_AddStringToObject(dev_kwh, "mf", "Custom");
        cJSON_AddItemToObject(root_kwh, "dev", dev_kwh);

        char *payload_kwh = cJSON_PrintUnformatted(root_kwh);
        char topic_kwh[128];
        snprintf(topic_kwh, sizeof(topic_kwh), "homeassistant/sensor/cu100_%s_kwh_ch%d/config", mac_str, ch + 1);

        ESP_LOGI(TAG, "Publishing HA Discovery topic (Energy): %s", topic_kwh);
        esp_mqtt_client_publish(ha_client, topic_kwh, payload_kwh, 0, 1, 1);

        free(payload_kwh);
        cJSON_Delete(root_kwh);

        // 3. Publish Power (W) Auto-Discovery
        cJSON *root_w = cJSON_CreateObject();
        char name_w[40];
        snprintf(name_w, sizeof(name_w), "SCT Sensor %d Power", ch + 1);
        cJSON_AddStringToObject(root_w, "name", name_w);
        cJSON_AddStringToObject(root_w, "stat_t", state_topic);

        char tpl_w[40];
        snprintf(tpl_w, sizeof(tpl_w), "{{ value_json.power_ch%d }}", ch + 1);
        cJSON_AddStringToObject(root_w, "val_tpl", tpl_w);

        cJSON_AddStringToObject(root_w, "unit_of_meas", "W");
        cJSON_AddStringToObject(root_w, "device_class", "power");
        cJSON_AddStringToObject(root_w, "state_class", "measurement");

        char uniq_id_w[64];
        snprintf(uniq_id_w, sizeof(uniq_id_w), "cu100_%s_power_ch%d", mac_str, ch + 1);
        cJSON_AddStringToObject(root_w, "uniq_id", uniq_id_w);

        cJSON *dev_w = cJSON_CreateObject();
        cJSON *ids_w = cJSON_CreateArray();
        cJSON_AddItemToArray(ids_w, cJSON_CreateString(dev_id));
        cJSON_AddItemToObject(dev_w, "ids", ids_w);
        cJSON_AddStringToObject(dev_w, "name", "CU100 Energy Monitor");
        cJSON_AddStringToObject(dev_w, "mdl", "CU100");
        cJSON_AddStringToObject(dev_w, "mf", "Custom");
        cJSON_AddItemToObject(root_w, "dev", dev_w);

        char *payload_w = cJSON_PrintUnformatted(root_w);
        char topic_w[128];
        snprintf(topic_w, sizeof(topic_w), "homeassistant/sensor/cu100_%s_power_ch%d/config", mac_str, ch + 1);

        ESP_LOGI(TAG, "Publishing HA Discovery topic (Power): %s", topic_w);
        esp_mqtt_client_publish(ha_client, topic_w, payload_w, 0, 1, 1);

        free(payload_w);
        cJSON_Delete(root_w);
    }
}

void mqtt_manager_init(void)
{
    if (!mqtt_mutex) {
        mqtt_mutex = xSemaphoreCreateMutex();
    }

    if (xSemaphoreTake(mqtt_mutex, pdMS_TO_TICKS(1000)) != pdTRUE) {
        ESP_LOGE(TAG, "Failed to acquire MQTT lock for init");
        return;
    }

    // Load configs
    mqtt_manager_load_ha_config(&ha_config);
    mqtt_manager_load_cloud_config(&cloud_config);

    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char mac_str[13];
    snprintf(mac_str, sizeof(mac_str), "%02x%02x%02x%02x%02x%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    // Initialize HA client if enabled
    if (ha_config.enabled && strlen(ha_config.host) > 0) {
        char uri[128];
        snprintf(uri, sizeof(uri), "mqtt://%s:%d", ha_config.host, ha_config.port);
        char client_id[32];
        snprintf(client_id, sizeof(client_id), "cu100_ha_%s", mac_str);

        ESP_LOGI(TAG, "Starting HA Client on %s", uri);
        esp_mqtt_client_config_t ha_cfg = {
            .broker.address.uri = uri,
            .credentials.client_id = client_id,
            .credentials.username = ha_config.user,
            .credentials.authentication.password = ha_config.pass,
        };
        ha_client = esp_mqtt_client_init(&ha_cfg);
        if (ha_client) {
            esp_mqtt_client_register_event(ha_client, ESP_EVENT_ANY_ID, ha_mqtt_event_handler, NULL);
            esp_mqtt_client_start(ha_client);
        } else {
            ESP_LOGE(TAG, "Failed to init HA MQTT client");
        }
    }

    // Initialize Cloud MQTTS/MQTT client if enabled
    if (cloud_config.enabled && strlen(cloud_config.host) > 0) {
        char uri[128];
        bool is_tls = true;
        if (strstr(cloud_config.host, "://") != NULL) {
            snprintf(uri, sizeof(uri), "%s:%d", cloud_config.host, cloud_config.port);
            if (strncmp(cloud_config.host, "mqtt://", 7) == 0) {
                is_tls = false;
            }
        } else {
            const char *scheme = (cloud_config.port == 1883) ? "mqtt" : "mqtts";
            snprintf(uri, sizeof(uri), "%s://%s:%d", scheme, cloud_config.host, cloud_config.port);
            if (cloud_config.port == 1883) {
                is_tls = false;
            }
        }
        char client_id[32];
        snprintf(client_id, sizeof(client_id), "cu100_cloud_%s", mac_str);

        if (is_tls) {
            ESP_LOGI(TAG, "Starting Cloud MQTTS Client on %s", uri);
        } else {
            ESP_LOGI(TAG, "Starting Cloud MQTT Client (non-TLS) on %s", uri);
        }

        snprintf(cloud_status_topic, sizeof(cloud_status_topic), "cu100/%s/status", mac_str);

        esp_mqtt_client_config_t cloud_cfg = {
            .broker.address.uri = uri,
            .credentials.client_id = client_id,
            .credentials.username = cloud_config.user,
            .credentials.authentication.password = cloud_config.pass,
            .session.last_will = {
                .topic = cloud_status_topic,
                .msg = "{\"status\":\"offline\"}",
                .msg_len = strlen("{\"status\":\"offline\"}"),
                .qos = 1,
                .retain = true,
            },
        };

        if (is_tls) {
            if (strlen(cloud_config.cert) > 0) {
                cloud_cfg.broker.verification.certificate = cloud_config.cert;
            } else {
                // No custom root certificate supplied, bypass strict checking for ease of installation
                cloud_cfg.broker.verification.skip_cert_common_name_check = true;
            }
        }

        cloud_client = esp_mqtt_client_init(&cloud_cfg);
        if (cloud_client) {
            esp_mqtt_client_register_event(cloud_client, ESP_EVENT_ANY_ID, cloud_mqtt_event_handler, NULL);
            esp_mqtt_client_start(cloud_client);
        } else {
            ESP_LOGE(TAG, "Failed to init Cloud MQTT client");
        }
    }

    xSemaphoreGive(mqtt_mutex);
}

void mqtt_manager_stop(void)
{
    if (!mqtt_mutex) return;
    if (xSemaphoreTake(mqtt_mutex, pdMS_TO_TICKS(1000)) != pdTRUE) return;

    if (ha_client) {
        esp_mqtt_client_stop(ha_client);
        esp_mqtt_client_destroy(ha_client);
        ha_client = NULL;
    }

    if (cloud_client) {
        esp_mqtt_client_stop(cloud_client);
        esp_mqtt_client_destroy(cloud_client);
        cloud_client = NULL;
    }

    xSemaphoreGive(mqtt_mutex);
}

void mqtt_manager_restart(void)
{
    mqtt_manager_stop();
    mqtt_manager_init();
}

void mqtt_manager_publish_currents(const float *currents)
{
    if (!mqtt_mutex) return;
    if (xSemaphoreTake(mqtt_mutex, pdMS_TO_TICKS(200)) != pdTRUE) return;

    if (!ha_client && !cloud_client) {
        xSemaphoreGive(mqtt_mutex);
        return;
    }

    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char mac_str[13];
    snprintf(mac_str, sizeof(mac_str), "%02x%02x%02x%02x%02x%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "current_ch1", round(currents[0] * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "kwh_ch1", round(ads1115_get_kwh(0) * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "power_ch1", round(ads1115_get_watts(0) * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "current_ch2", round(currents[1] * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "kwh_ch2", round(ads1115_get_kwh(1) * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "power_ch2", round(ads1115_get_watts(1) * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "current_ch3", round(currents[2] * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "kwh_ch3", round(ads1115_get_kwh(2) * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "power_ch3", round(ads1115_get_watts(2) * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "current_ch4", round(currents[3] * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "kwh_ch4", round(ads1115_get_kwh(3) * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "power_ch4", round(ads1115_get_watts(3) * 100.0) / 100.0);
    cJSON_AddNumberToObject(root, "temperature", round(ds18b20_manager_get_temperature() * 100.0) / 100.0);
    
    char *payload = cJSON_PrintUnformatted(root);
    char topic[64];
    snprintf(topic, sizeof(topic), "cu100/%s/state", mac_str);

    if (ha_client) {
        esp_mqtt_client_publish(ha_client, topic, payload, 0, 1, 0);
    }

    if (cloud_client) {
        const char *cloud_topic = (strlen(cloud_config.topic) > 0) ? cloud_config.topic : topic;
        esp_mqtt_client_publish(cloud_client, cloud_topic, payload, 0, 1, 0);
    }

    free(payload);
    cJSON_Delete(root);
    xSemaphoreGive(mqtt_mutex);
}
