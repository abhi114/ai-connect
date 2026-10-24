FROM node:24-bookworm-slim
WORKDIR /app
COPY shared/package.json shared/protocol.ts ./shared/
COPY backend/package.json ./backend/
COPY backend/src ./backend/src
WORKDIR /app/backend
ENV HOST=0.0.0.0 PORT=8787 DATABASE_PATH=/data/pantheon.sqlite
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/main.ts"]
