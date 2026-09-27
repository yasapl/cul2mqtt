#!/usr/bin/with-contenv bashio

set -euo pipefail

MAXCUL_HOST="$(bashio::config 'maxcul_host')"
if ! bashio::var.has_value "${MAXCUL_HOST}"; then
    bashio::exit.nok "maxcul_host must be configured"
fi

MQTT_HOST="$(bashio::services mqtt 'host')"
MQTT_PORT="$(bashio::services mqtt 'port')"
MQTT_USERNAME="$(bashio::services mqtt 'username')"
MQTT_PASSWORD="$(bashio::services mqtt 'password')"

args=(
    --host "${MAXCUL_HOST}"
    --port "$(bashio::config 'maxcul_port')"
    --cul-mode SlowRF
    --mqtt-url "mqtt://${MQTT_HOST}:${MQTT_PORT}"
    --name "$(bashio::config 'instance_name')"
    --verbosity "$(bashio::config 'log_level')"
)

if bashio::var.has_value "${MQTT_USERNAME}"; then
    args+=(--mqtt-username "${MQTT_USERNAME}")
fi
if bashio::var.has_value "${MQTT_PASSWORD}"; then
    args+=(--mqtt-password "${MQTT_PASSWORD}")
fi
if bashio::config.has_value 'fht_central'; then
    args+=(--fht-central "$(bashio::config 'fht_central')")
fi
if bashio::config.true 'publish_raw'; then
    args+=(--publish-raw)
fi
if ! bashio::config.true 'publish_events'; then
    args+=(--no-publish-events)
fi
if ! bashio::config.true 'offline_detection'; then
    args+=(--no-offline-detection)
fi

bashio::log.info "Starting CUL2MQTT for ${MAXCUL_HOST}"
exec node /app/index.js "${args[@]}"
