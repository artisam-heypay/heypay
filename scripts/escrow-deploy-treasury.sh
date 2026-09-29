#!/usr/bin/env bash
# Deploy the escrow with the HeyPay treasury as admin: pnpm escrow:deploy:treasury
#
# Decrypts HEYPAY_TREASURY_SECRET_ENC from .env in memory (same envelope
# scheme as the app) and hands it to escrow-deploy.sh. The secret is never
# printed or written to disk. The deploy stops unless the decrypted key's
# public address equals HEYPAY_TREASURY_PUBLIC_KEY.
set -euo pipefail

cd "$(dirname "$0")/.."

TREASURY_PUBLIC_KEY="$(grep -E '^HEYPAY_TREASURY_PUBLIC_KEY=' .env | tail -1 | cut -d= -f2- | tr -d '"'"'"' ')"
if [[ -z "$TREASURY_PUBLIC_KEY" ]]; then
  echo "HEYPAY_TREASURY_PUBLIC_KEY is not set in .env" >&2
  exit 1
fi

# A plain assignment (not a command prefix) so `set -e` stops on a failed decrypt.
ESCROW_ADMIN="$(node --env-file=.env --conditions=react-server --import tsx --input-type=module -e '
const { decryptSecret } = await import(process.cwd() + "/src/server/crypto/envelope.ts");
process.stdout.write(decryptSecret(process.env.HEYPAY_TREASURY_SECRET_ENC ?? ""));
')"

ESCROW_ADMIN="$ESCROW_ADMIN" ESCROW_EXPECT_ADMIN="$TREASURY_PUBLIC_KEY" scripts/escrow-deploy.sh
