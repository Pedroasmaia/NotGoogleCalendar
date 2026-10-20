#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"
npm install
npm run build

echo "Build concluído: main.js, styles.css e manifest.json estão prontos para copiar para .obsidian/plugins/tasks-calendar/."

rm -r --force aaa/.obsidian/plugins/tasks-calendar/
mkdir -p aaa/.obsidian/plugins/tasks-calendar/

mv main.js aaa/.obsidian/plugins/tasks-calendar/
cp styles.css aaa/.obsidian/plugins/tasks-calendar/
cp manifest.json aaa/.obsidian/plugins/tasks-calendar/