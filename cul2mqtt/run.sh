#!/usr/bin/with-contenv bashio

set -euo pipefail

MQTT_URL="$(bashio::config 'mqtt_url')"
MQTT_USERNAME="$(bashio::config 'mqtt_username')"
MQTT_PASSWORD="$(bashio::config 'mqtt_password')"

if ! bashio::var.has_value "${MQTT_URL}"; then
    if ! bashio::services.available 'mqtt'; then
        bashio::exit.nok "Configure mqtt_url or install a Home Assistant MQTT service"
    fi
    MQTT_URL="mqtt://$(bashio::services mqtt 'host'):$(bashio::services mqtt 'port')"
    MQTT_USERNAME="$(bashio::services mqtt 'username')"
    MQTT_PASSWORD="$(bashio::services mqtt 'password')"
fi

args=(
    --cul-mode "$(bashio::config 'cul_mode')"
    --mqtt-url "${MQTT_URL}"
    --name "$(bashio::config 'instance_name')"
    --verbosity "$(bashio::config 'log_level')"
    --state-dir /data
)

HOST="$(bashio::config 'host')"
if bashio::var.has_value "${HOST}"; then
    args+=(--host "${HOST}" --port "$(bashio::config 'port')")
else
    args+=(--serialport "$(bashio::config 'serialport')")
    BAUDRATE="$(bashio::config 'baudrate')"
    if [ "${BAUDRATE}" -gt 0 ]; then
        args+=(--baudrate "${BAUDRATE}")
    fi
fi
if bashio::config.true 'coc'; then
    args+=(--coc)
fi
if bashio::config.true 'scc'; then
    args+=(--scc)
fi
if bashio::var.has_value "${MQTT_USERNAME}"; then
    args+=(--mqtt-username "${MQTT_USERNAME}")
fi
if bashio::var.has_value "${MQTT_PASSWORD}"; then
    args+=(--mqtt-password "${MQTT_PASSWORD}")
fi
if bashio::config.has_value 'fht_central'; then
    args+=(--fht-central "$(bashio::config 'fht_central')")
fi
FS20_DEVICES="$(bashio::config 'fs20_devices')"
if [ "${FS20_DEVICES}" != '[]' ]; then
    args+=(--fs20-devices "${FS20_DEVICES}")
fi
FHT8V_DEVICES="$(bashio::config 'fht8v_devices')"
if [ "${FHT8V_DEVICES}" != '[]' ]; then
    args+=(--fht8v-devices "${FHT8V_DEVICES}")
fi
if bashio::config.true 'fht8w_enabled'; then
    args+=(--fht8w-enabled)
fi
if bashio::config.has_value 'fht8w_address'; then
    args+=(--fht8w-address "$(bashio::config 'fht8w_address')")
fi
if bashio::config.true 'publish_raw'; then
    args+=(--publish-raw)
fi
if bashio::config.true 'raw_set'; then
    args+=(--raw-set)
fi
if ! bashio::config.true 'publish_events'; then
    args+=(--no-publish-events)
fi
if ! bashio::config.true 'offline_detection'; then
    args+=(--no-offline-detection)
fi
if ! bashio::config.true 'learn_intervals'; then
    args+=(--no-learn-intervals)
fi
if ! bashio::config.true 'json_payloads'; then
    args+=(--no-json-payloads)
fi
if ! bashio::config.true 'ha_discovery'; then
    args+=(--no-ha-discovery)
fi
if ! bashio::config.true 'maintenance'; then
    args+=(--no-maintenance)
fi
args+=(--ha-prefix "$(bashio::config 'ha_prefix')")
args+=(--stats-interval "$(bashio::config 'stats_interval')")
if bashio::config.has_value 'map_file'; then
    args+=(--map-file "$(bashio::config 'map_file')")
fi
if bashio::config.has_value 'mqtt_client_id_prefix'; then
    args+=(--mqtt-client-id-prefix "$(bashio::config 'mqtt_client_id_prefix')")
fi
if bashio::config.has_value 'mqtt_tls_ca'; then
    args+=(--mqtt-tls-ca "$(bashio::config 'mqtt_tls_ca')")
fi

bashio::log.info "Starting CUL2MQTT"
exec node /app/index.js "${args[@]}"
