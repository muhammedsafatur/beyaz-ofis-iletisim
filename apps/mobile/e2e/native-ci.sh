#!/usr/bin/env bash
# CI'da Android emülatörü üzerinde native e2e. Her akış temiz bir uygulama kurulumuyla başlar:
# uninstall, install, adb ile başlatma. (Maestro launchApp/clearState gerekmez.)
# Ön koşul: API 3000'de çalışıyor, release APK derlenmiş, emülatör açık.
set -euo pipefail

APK="apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
PKG="com.beyazofis.mobile"
export PATH="$HOME/.maestro/bin:$PATH"

adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed | tr -d "\r")" != "1" ]; do sleep 2; done'
adb reverse tcp:3000 tcp:3000

fresh_install() {
  adb uninstall "$PKG" >/dev/null 2>&1 || true
  adb install -r "$APK"
}

start_app() {
  adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
  sleep 8
}

echo "== 1/2 chat-and-work"
fresh_install
start_app
maestro test apps/mobile/e2e/maestro/chat-and-work.yaml

echo "== 2/2 mention-banner (anma, uygulama açıkken dışarıdan tetiklenir)"
fresh_install
start_app
( sleep 40 && node apps/mobile/e2e/trigger-mention.mjs ) &
TRIGGER_PID=$!
maestro test apps/mobile/e2e/maestro/mention-banner.yaml
wait "$TRIGGER_PID"
echo "native e2e tamam"
