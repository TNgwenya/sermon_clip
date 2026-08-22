#!/usr/bin/env bash
# Run only through an approved SSM command document on the dedicated pilot host.
# It installs a pinned public Git release and deliberately does not enable or
# start either worker service.
set -euo pipefail

readonly RELEASE_SHA="${1:?Usage: install-pilot-worker.sh <full-git-sha>}"
readonly RELEASE_ROOT="/opt/sermonclip/releases/${RELEASE_SHA}"
readonly REPOSITORY_URL="https://github.com/TNgwenya/sermon_clip.git"

if [[ ! -r /etc/os-release ]]; then
  echo "Unable to verify the host operating system." >&2
  exit 65
fi

# This production installer targets the dedicated Ubuntu 24.04 pilot host.
# FFmpeg stays on the distribution-supported package path. Node 22 is added
# from NodeSource's signed repository because the current application requires
# a newer runtime than Ubuntu 24.04's default package provides.
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
  echo "This installer is supported only on Ubuntu 24.04." >&2
  exit 65
fi

if ! [[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Refusing an unpinned release identifier." >&2
  exit 64
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gpg git ffmpeg python3 python3-pip awscli

install -d -m 0755 /etc/apt/keyrings
curl --fail --silent --show-error --location \
  https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor --yes --output /etc/apt/keyrings/nodesource.gpg
printf '%s\n' \
  'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main' \
  > /etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y --no-install-recommends nodejs

if ! node --version | grep -Eq '^v22\.'; then
  echo "Node 22 installation verification failed." >&2
  exit 65
fi

if ! id -u sermonclip >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/sermonclip --create-home \
    --shell /sbin/nologin sermonclip
fi

install -d -o sermonclip -g sermonclip -m 0750 \
  /var/lib/sermonclip /var/lib/sermonclip/media /var/log/sermonclip
install -d -o root -g root -m 0755 /opt/sermonclip/releases /etc/sermonclip

if [[ ! -d "$RELEASE_ROOT/.git" ]]; then
  git clone --no-checkout "$REPOSITORY_URL" "$RELEASE_ROOT"
fi

git -C "$RELEASE_ROOT" fetch --depth=1 origin "$RELEASE_SHA"
git -C "$RELEASE_ROOT" checkout --detach --force "$RELEASE_SHA"
git -C "$RELEASE_ROOT" diff --quiet

cd "$RELEASE_ROOT"
npm ci
npx prisma generate

install -o root -g root -m 0644 deploy/systemd/sermonclip-orchestration-worker.service \
  /etc/systemd/system/sermonclip-orchestration-worker.service
install -o root -g root -m 0644 deploy/systemd/sermonclip-media-worker.service \
  /etc/systemd/system/sermonclip-media-worker.service
ln -sfn "$RELEASE_ROOT" /opt/sermonclip/current
systemctl daemon-reload
systemctl disable --now sermonclip-orchestration-worker.service || true
systemctl disable --now sermonclip-media-worker.service || true

echo "Pinned release installed with both workers disabled: $RELEASE_SHA"
