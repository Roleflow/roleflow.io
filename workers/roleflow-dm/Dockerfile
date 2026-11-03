# roleflow-outreacher
# Platforms: linux/amd64 and linux/arm64 (see build-image.sh).
# Live sending is not enabled in this image.

FROM ubuntu:24.04

ARG IMAGE_VERSION=dev
ARG NODE_VERSION=22.21.0
ENV DEBIAN_FRONTEND=noninteractive \
    ROLEFLOW_IMAGE_VERSION=${IMAGE_VERSION} \
    PLAYWRIGHT_BROWSERS_PATH=/opt/roleflow/browsers \
    PLAYWRIGHT_SKIP_BROWSER_GC=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils \
      xvfb x11vnc novnc websockify \
      supervisor nftables openssl \
      fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && arch="$(dpkg --print-architecture)" \
    && case "$arch" in amd64) narch=x64 ;; arm64) narch=arm64 ;; *) echo "unsupported $arch" >&2; exit 1 ;; esac \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${narch}.tar.gz" \
      | tar -xz -C /usr/local --strip-components=1

RUN groupadd --system roleflow \
    && useradd --system --create-home --gid roleflow --shell /usr/sbin/nologin agent \
    && useradd --system --create-home --gid roleflow --shell /usr/sbin/nologin chromium

WORKDIR /opt/roleflow
COPY workers/roleflow-dm/package.json /opt/roleflow/package.json
RUN npm install --omit=dev \
    && npx --yes playwright@1.64.1 install --with-deps chromium

COPY workers/roleflow-dm /opt/roleflow/workers/roleflow-dm
COPY acquire/auto-dm.js /opt/roleflow/acquire/auto-dm.js
RUN chmod 755 /opt/roleflow/workers/roleflow-dm/entrypoint.sh \
      /opt/roleflow/workers/roleflow-dm/image/chromium-launch.sh \
      /opt/roleflow/workers/roleflow-dm/build-image.sh \
    && mkdir -p /etc/chromium/policies/managed /etc/opt/chrome/policies/managed /etc/roleflow \
    && cp /opt/roleflow/workers/roleflow-dm/image/chromium-policy.json /etc/chromium/policies/managed/roleflow.json \
    && cp /opt/roleflow/workers/roleflow-dm/image/chromium-policy.json /etc/opt/chrome/policies/managed/roleflow.json

LABEL org.opencontainers.image.title="roleflow-outreacher" \
      org.opencontainers.image.version="${IMAGE_VERSION}"

VOLUME ["/data"]
ENTRYPOINT ["/opt/roleflow/workers/roleflow-dm/entrypoint.sh"]
