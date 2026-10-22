#!/bin/sh
# Build bản web-mobile bằng dòng lệnh rồi chép nội dung game (levels.json, ảnh) từ repo game web.
#   sh tools/build-web.sh
set -e
P=$(cd "$(dirname "$0")/.." && pwd)
GAME=${GAME:-$P/../snug}
S=$(python3 -c "import json;print(json.load(open('$P/assets/scenes/Game.scene.meta'))['uuid'])")
cat > /tmp/ef_build.json <<J
{"platform":"web-mobile","debug":true,"name":"web-mobile","outputName":"web-mobile","startScene":"$S","scenes":[{"url":"db://assets/scenes/Game.scene","uuid":"$S"}],"md5Cache":false,"sourceMaps":false}
J
/Applications/Cocos/Creator/3.8.2/CocosCreator.app/Contents/MacOS/CocosCreator --project "$P" --build "configPath=/tmp/ef_build.json" > /tmp/ef_build.log 2>&1 || true
grep -q "build success" /tmp/ef_build.log || { grep -iE "error" /tmp/ef_build.log | tail -20; exit 1; }
rm -rf "$P/build/web-mobile/content" && mkdir -p "$P/build/web-mobile/content" && cp -R "$GAME/public/content/cozy" "$P/build/web-mobile/content/cozy"
echo "build xong"
