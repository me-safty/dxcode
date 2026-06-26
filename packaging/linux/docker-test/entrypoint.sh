#!/bin/sh
set -eu

if [ -f /etc/morecode/morecode.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /etc/morecode/morecode.env
  set +a
fi

export MORECODE_T3CODE_HOST="${MORECODE_T3CODE_HOST:-0.0.0.0}"
export MORECODE_T3CODE_PORT="${MORECODE_T3CODE_PORT:-3773}"
export HOME="${HOME:-/var/lib/morecode}"

/usr/local/bin/fix-node-modules-links.sh /opt/morecode/node_modules

exec runuser -u morecode -- env HOME="$HOME" /usr/bin/morecode serve