#!/bin/sh
# Start the session manager in the background, then xrdp in the foreground (the container's process).
set -e
rm -f /var/run/xrdp/*.pid /run/xrdp/*.pid
mkdir -p /var/run/xrdp
xrdp-sesman
exec xrdp --nodaemon
