#!/usr/bin/env bash
# Run as root through an approved SSM command. It keeps the database value out
# of the command text, repository, shell history, and systemd unit.
set -euo pipefail

readonly PARAMETER_NAME="/sermonclip/pilot/worker/database-url"
readonly ENV_PATH="/etc/sermonclip/worker.env"
readonly TEMP_PATH="${ENV_PATH}.tmp.$$"

umask 0077
database_url="$(aws ssm get-parameter --name "$PARAMETER_NAME" --with-decryption --query 'Parameter.Value' --output text)"
if [[ -z "$database_url" || "$database_url" == "None" ]]; then
  echo "The required worker database setting is unavailable." >&2
  exit 1
fi

cat >"$TEMP_PATH" <<EOF
DATABASE_URL=$database_url
SERMON_STORAGE_ROOT=/var/lib/sermonclip/media
NODE_ENV=production
EOF
unset database_url
chown root:sermonclip "$TEMP_PATH"
chmod 0640 "$TEMP_PATH"
mv -f "$TEMP_PATH" "$ENV_PATH"

echo "Worker environment rendered from the protected parameter."
