# CurrentUsage Cloud Dashboard
FROM node:20-slim

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application source
COPY server.js db.js telemetry_db.js monthly_energy.js mailer.js generate_labels.js ./
COPY index.html admin.html reset-password.html admin.js app.js style.css ./
COPY assets/ ./assets/

# Data persistence (SQLite auth + DuckDB telemetry)
ENV PORT=3000 \
    DATA_DIR=/app/data \
    NODE_ENV=production
VOLUME /app/data

EXPOSE 3000

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
