#!/usr/bin/env bash
# Vérifie que les trois profils répondent et mesure leur temps de réponse.
# Deux panneaux réels de Bouguenais servent de sonde.
set -uo pipefail
PROBE="-1.5475151,47.1898948;-1.5464613,47.1858024"
for SVC in "voiture 5100" "vélo 5101" "piéton 5102"; do
  set -- $SVC
  OUT=$(curl -s --max-time 5 -w '\n%{time_total}' "http://127.0.0.1:$2/table/v1/driving/$PROBE?annotations=distance" 2>/dev/null)
  TIME=$(echo "$OUT" | tail -1)
  BODY=$(echo "$OUT" | head -1)
  if echo "$BODY" | grep -q '"code":"Ok"'; then
    DIST=$(echo "$BODY" | grep -o '"distances":\[\[[^]]*\]' | grep -oE '[0-9]+\.[0-9]+' | head -2 | tail -1)
    printf '%-8s port %s  OK   %ss   (%s m entre les deux panneaux)\n' "$1" "$2" "$TIME" "${DIST:-?}"
  else
    printf '%-8s port %s  ÉCHEC\n' "$1" "$2"
  fi
done
