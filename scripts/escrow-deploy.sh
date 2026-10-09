#!/usr/bin/env bash
# Build, deploy and initialize the HeyPay settlement escrow on a Stellar network.
#
# Usage:
#   ESCROW_ADMIN=<identity|S...> scripts/escrow-deploy.sh
#
# Environment (all optional except where noted):
#   ESCROW_NETWORK          Network name known to the Stellar CLI. Default: testnet.
#   ESCROW_DEPLOYER         CLI identity that pays for the upload and deploy.
#                           Default: heypay-deployer (created and funded with
#                           Friendbot on testnet if missing).
#   ESCROW_ADMIN            Identity name or secret key of the escrow admin. It
#                           signs initialize() and later release()/refund(), and
#                           receives released funds, so it should be the HeyPay
#                           treasury. Default: the deployer.
#   ESCROW_ASSET            Asset the escrow holds: native, or CODE:ISSUER for an
#                           issued asset such as USDC. One escrow holds one
#                           asset, so each asset needs its own deploy. The admin
#                           must already trust an issued asset, or release()
#                           cannot pay it. Default: native.
#   ESCROW_TOKEN            Stellar Asset Contract the escrow holds, when it is
#                           not the one for ESCROW_ASSET.
#   ESCROW_TIMEOUT_LEDGERS  If set, calls set_timeout() with this many ledgers.
#
# Prints the new contract ID and its Stellar Expert link. Set ESCROW_CONTRACT_ID
# (native) or ESCROW_CONTRACT_ID_<CODE> (issued asset) to that ID in .env.
set -euo pipefail

cd "$(dirname "$0")/.."

NETWORK="${ESCROW_NETWORK:-testnet}"
DEPLOYER="${ESCROW_DEPLOYER:-heypay-deployer}"
ASSET="${ESCROW_ASSET:-native}"
WASM="target/wasm32v1-none/release/escrow.wasm"

log() { printf '==> %s\n' "$*" >&2; }

# An ESCROW_ADMIN that is set but empty usually means the command that was
# meant to produce it failed. Stop instead of silently using the deployer.
if [[ -n "${ESCROW_ADMIN+set}" && -z "$ESCROW_ADMIN" ]]; then
  echo "ESCROW_ADMIN is set but empty; refusing to fall back to the deployer." >&2
  exit 1
fi
ADMIN="${ESCROW_ADMIN:-$DEPLOYER}"

# Optional guard: the admin public key this deploy must end up with.
if [[ -n "${ESCROW_EXPECT_ADMIN:-}" && "$(stellar keys address "$ADMIN")" != "$ESCROW_EXPECT_ADMIN" ]]; then
  echo "Admin key does not match ESCROW_EXPECT_ADMIN=$ESCROW_EXPECT_ADMIN" >&2
  exit 1
fi

if ! stellar keys address "$DEPLOYER" >/dev/null 2>&1; then
  if [[ "$NETWORK" != "testnet" ]]; then
    echo "Deployer identity '$DEPLOYER' does not exist; create and fund it first." >&2
    exit 1
  fi
  log "Creating and funding deployer identity '$DEPLOYER' with Friendbot"
  stellar keys generate "$DEPLOYER" --network "$NETWORK" --fund >/dev/null
fi

# `stellar keys address` accepts an identity name or a secret key, so the admin
# public key can be shown without ever printing the secret.
ADMIN_ADDRESS="$(stellar keys address "$ADMIN")"
TOKEN="${ESCROW_TOKEN:-$(stellar contract id asset --asset "$ASSET" --network "$NETWORK")}"

log "Building the escrow contract"
stellar contract build --package escrow >/dev/null

log "Deploying $WASM to $NETWORK"
CONTRACT_ID="$(stellar contract deploy \
  --wasm "$WASM" \
  --source-account "$DEPLOYER" \
  --network "$NETWORK")"

# Initialize straight away so no one else can claim the admin role first.
log "Initializing: admin=$ADMIN_ADDRESS token=$TOKEN"
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$ADMIN" \
  --network "$NETWORK" \
  -- initialize --admin "$ADMIN_ADDRESS" --token "$TOKEN" >/dev/null

if [[ -n "${ESCROW_TIMEOUT_LEDGERS:-}" ]]; then
  log "Setting the payer self-refund timeout to $ESCROW_TIMEOUT_LEDGERS ledgers"
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source-account "$ADMIN" \
    --network "$NETWORK" \
    -- set_timeout --ledgers "$ESCROW_TIMEOUT_LEDGERS" >/dev/null
fi

log "Checking the deployed admin"
DEPLOYED_ADMIN="$(stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$DEPLOYER" \
  --network "$NETWORK" \
  --send=no \
  -- admin | tr -d '"')"
if [[ "$DEPLOYED_ADMIN" != "$ADMIN_ADDRESS" ]]; then
  echo "Deployed admin $DEPLOYED_ADMIN does not match $ADMIN_ADDRESS" >&2
  exit 1
fi

EXPERT_NETWORK="$NETWORK"
[[ "$NETWORK" == "mainnet" ]] && EXPERT_NETWORK="public"

# The app looks an issued asset's escrow up by its code: ESCROW_CONTRACT_ID_USDC.
ENV_KEY="ESCROW_CONTRACT_ID"
[[ "$ASSET" != "native" ]] && ENV_KEY="ESCROW_CONTRACT_ID_${ASSET%%:*}"

echo "$ENV_KEY=$CONTRACT_ID"
echo "https://stellar.expert/explorer/$EXPERT_NETWORK/contract/$CONTRACT_ID"
