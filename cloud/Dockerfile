# NewsNook Cloud：可选账户与配置同步 API。
# 只跑 API，不跑迁移——迁移必须是显式的一步（见 docs/cloud-deploy.md / ./deploy db migrate）。
FROM node:24.18.0-alpine3.24 AS build

WORKDIR /app

# 依赖装在 workspace 根上：cloud 依赖 @newsnook/contracts
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY cloud/package.json cloud/
RUN npm ci --workspaces --include-workspace-root

COPY packages/contracts packages/contracts
COPY cloud cloud
RUN npm run build --workspace @newsnook/contracts \
  && npm run build --workspace @newsnook/cloud

# 只留运行期依赖
RUN npm prune --omit=dev --workspaces --include-workspace-root


FROM node:24.18.0-alpine3.24 AS runtime

ENV NODE_ENV=production
WORKDIR /app

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
