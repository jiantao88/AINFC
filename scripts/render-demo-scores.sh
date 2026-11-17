#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PROFILE=$(mktemp -d /tmp/ainfc-fixture-chrome.XXXXXX)
trap 'rm -rf "$PROFILE"' EXIT
for id in 01 02 03; do
 "$CHROME" --headless --disable-gpu --no-first-run --no-default-browser-check --hide-scrollbars --force-device-scale-factor=1 --user-data-dir="$PROFILE" --window-size=900,1200 --screenshot="$ROOT/docs/demo-fixtures/scores/$id.png" "file://$ROOT/docs/demo-fixtures/scores/$id.html"
done
"$CHROME" --headless --disable-gpu --no-first-run --no-default-browser-check --user-data-dir="$PROFILE" --dump-dom "file://$ROOT/docs/demo-fixtures/console.html?selftest=1" > /tmp/ainfc-fixture-console-test.html
