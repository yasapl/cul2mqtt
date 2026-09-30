FROM ghcr.io/home-assistant/base:latest

ARG CUL2MQTT_REF=2710132b1288a2c7fbf2676d9ba96c29f570aea1

LABEL \
    io.hass.version="0.2.26" \
    io.hass.type="app" \
    io.hass.arch="aarch64|amd64|armv7|armhf"

RUN apk add --no-cache git nodejs npm

WORKDIR /app

RUN git clone https://github.com/yasapl/cul2mqtt.git . \
    && git fetch --depth 1 origin "${CUL2MQTT_REF}" \
    && git checkout --detach FETCH_HEAD \
    && npm ci --omit=dev --no-audit --no-fund

COPY run.sh /run.sh

RUN chmod a+x /run.sh

CMD ["/run.sh"]
