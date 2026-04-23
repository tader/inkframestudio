ARG BUILD_FROM
FROM $BUILD_FROM

RUN apk add --no-cache nodejs npm cargo rust freetype-dev harfbuzz-dev pkgconf build-base

WORKDIR /app
COPY package.json tsconfig.json vitest.config.ts ./
COPY scripts ./scripts
COPY packages ./packages
COPY rust ./rust
COPY docs ./docs
RUN npm install
RUN npm run build

ENV PORT=8099
COPY addon/run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
