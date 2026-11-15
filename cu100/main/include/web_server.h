#ifndef MAIN_WEB_SERVER_H_
#define MAIN_WEB_SERVER_H_

#include "esp_err.h"

/**
 * @brief Initialize and start the HTTP web server.
 *        Registers URI handlers for the dashboard, live sensor API, and Wi-Fi manager configuration.
 * 
 * @return esp_err_t ESP_OK on success, error code otherwise
 */
esp_err_t start_web_server(void);

/**
 * @brief Stop the running HTTP web server.
 */
void stop_web_server(void);

#endif // MAIN_WEB_SERVER_H_
