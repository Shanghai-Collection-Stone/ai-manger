# 构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 复制 package.json 和 pnpm-lock.yaml
COPY package.json pnpm-lock.yaml ./

# 安装依赖（包括 devDependencies 用于构建）
RUN npm i -g pnpm && pnpm install --frozen-lockfile

# 复制源码
COPY . .

# 构建项目
RUN pnpm run build

# 运行阶段
FROM node:20-alpine

WORKDIR /app

# 安装 pnpm 和 meitu-cli
RUN npm i -g pnpm meitu-cli

# 从构建阶段复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
COPY --from=builder /app/web ./web

# 设置环境变量
ENV NODE_ENV=production
ENV PATH=/usr/local/bin:$PATH

# 暴露端口
EXPOSE 3011

# 启动命令
CMD ["sh", "-lc", "AK=${MEITU_AK:-$OPEN_CLAW_AK}; SK=${MEITU_SK:-$OPEN_CLAW_SK}; if [ -n \"$AK\" ]; then meitu config set-ak --value \"$AK\"; fi; if [ -n \"$SK\" ]; then meitu config set-sk --value \"$SK\"; fi; node dist/main.js"]
