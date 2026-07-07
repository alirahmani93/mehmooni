# ---- تصویر تولید (production) ----
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# ابتدا فقط فایل‌های وابستگی را کپی می‌کنیم تا از کش لایه‌ها استفاده شود
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# سپس بقیه‌ی کد
COPY . .

# پوشه‌ی داده باید وجود داشته باشد و متعلق به کاربر node باشد
RUN mkdir -p data/backups && chown -R node:node /app

USER node
EXPOSE 4123

# بررسی سلامت: منو باید در دسترس باشد
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4123/api/menu >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
