#!/usr/bin/env bash
# Regenerate the TypeScript bindings for the escrow contract from its WASM.
#
# The generator (`stellar-js generate`, shipped with @stellar/stellar-sdk)
# emits a standalone npm package. Only its src/ is kept, vendored into
# src/server/stellar/escrow-bindings/, so the app imports it like any other
# module with no extra workspace package to build. Run after any contract
# interface change: pnpm contract:bindings
set -euo pipefail

cd "$(dirname "$0")/.."

WASM="target/wasm32v1-none/release/escrow.wasm"
DEST="src/server/stellar/escrow-bindings"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

stellar contract build --package escrow >/dev/null
pnpm exec stellar-js generate --wasm "$WASM" --contract-name escrow --output-dir "$TMP/escrow" >/dev/null

rm -rf "$DEST"
mkdir -p "$DEST"
cp "$TMP"/escrow/src/*.ts "$DEST"/

# The generator predates `noImplicitOverride` (tsconfig.json); add the
# modifiers it omits so `pnpm typecheck` passes on the untouched output.
sed -i.bak \
  -e 's/constructor(public readonly options/constructor(public override readonly options/' \
  -e 's/^\( *\)static deploy</\1static override deploy</' \
  "$DEST/client.ts"
rm -f "$DEST/client.ts.bak"
echo "Bindings written to $DEST"
