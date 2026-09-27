FROM ghcr.io/home-assistant/base:latest

ARG CUL2MQTT_REF=2bc53076d51b7bf797b923b1cd16952ac82ed5ca

LABEL \
    io.hass.version="0.2.3" \
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
