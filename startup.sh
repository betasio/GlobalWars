#!/bin/bash
set -e
# Start supervisord
if [ "$DOMAIN" = globalwars.dev ] && [ "$SUBDOMAIN" != main ]; then
    exec timeout 18h /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
else
    exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
fi
