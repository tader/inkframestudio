ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.21
FROM $BUILD_FROM
ARG BUILD_ARCH=amd64
ARG BUILD_VERSION=dev

LABEL \
  io.hass.name="InkFrame Studio" \
  io.hass.description="Ingress-served editor and renderer for tri-color e-paper displays" \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="addon" \
  io.hass.arch="${BUILD_ARCH}" \
  org.opencontainers.image.title="InkFrame Studio" \
  org.opencontainers.image.description="Ingress-served editor and renderer for tri-color e-paper displays" \
  org.opencontainers.image.source="https://github.com/tader/inkframestudio" \
  org.opencontainers.image.version="${BUILD_VERSION}"

ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
ENV PATH=/usr/local/cargo/bin:$PATH

RUN apk add --no-cache nodejs npm curl freetype-dev harfbuzz-dev pkgconf build-base \
  && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain stable \
  && rustc --version \
  && cargo --version

WORKDIR /app
COPY package.json package-lock.json tsconfig.json vitest.config.ts ./
COPY scripts ./scripts
COPY packages ./packages
COPY rust ./rust
COPY data ./data
COPY docs ./docs
RUN npm ci
RUN npm run build

ENV PORT=8099
COPY addon/run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
