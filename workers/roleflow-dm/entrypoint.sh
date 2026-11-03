#!/bin/sh
# Prepares the per-client volume and starts the supervised processes.
# This script does not enable live sending.
set -eu
mkdir -p /data/profile /data/secrets /data/state /data/logs /run/roleflow \
  /etc/chromium/policies/managed /etc/opt/chrome/policies/managed
chown chromium:roleflow /data/profile
chmod 700 /data/profile
chown agent:roleflow /data/secrets /data/state /data/logs /run/roleflow
chmod 700 /data/secrets
chmod 750 /run/roleflow
if [ -f /etc/roleflow/bootstrap ]; then
  chown agent:roleflow /etc/roleflow/bootstrap
  chmod 600 /etc/roleflow/bootstrap
fi
cp /opt/roleflow/workers/roleflow-dm/image/chromium-policy.json /etc/chromium/policies/managed/roleflow.json
cp /opt/roleflow/workers/roleflow-dm/image/chromium-policy.json /etc/opt/chrome/policies/managed/roleflow.json
if [ "${ROLEFLOW_APPLY_NFT:-}" = "1" ]; then
  export CHROMIUM_UID="$(id -u chromium)"
  export AGENT_UID="$(id -u agent)"
  if [ -n "${ROLEFLOW_BOOTSTRAP_FILE:-}" ]; then
    /usr/local/bin/node /opt/roleflow/workers/roleflow-dm/brain-nft.mjs \
      --write /etc/roleflow/nftables.conf \
      --bootstrap "$ROLEFLOW_BOOTSTRAP_FILE"
  else
    /usr/local/bin/node /opt/roleflow/workers/roleflow-dm/brain-nft.mjs \
      --write /etc/roleflow/nftables.conf
  fi
  nft -f /etc/roleflow/nftables.conf || echo "nftables was not applied" >&2
  (
    while [ ! -s /run/roleflow/proxy.nft ]; do sleep 1; done
    read -r ip port < /run/roleflow/proxy.nft
    nft add element inet roleflow proxy_v4 "{ $ip }"
    nft add element inet roleflow proxy_port "{ $port }"
  ) &
fi
exec /usr/bin/supervisord -c /opt/roleflow/workers/roleflow-dm/supervisord.conf
