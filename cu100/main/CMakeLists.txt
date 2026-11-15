idf_component_register(SRCS "mqtt_manager.c" "main.c"
                            "ads1115.c"
                            "wifi_manager.c"
                            "web_server.c"
                            "ds18b20_manager.c"
                       INCLUDE_DIRS "include"
                       PRIV_REQUIRES esp_http_server nvs_flash esp_wifi esp_event esp_netif lwip esp_driver_i2c esp_driver_gpio mqtt onewire_bus ds18b20)
