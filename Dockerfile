FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
# serialport 13 ships prebuilt binaries (N-API), no toolchain needed
RUN npm ci --omit=dev && npm cache clean --force

COPY index.js config.js example-map.json ./
COPY lib/ ./lib/

# learned offline intervals, FS20 timer values, FHT initialisation markers
RUN mkdir /data && chown node:node /data
VOLUME /data

ENV NODE_ENV=production \
    CUL2MQTT_MQTT_URL=mqtt://localhost \
    CUL2MQTT_NAME=cul \
    CUL2MQTT_SERIALPORT=/dev/ttyACM0 \
    CUL2MQTT_STATE_DIR=/data \
    CUL2MQTT_VERBOSITY=info

# run with: --device /dev/ttyACM0 --group-add $(stat -c %g /dev/ttyACM0)
USER node

ENTRYPOINT ["node", "index.js"]
