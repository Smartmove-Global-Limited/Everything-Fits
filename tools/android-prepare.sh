#!/bin/sh
# Run once after Cocos Creator has generated build/android (Build panel → Android → Build).
#   - Gradle 8.0.2 / AGP 8.0.2 from the Cocos 3.8.2 template need JDK ≤ 17; this machine has the
#     JDK 21 bundled with Android Studio, so the generated project is moved to Gradle 8.7 / AGP 8.5.2.
#   - Copies the AppsFlyer Dev Key file (outside git) from the web project if it is missing.
#   sh tools/android-prepare.sh
set -e
P=$(cd "$(dirname "$0")/.." && pwd)
PROJ="$P/build/android/proj"
[ -d "$PROJ" ] || { echo "build/android/proj not found: build Android once in Cocos Creator first"; exit 1; }
sed -i '' 's#gradle-8\.0\.2-bin\.zip#gradle-8.7-bin.zip#' "$PROJ/gradle/wrapper/gradle-wrapper.properties"
sed -i '' 's#com\.android\.tools\.build:gradle:8\.0\.2#com.android.tools.build:gradle:8.5.2#' "$PROJ/build.gradle"
KEY="$P/native/engine/android/appsflyer.properties"
[ -f "$KEY" ] || cp "$P/../snug/android/appsflyer.properties" "$KEY" 2>/dev/null || echo "!! no appsflyer.properties: AppsFlyer will send nothing"
# No Cocos logo at launch: the game opens on its own splash (engine skips it when totalTime <= 0)
SETTINGS="$P/build/android/data/src/settings.json"
[ -f "$SETTINGS" ] && python3 - "$SETTINGS" <<'PY'
import json, sys
p = sys.argv[1]; d = json.load(open(p))
d.setdefault('splashScreen', {})['totalTime'] = 0
json.dump(d, open(p, 'w'), separators=(',', ':'))
PY
# App name on the launcher: the same as the web app (Cocos would use the project folder name)
STR="$PROJ/res/values/strings.xml"
[ -f "$STR" ] && sed -i '' 's#<string name="app_name"\([^>]*\)>[^<]*</string>#<string name="app_name"\1>Everything Fits</string>#' "$STR"
echo "Android project ready: open $PROJ in Android Studio (Gradle JDK: Embedded JDK 21)"
