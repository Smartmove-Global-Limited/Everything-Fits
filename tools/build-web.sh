#!/bin/sh
# Command-line web-mobile build: Main.scene (Home / Shop) is the start scene, Game.scene is the level.
# Game content (levels, items, bags, audio, UI art) ships inside the build (assets/resources).
# Close the project in the Cocos editor first: the CLI build cannot run next to an open editor.
#   sh tools/build-web.sh
set -e
P=$(cd "$(dirname "$0")/.." && pwd)
uuid() { python3 -c "import json;print(json.load(open('$P/assets/scenes/$1.scene.meta'))['uuid'])"; }
MAIN=$(uuid Main); GAME=$(uuid Game)
cat > /tmp/ef_build.json <<J
{"platform":"web-mobile","debug":false,"name":"web-mobile","outputName":"web-mobile","startScene":"$MAIN",
 "scenes":[{"url":"db://assets/scenes/Main.scene","uuid":"$MAIN"},{"url":"db://assets/scenes/Game.scene","uuid":"$GAME"}],
 "md5Cache":true,"sourceMaps":false}
J
/Applications/Cocos/Creator/3.8.2/CocosCreator.app/Contents/MacOS/CocosCreator --project "$P" --build "configPath=/tmp/ef_build.json" > /tmp/ef_build.log 2>&1 || true
grep -q "build success" /tmp/ef_build.log || { grep -iE "error" /tmp/ef_build.log | tail -20; exit 1; }
echo "build done: $P/build/web-mobile"
