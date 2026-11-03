#!/bin/sh
# Chromium for one client. The proxy URL is read from a root-group file and is not printed.
set +x
set -eu
umask 077
while [ ! -s /run/roleflow/proxy.url ]; do
  sleep 2
done
PROXY=$(cat /run/roleflow/proxy.url)
CHROME=$(find /opt/roleflow/browsers -type f -name chrome -path '*chromium*' | head -n 1)
if [ -z "$CHROME" ]; then
  echo "browser binary missing" >&2
  exit 1
fi
exec "$CHROME" \
  --user-data-dir=/data/profile \
  --proxy-server="$PROXY" \
  --force-webrtc-ip-handling-policy=disable_non_proxied_udp \
  --disable-features=PasswordManagerOnboarding,AutofillServerCommunication \
  --disable-sync \
  --no-first-run \
  --no-default-browser-check \
  --password-store=basic \
  --disable-save-password-bubble \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --no-sandbox \
  --disable-dev-shm-usage \
  about:blank
