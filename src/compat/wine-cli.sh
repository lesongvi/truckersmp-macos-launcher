#!/bin/sh
# truckersmp-cli uses `wine winedbg --command "info process"` to find Steam.
# Wine 11.11's custom distribution omits winedbg. Adapt only that probe;
# every other invocation is passed unchanged to the selected Wine binary.
: "${TRUCKERSMP_WINE_BINARY:?The real Wine binary was not configured}"
if [ -n "${TRUCKERSMP_DYLD_LIBRARY_PATH:-}" ]; then
  export DYLD_FALLBACK_LIBRARY_PATH="$TRUCKERSMP_DYLD_LIBRARY_PATH"
fi
if { [ "${1:-}" = winedbg ] || [ "${1:-}" = winedbg.exe ]; } &&
   [ "${2:-}" = --command ] && [ "${3:-}" = 'info process' ] && [ "$#" -eq 3 ]; then
  processes=$("$TRUCKERSMP_WINE_BINARY" tasklist.exe /FO CSV /NH)
  result=$?
  if [ "$result" -ne 0 ]; then exit "$result"; fi
  printf '%s\n' "$processes" | /usr/bin/awk -F',' '/^"/ {
    name=$1; sub(/^"/, "", name); sub(/"$/, "", name)
    printf "00000000 0 \047%s\047\n", name
  }'
  exit 0
fi
exec "$TRUCKERSMP_WINE_BINARY" "$@"
