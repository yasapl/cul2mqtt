ARG BUILD_FROM=ghcr.io/home-assistant/base:latest
FROM ${BUILD_FROM}

# Builds the app from the local checkout; the build context is the repository root:
#   docker build -f cul2mqtt/Dockerfile -t cul2mqtt-ha .

LABEL \
    io.hass.version="0.2.23" \
    io.hass.type="app" \
    io.hass.arch="aarch64|amd64|armv7|armhf"

# udevadm: serialport lists ports through it (--discover, --serialport auto)
RUN apk add --no-cache nodejs npm eudev

WORKDIR /app

COPY package.json package-lock.json ./
# serialport 13 ships prebuilt binaries (N-API, musl included), no toolchain needed
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY index.js config.js example-map.json map.schema.json ./
COPY lib/ ./lib/
COPY cul2mqtt/run.sh /run.sh

RUN chmod a+x /run.sh

CMD ["/run.sh"]
