#!/bin/sh
# BusyBox wget ignores no_proxy in this image. Only its exact loopback health
# request uses a direct connection; all other requests keep the normal proxy.
for arg in "$@"; do
  case "$arg" in
    http://127.0.0.1:9999/health) exec /usr/bin/wget -Y off "$@" ;;
  esac
done
exec /usr/bin/wget "$@"
