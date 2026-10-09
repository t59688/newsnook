# NewsNook Cloud：可选账户与配置同步 API。
# 只跑 API，不跑迁移——迁移必须是显式的一步（见 docs/cloud-deploy.md / ./deploy db migrate）。
FROM node:24.18.0-alpine3.24 AS build

WORKDIR /app

# Alpine 上偶发 native/optional 包需要；缓存放到可写目录，避免部分宿主机上的 EPERM
RUN apk add --no-cache libc6-compat \
  && mkdir -p /tmp/npm-cache \
  && npm config set cache /tmp/npm-cache

# 依赖装在 workspace 根上：cloud 依赖 @newsnook/contracts
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY cloud/package.json cloud/

# 根 package.json 是 Web 客户端，API 镜像不需要 Vite/React/Capacitor 等。
# 清空后再装，否则 npm 会按 lockfile 拉整仓依赖，慢且易在受限环境 EPERM。
# 与修改后的 package.json 不完全一致，故用 npm install 而非 npm ci。
RUN node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); p.dependencies={}; p.devDependencies={}; fs.writeFileSync('package.json', JSON.stringify(p,null,2)+'\n');" \
  && npm install \
    --workspace=@newsnook/contracts \
    --workspace=@newsnook/cloud \
    --include-workspace-root \
    --no-audit \
    --no-fund \
    --fetch-retries=5

COPY packages/contracts packages/contracts
COPY cloud cloud
RUN npm run build --workspace @newsnook/contracts \
  && npm run build --workspace @newsnook/cloud

# 只留运行期依赖
RUN npm prune --omit=dev --workspaces --include-workspace-root \
  && npm cache clean --force


FROM node:24.18.0-alpine3.24 AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/cloud/package.json cloud/package.json
COPY --from=build /app/cloud/dist cloud/dist
COPY --from=build /app/cloud/migrations cloud/migrations

USER node
EXPOSE 8787

# /health/live 不碰数据库，适合做容器存活探针
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "cloud/dist/server.js"]
