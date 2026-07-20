#!/usr/bin/env sh
#
# Build an installable plugin ZIP the idiomatic Shopware way (ADR 0007).
#
# shopware-cli compiles the storefront asset with Shopware's own build, then packs
# src + the built dist into a ZIP, honouring .shopware-extension.yml (pack.excludes,
# npm_strict). CI uses the equivalent `shopware/github-actions/build-zip` action.
set -eu

OUTPUT_DIR="dist"

if ! command -v shopware-cli >/dev/null 2>&1; then
  echo "! shopware-cli not found. Install it: https://sw-cli.fos.gg/install/" >&2
  exit 1
fi

# --disable-git packs the working tree as-is (local build). CI packs the committed
# commit via --git-commit and adds --release.
shopware-cli extension zip . --disable-git --output-directory "$OUTPUT_DIR"

echo "$OUTPUT_DIR/SwagWebMcp.zip"
