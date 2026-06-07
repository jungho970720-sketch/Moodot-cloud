#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/service"
BUILD_DIR="$SERVICE_DIR/dist-lambda/build"
ZIP_PATH="$SERVICE_DIR/dist-lambda/moodot-ai-worker-lambda.zip"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

python3 -m pip install -r "$SERVICE_DIR/requirements.txt" -t "$BUILD_DIR"

cp "$SERVICE_DIR/lambda_handler.py" "$BUILD_DIR/"
cp "$SERVICE_DIR/runtime.py" "$BUILD_DIR/"
cp "$SERVICE_DIR/main.py" "$BUILD_DIR/"

for dir in \
  agents \
  config \
  db \
  events \
  generators \
  models \
  prompts \
  rules \
  scoring \
  security \
  tools
do
  cp -R "$SERVICE_DIR/$dir" "$BUILD_DIR/$dir"
done

find "$BUILD_DIR" -type d -name "__pycache__" -prune -exec rm -rf {} +
find "$BUILD_DIR" -type f -name "*.pyc" -delete

(
  cd "$BUILD_DIR"
  rm -f "$ZIP_PATH"
  zip -qr "$ZIP_PATH" .
)

echo "Created Lambda package: $ZIP_PATH"
