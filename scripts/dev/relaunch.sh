#!/bin/sh
# Kill dev Electron instances and relaunch the built app with CDP on :9333 and the QA hook.
# usage: sh scripts/dev/relaunch.sh [file.obw]
taskkill //IM electron.exe //F >/dev/null 2>&1
sleep 1
cd "$(dirname "$0")/../.."
./node_modules/electron/dist/electron.exe . --remote-debugging-port=9333 --obw-qa "$@" > "${TMPDIR:-/tmp}/obw-app.log" 2>&1 &
for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; curl -s http://127.0.0.1:9333/json/list >/dev/null 2>&1 && break; done
sleep 1.5
echo launched
