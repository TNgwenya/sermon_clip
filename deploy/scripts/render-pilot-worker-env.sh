#!/usr/bin/env bash
# Run as root through an approved SSM command. It keeps the database value out
# of the command text, repository, shell history, and systemd unit.
set -euo pipefail

readonly ENV_PATH="/etc/sermonclip/worker.env"
readonly TEMP_PATH="${ENV_PATH}.tmp.$$"

umask 0077
read_parameter() {
  local name="$1"
  local value
  value="$(aws ssm get-parameter --name "$name" --with-decryption --query 'Parameter.Value' --output text)"
  if [[ -z "$value" || "$value" == "None" || "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    echo "A required protected worker setting is unavailable or malformed." >&2
    exit 1
  fi
  printf '%s' "$value"
}

read_optional_parameter() {
  local name="$1"
  local value
  if ! value="$(aws ssm get-parameter --name "$name" --with-decryption --query 'Parameter.Value' --output text 2>/dev/null)"; then
    return 0
  fi
  if [[ -z "$value" || "$value" == "None" || "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    echo "An optional protected worker setting is malformed." >&2
    exit 1
  fi
  printf '%s' "$value"
}

write_env_line() {
  local name="$1"
  local value="$2"
  [[ -n "$value" ]] || return 0
  printf '%s=%s\n' "$name" "$value" >>"$TEMP_PATH"
}

# Required processing credentials. Values are fetched only on the host and are
# never included in a command, a unit file, a repository file, or command output.
database_url="$(read_parameter "/sermonclip/pilot/worker/database-url")"
openai_api_key="$(read_parameter "/sermonclip/pilot/worker/openai-api-key")"
r2_access_key_id="$(read_parameter "/sermonclip/pilot/worker/r2-access-key-id")"
r2_secret_access_key="$(read_parameter "/sermonclip/pilot/worker/r2-secret-access-key")"
cloudflare_stream_api_token="$(read_parameter "/sermonclip/pilot/worker/cloudflare-stream-api-token")"

# Non-secret deployment values are separately parameterised so that a release
# never guesses a production bucket, public origin, or provider account.
cloudflare_account_id="$(read_optional_parameter "/sermonclip/pilot/worker/cloudflare-account-id")"
r2_bucket="$(read_optional_parameter "/sermonclip/pilot/worker/r2-bucket")"
r2_public_base_url="$(read_optional_parameter "/sermonclip/pilot/worker/r2-public-base-url")"
source_media_s3_bucket="$(read_optional_parameter "/sermonclip/pilot/worker/source-media-s3-bucket")"

: >"$TEMP_PATH"
write_env_line "DATABASE_URL" "$database_url"
write_env_line "OPENAI_API_KEY" "$openai_api_key"
write_env_line "R2_ACCESS_KEY_ID" "$r2_access_key_id"
write_env_line "R2_SECRET_ACCESS_KEY" "$r2_secret_access_key"
write_env_line "CLOUDFLARE_STREAM_API_TOKEN" "$cloudflare_stream_api_token"
write_env_line "CLOUDFLARE_ACCOUNT_ID" "$cloudflare_account_id"
write_env_line "R2_ACCOUNT_ID" "$cloudflare_account_id"
write_env_line "R2_BUCKET" "$r2_bucket"
write_env_line "R2_PUBLIC_BASE_URL" "$r2_public_base_url"
write_env_line "SOURCE_MEDIA_S3_BUCKET" "$source_media_s3_bucket"
write_env_line "SOURCE_MEDIA_S3_REGION" "eu-central-1"
write_env_line "SOURCE_MEDIA_S3_KEY_PREFIX" "sermon-sources"
write_env_line "SERMON_STORAGE_ROOT" "/var/lib/sermonclip/media"
write_env_line "NODE_ENV" "production"
# A release cannot accidentally begin polling the live provider. A deliberate
# runtime change is required to set this to true after a supervised pilot gate.
write_env_line "LIVE_INTAKE_WORKER_ENABLED" "false"
unset database_url openai_api_key r2_access_key_id r2_secret_access_key cloudflare_stream_api_token cloudflare_account_id r2_bucket r2_public_base_url source_media_s3_bucket
chown root:sermonclip "$TEMP_PATH"
chmod 0640 "$TEMP_PATH"
mv -f "$TEMP_PATH" "$ENV_PATH"

echo "Worker environment rendered from protected parameters with live intake disabled."
