#!/usr/bin/env bash
set -euo pipefail

cloudflare_api_token=""
rocom_api_key=""
serverchan_sendkey=""
trigger_token=""
configure_secrets=0
non_interactive=0
skip_checks=0
skip_token_verify=0
dry_run=0

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
worker_dir="${repo_root}/cf-workers"

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-cf-worker.sh [options]

Interactive by default. Common options:
  --configure-secrets           Prompt for Worker secrets and upload them
  --non-interactive             Do not prompt; require env vars or CLI values
  --cloudflare-api-token TOKEN  Cloudflare API token
  --rocom-api-key KEY           ROCOM_API_KEY secret
  --serverchan-sendkey KEY      SERVERCHAN_SENDKEY secret
  --trigger-token TOKEN         Optional TRIGGER_TOKEN secret
  --skip-checks                 Skip npm test, tsc, and _worker.js sync check
  --skip-token-verify           Skip Cloudflare token verification
  --dry-run                     Build and dry-run deploy without publishing
  -h, --help                    Show this help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --configure-secrets) configure_secrets=1 ;;
    --non-interactive) non_interactive=1 ;;
    --cloudflare-api-token) shift; cloudflare_api_token="${1:-}" ;;
    --rocom-api-key) shift; rocom_api_key="${1:-}" ;;
    --serverchan-sendkey) shift; serverchan_sendkey="${1:-}" ;;
    --trigger-token) shift; trigger_token="${1:-}" ;;
    --skip-checks) skip_checks=1 ;;
    --skip-token-verify) skip_token_verify=1 ;;
    --dry-run) dry_run=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

step() {
  printf '\n==> %s\n' "$1"
}

ask_yes_no() {
  prompt="$1"
  default="${2:-yes}"
  if [ "$default" = "yes" ]; then
    suffix="[Y/n]"
  else
    suffix="[y/N]"
  fi
  while true; do
    printf '%s %s ' "$prompt" "$suffix" >&2
    IFS= read -r answer
    answer="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
    if [ -z "$answer" ]; then
      [ "$default" = "yes" ]
      return
    fi
    case "$answer" in
      y|yes) return 0 ;;
      n|no) return 1 ;;
      *) echo "Please answer y or n." >&2 ;;
    esac
  done
}

read_secret() {
  prompt="$1"
  optional="${2:-no}"
  printf '%s: ' "$prompt" >&2
  IFS= read -r -s value
  printf '\n' >&2
  if [ "$optional" != "yes" ] && [ -z "$value" ]; then
    echo "$prompt cannot be empty." >&2
    exit 1
  fi
  printf '%s' "$value"
}

run_cmd() {
  "$@"
}

set_worker_secret() {
  name="$1"
  value="$2"
  if [ -z "$value" ]; then
    return
  fi
  step "Setting Worker secret ${name}"
  printf '%s' "$value" | npx wrangler secret put "$name"
}

extract_worker_host() {
  sed -nE 's#.*https://([A-Za-z0-9.-]+\.workers\.dev).*#\1#p' "$1" | head -n 1
}

if [ ! -d "$worker_dir" ]; then
  echo "Cannot find cf-workers directory: $worker_dir" >&2
  exit 1
fi

had_token=0
previous_token=""
token_was_set_by_script=0
if [ "${CLOUDFLARE_API_TOKEN+x}" = "x" ]; then
  had_token=1
  previous_token="$CLOUDFLARE_API_TOKEN"
fi

cleanup() {
  if [ "$had_token" -eq 1 ]; then
    export CLOUDFLARE_API_TOKEN="$previous_token"
  elif [ "$token_was_set_by_script" -eq 1 ]; then
    unset CLOUDFLARE_API_TOKEN
  fi
}
trap cleanup EXIT

has_secret_input=0
if [ -n "$rocom_api_key" ] || [ -n "$serverchan_sendkey" ] || [ -n "$trigger_token" ]; then
  has_secret_input=1
fi

