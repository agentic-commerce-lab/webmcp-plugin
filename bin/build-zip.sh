#!/usr/bin/env sh
set -eu

PLUGIN_NAME="SwagWebMcp"
ZIP_NAME="SwagWebMcp.zip"
DIST_DIR="dist"
WORK_DIR="$DIST_DIR/package"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"

bun install --frozen-lockfile
bun run check
bun run build

rm -rf "$WORK_DIR" "$ZIP_PATH"
mkdir -p "$WORK_DIR"
mkdir "$WORK_DIR/$PLUGIN_NAME"

cp composer.json "$WORK_DIR/$PLUGIN_NAME/"
if [ -f composer.lock ]; then
  cp composer.lock "$WORK_DIR/$PLUGIN_NAME/"
fi
cp LICENSE "$WORK_DIR/$PLUGIN_NAME/"
cp README.md "$WORK_DIR/$PLUGIN_NAME/"
cp .shopware-extension.yml "$WORK_DIR/$PLUGIN_NAME/"
cp -R src "$WORK_DIR/$PLUGIN_NAME/"

cd "$WORK_DIR"

zip -rq "../$ZIP_NAME" "$PLUGIN_NAME/" \
  --exclude=.github/* \
  --exclude=.tools/* \
  --exclude=dist/* \
  --exclude=tests/* \
  --exclude=Dockerfile \
  --exclude=docker-compose.yml \
  --exclude="$PLUGIN_NAME/.github/*" \
  --exclude="$PLUGIN_NAME/.tools/*" \
  --exclude="$PLUGIN_NAME/dist/*" \
  --exclude="$PLUGIN_NAME/tests/*" \
  --exclude="$PLUGIN_NAME/Dockerfile" \
  --exclude="$PLUGIN_NAME/docker-compose.yml"

cd ../..
rm -rf "$WORK_DIR"

echo "$ZIP_PATH"
