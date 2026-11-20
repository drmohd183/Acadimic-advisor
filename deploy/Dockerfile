# صورة تشغيل المرشد الأكاديمي
FROM node:22-alpine
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && rm -rf dist-demo
ENV NODE_ENV=production APP_MODE=production PORT=4000
EXPOSE 4000
# عند كل تشغيل: إنشاء/ترقية المخطط، والتهيئة الأولى إن كانت القاعدة فارغة (تتخطى تلقائيًا إن وُجدت بيانات)
CMD ["sh", "-c", "npx tsx server/src/db/seed.ts --production && npx tsx server/src/index.ts"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