if [ "$non_interactive" -eq 0 ]; then
  printf '\nCloudflare Worker interactive deployment\n'
  printf 'This script deploys cf-workers with Wrangler and verifies the root health endpoint.\n'
  if [ "$skip_checks" -eq 0 ]; then
    if ! ask_yes_no "Run tests and checks before deploy?" yes; then
      skip_checks=1
    fi
  fi
  if [ "$dry_run" -eq 0 ] && [ "$configure_secrets" -eq 0 ] && [ "$has_secret_input" -eq 0 ]; then
    if ask_yes_no "Configure Worker secrets now?" yes; then
      configure_secrets=1
    fi
  fi
fi

if [ "$dry_run" -eq 0 ]; then
  if [ -n "$cloudflare_api_token" ]; then
    export CLOUDFLARE_API_TOKEN="$cloudflare_api_token"
    token_was_set_by_script=1
  elif [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    if [ "$non_interactive" -eq 1 ]; then
      echo "CLOUDFLARE_API_TOKEN is required in non-interactive mode." >&2
      exit 1
    fi
    export CLOUDFLARE_API_TOKEN="$(read_secret "Cloudflare API token" no)"
    token_was_set_by_script=1
  fi

  if [ "$skip_token_verify" -eq 0 ]; then
    step "Verifying Cloudflare API token"
    curl -fsS \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      "https://api.cloudflare.com/client/v4/user/tokens/verify" |
      grep -q '"success":true'
  fi
fi

cd "$worker_dir"

step "Installing Worker dependencies: npm ci"
run_cmd npm ci

if [ "$skip_checks" -eq 0 ]; then
  step "Running Worker tests: npm test"
  run_cmd npm test

  step "Running TypeScript check: npx tsc --noEmit"
  run_cmd npx tsc --noEmit

  step "Checking generated _worker.js: npm run check:worker"
  run_cmd npm run check:worker
fi

if [ "$dry_run" -eq 1 ] && { [ "$configure_secrets" -eq 1 ] || [ "$has_secret_input" -eq 1 ]; }; then
  echo "Dry run skips Worker secret configuration." >&2
fi

if [ "$dry_run" -eq 0 ] && { [ "$configure_secrets" -eq 1 ] || [ "$has_secret_input" -eq 1 ]; }; then
  if [ -z "$rocom_api_key" ] && [ "$configure_secrets" -eq 1 ]; then
    if [ "$non_interactive" -eq 1 ]; then
      echo "ROCOM_API_KEY is required when --configure-secrets is used in non-interactive mode." >&2
      exit 1
    fi
    rocom_api_key="$(read_secret "ROCOM_API_KEY" no)"
  fi
  if [ -z "$serverchan_sendkey" ] && [ "$configure_secrets" -eq 1 ] && [ "$non_interactive" -eq 0 ]; then
    serverchan_sendkey="$(read_secret "SERVERCHAN_SENDKEY (empty to skip)" yes)"
  fi
  if [ -z "$trigger_token" ] && [ "$configure_secrets" -eq 1 ] && [ "$non_interactive" -eq 0 ]; then
    trigger_token="$(read_secret "TRIGGER_TOKEN (empty to skip)" yes)"
  fi

  set_worker_secret "ROCOM_API_KEY" "$rocom_api_key"
  set_worker_secret "SERVERCHAN_SENDKEY" "$serverchan_sendkey"
  set_worker_secret "TRIGGER_TOKEN" "$trigger_token"
fi

if [ "$dry_run" -eq 1 ]; then
  step "Running Wrangler dry run: wrangler deploy --dry-run"
  run_cmd npx wrangler deploy --dry-run --outdir dist
  printf '\nDry run finished. No Worker was deployed.\n'
  exit 0
fi

step "Deploying Cloudflare Worker: wrangler deploy"
deploy_log="$(mktemp)"
npx wrangler deploy 2>&1 | tee "$deploy_log"
worker_host="$(extract_worker_host "$deploy_log")"
rm -f "$deploy_log"

if [ -n "$worker_host" ]; then
  step "Checking Worker health"
  curl -fsS "https://${worker_host}/" | grep -q '"ok":true'
  printf '\nDeployed successfully: https://%s/\n' "$worker_host"
else
  printf '\nDeployed successfully. Wrangler did not print a workers.dev URL to verify.\n'
fi
