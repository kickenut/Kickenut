#!/bin/zsh
unsetopt BG_NICE

cd /Users/account-1/Desktop/kickenut-Final || exit 1

(
  for attempt in {1..100}; do
    if nc -z localhost 3000 >/dev/null 2>&1; then
      open "http://localhost:3000/" >/dev/null 2>&1
      exit 0
    fi

    sleep 0.2
  done
) &
OPEN_WATCHER_PID=$!

node server.js
SERVER_STATUS=$?

if kill -0 "$OPEN_WATCHER_PID" >/dev/null 2>&1; then
  kill "$OPEN_WATCHER_PID" >/dev/null 2>&1
fi

wait "$OPEN_WATCHER_PID" >/dev/null 2>&1

echo
echo "Kickenut stopped"
echo "Press Return to close this window."
read

exit "$SERVER_STATUS"
