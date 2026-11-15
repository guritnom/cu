#ifndef MAIN_MQTT_MANAGER_H_
#define MAIN_MQTT_MANAGER_H_

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"

// Home Assistant Local MQTT Config
typedef struct {
    bool enabled;
    char host[64];
    uint16_t port;
    char user[32];
    char pass[64];
} mqtt_ha_config_t;

// Cloud Platform secure MQTTS Config
typedef struct {
    bool enabled;
    char host[64];
    uint16_t port;
    char user[64]; // Can be PSK-ID for Golioth or username for HiveMQ
    char pass[128]; // Can be PSK Key or password
    char cert[1024]; // TLS CA certificate in PEM format
    char topic[64]; // Custom topic for cloud sync
} mqtt_cloud_config_t;

/**
 * @brief Initialize and start MQTT client instances based on NVS settings.
 */
void mqtt_manager_init(void);

/**
 * @brief Stop and destroy both MQTT client instances.
 */
void mqtt_manager_stop(void);

/**
 * @brief Reload settings and restart the MQTT clients dynamically.
 */
void mqtt_manager_restart(void);

/**
 * @brief Publish latest current readings to active MQTT brokers.
 * 
 * @param currents Array of 4 floats representing channels 0 to 3.
 */
void mqtt_manager_publish_currents(const float *currents);

/**
 * @brief Load Local Home Assistant configuration from NVS.
 */
esp_err_t mqtt_manager_load_ha_config(mqtt_ha_config_t *cfg);

/**
 * @brief Save Local Home Assistant configuration to NVS.
 */
esp_err_t mqtt_manager_save_ha_config(const mqtt_ha_config_t *cfg);

/**
 * @brief Load Cloud MQTT configuration from NVS.
 */
esp_err_t mqtt_manager_load_cloud_config(mqtt_cloud_config_t *cfg);

/**
 * @brief Save Cloud MQTT configuration to NVS.
 */
esp_err_t mqtt_manager_save_cloud_config(const mqtt_cloud_config_t *cfg);

#endif // MAIN_MQTT_MANAGER_H_
