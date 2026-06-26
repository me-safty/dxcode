FROM debian:bookworm-slim AS runtime

ARG GITHUB_REPOSITORY
ARG RELEASE_TAG=v0.0.24
ARG DEB_ARCH=amd64

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    ca-certificates \
    curl \
    git \
    adduser \
    util-linux \
  && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get install --yes --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --system --home-dir /var/lib/morecode --shell /usr/sbin/nologin morecode \
  && install -d -m 0750 -o morecode -g morecode \
    /var/lib/morecode \
    /var/lib/morecode/state \
    /var/lib/morecode/workspace \
    /etc/morecode

RUN apt-get update \
  && apt-get install --yes --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/* \
  && set -euo pipefail \
  && : "${GITHUB_REPOSITORY:?Set GITHUB_REPOSITORY to owner/repo for the release host}" \
  && release_json="$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/tags/${RELEASE_TAG}")" \
  && deb_asset="$(printf '%s' "$release_json" | python3 -c 'import json, os, sys; arch=os.environ["DEB_ARCH"]; data=json.load(sys.stdin); matches=[asset["name"] for asset in data.get("assets", []) if asset["name"].endswith(f"_{arch}.deb")]; print(matches[0] if matches else "")')" \
  && if [[ -z "$deb_asset" ]]; then \
    echo "No morecode-headless .deb asset found for ${DEB_ARCH} on release ${RELEASE_TAG}." >&2; \
    exit 1; \
  fi \
  && curl -fsSL -o /tmp/morecode-headless.deb \
    "https://github.com/${GITHUB_REPOSITORY}/releases/download/${RELEASE_TAG}/${deb_asset}"

RUN apt-get update \
  && apt-get install --yes --no-install-recommends systemd \
  && dpkg -i /tmp/morecode-headless.deb \
  && rm /tmp/morecode-headless.deb \
  && rm -rf /var/lib/apt/lists/*

COPY morecode.env /etc/morecode/morecode.env
COPY fix-node-modules-links.sh /usr/local/bin/fix-node-modules-links.sh
COPY entrypoint.sh /usr/local/bin/morecode-docker-entrypoint.sh
RUN chmod 0640 /etc/morecode/morecode.env \
  && chown root:morecode /etc/morecode/morecode.env \
  && chmod 0755 /usr/local/bin/fix-node-modules-links.sh /usr/local/bin/morecode-docker-entrypoint.sh \
  && /usr/local/bin/fix-node-modules-links.sh /opt/morecode/node_modules

EXPOSE 3773

ENTRYPOINT ["/usr/local/bin/morecode-docker-entrypoint.sh"]