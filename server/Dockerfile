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
CMD ["sh", "-lc", "AK=${MEITU_AK:-$OPEN_CLAW_AK}; SK=${MEITU_SK:-$OPEN_CLAW_SK}; if [ -n \"$AK\" ]; then meitu config set-ak --value \"$AK\"; fi; if [ -n \"$SK\" ]; then meitu config set-sk --value \"$SK\"; fi; if [ -z \"$MONGODB_URI\" ] && [ -n \"$MONGO_URI\" ]; then export MONGODB_URI=\"$MONGO_URI\"; fi; if [ -z \"$MONGODB_URI\" ] && [ -n \"$MONGO_URL\" ]; then export MONGODB_URI=\"$MONGO_URL\"; fi; if [ -z \"$MONGODB_URI\" ] && [ -n \"$MONGODB_URL\" ]; then export MONGODB_URI=\"$MONGODB_URL\"; fi; if [ -z \"$MONGODB_DB\" ] && [ -n \"$MONGO_DB_NAME\" ]; then export MONGODB_DB=\"$MONGO_DB_NAME\"; fi; if [ -z \"$MONGODB_DB\" ] && [ -n \"$MONGO_DB\" ]; then export MONGODB_DB=\"$MONGO_DB\"; fi; if [ -n \"$MONGODB_DOCKER_HOST\" ] && [ -n \"$MONGODB_URI\" ]; then export MONGODB_URI=\"${MONGODB_URI/127.0.0.1/$MONGODB_DOCKER_HOST}\"; export MONGODB_URI=\"${MONGODB_URI/localhost/$MONGODB_DOCKER_HOST}\"; fi; if [ -z \"$MONGODB_URI\" ]; then echo \"Warning: MONGODB_URI is empty (aliases: MONGO_URI/MONGO_URL/MONGODB_URL). App may fallback to localhost:27017.\"; fi; if [ -n \"$MONGODB_URI\" ] && [ -z \"$MONGODB_DOCKER_HOST\" ] && echo \"$MONGODB_URI\" | grep -E -q '://([^@/]*@)?(localhost|127\\.0\\.0\\.1)(:|/|$)'; then echo \"Warning: MONGODB_URI points to localhost/127.0.0.1 inside container. Use external host/IP, or set MONGODB_DOCKER_HOST.\"; fi; if [ ! -f package.json ] || [ ! -f dist/main.js ]; then echo \"Missing mounted app files in /app (need package.json and dist/main.js)\"; exit 1; fi; if [ ! -d node_modules ]; then pnpm install --prod --frozen-lockfile; fi; node dist/main.js"]
