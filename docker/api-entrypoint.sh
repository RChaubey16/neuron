#!/bin/sh
# Applies pending database migrations, then starts the API. If a migration
# fails, the container stops instead of serving with an out-of-date schema.
# Prisma takes a Postgres advisory lock, so two containers starting at once
# don't run the same migration twice.
set -eu

cd /app/db
./node_modules/.bin/prisma migrate deploy

cd /app/api
exec node dist/main.js
