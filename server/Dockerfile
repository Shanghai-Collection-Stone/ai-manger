FROM node:20-alpine

WORKDIR /app

# 安装 pnpm 和 meitu-cli
RUN npm i -g pnpm meitu-cli

# 设置环境变量
ENV NODE_ENV=production
ENV PATH=/usr/local/bin:$PATH

# 暴露端口
EXPOSE 3011

# 启动命令
CMD ["sh", "-lc", "AK=${MEITU_AK:-$OPEN_CLAW_AK}; SK=${MEITU_SK:-$OPEN_CLAW_SK}; if [ -n \"$AK\" ]; then meitu config set-ak --value \"$AK\"; fi; if [ -n \"$SK\" ]; then meitu config set-sk --value \"$SK\"; fi; if [ ! -f package.json ] || [ ! -f dist/main.js ]; then echo \"Missing mounted app files in /app (need package.json and dist/main.js)\"; exit 1; fi; if [ ! -d node_modules ]; then pnpm install --prod --frozen-lockfile; fi; node dist/main.js"]
