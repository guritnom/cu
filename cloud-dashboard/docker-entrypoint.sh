#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR"

# Generate and persist a JWT secret on first run so the stack starts
# with zero configuration. Set JWT_SECRET explicitly to override.
if [ -z "$JWT_SECRET" ]; then
    SECRET_FILE="$DATA_DIR/.jwt_secret"
    if [ -f "$SECRET_FILE" ]; then
        JWT_SECRET="$(cat "$SECRET_FILE")"
    else
        JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
        printf '%s' "$JWT_SECRET" > "$SECRET_FILE"
        chmod 600 "$SECRET_FILE"
        echo "[entrypoint] Generated a new JWT_SECRET and stored it in $SECRET_FILE"
    fi
    export JWT_SECRET
fi

exec "$@"
