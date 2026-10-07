#!/usr/bin/env bash
# Déploie le commit courant (HEAD) sur la préprod du homelab.
#
#   deploy/preprod/deployer.sh
#
# Envoie une archive du commit (pas les fichiers non commités), construit
# l'image casse-noisette:preprod sur le homelab et redémarre le conteneur.
# Le schéma de la base de dev est mis à jour avant (prisma db push depuis le
# poste, par le tunnel SSH du .env : l'image de prod n'embarque pas Prisma CLI).
# Le .env de /opt/casse-noisette-preprod doit exister (voir docker-compose.yml).

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

HOTE="${HOTE:-root@192.168.1.122}"
DEST=/opt/casse-noisette-preprod
COMMIT=$(git rev-parse --short HEAD)
[ -n "$(git status --porcelain --untracked-files=no)" ] && echo "Attention : modifications non commitées, non déployées."

echo "==> envoi de $COMMIT"
ssh "$HOTE" "mkdir -p $DEST/src && rm -rf $DEST/src/*"
git archive --format=tar HEAD | ssh "$HOTE" "tar -x -C $DEST/src"
ssh "$HOTE" "cp $DEST/src/deploy/preprod/docker-compose.yml $DEST/docker-compose.yml && test -f $DEST/.env"

echo "==> construction de l'image"
ssh "$HOTE" "cd $DEST/src && docker build -q -t casse-noisette:preprod --label commit=$COMMIT -f Dockerfile . >/dev/null"

echo "==> schéma de la base de dev"
npx prisma db push --skip-generate

echo "==> redémarrage"
ssh "$HOTE" "cd $DEST && docker compose up -d --force-recreate >/dev/null && for i in \$(seq 1 40); do curl -sf http://127.0.0.1:3025/api/health >/dev/null && echo 'en ligne' && exit 0; sleep 3; done; docker logs --tail 30 casse-noisette-preprod; exit 1"
echo "==> https://casse-noisette-preprod.aynn.fr ($COMMIT)"
