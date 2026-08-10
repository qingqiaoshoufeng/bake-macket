# syntax=docker/dockerfile:1
FROM node:22.14.0-alpine3.21 AS build

WORKDIR /workspace
RUN apk add --no-cache python3 make g++ && corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared-contracts/package.json packages/shared-contracts/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

COPY packages/shared-contracts packages/shared-contracts
COPY apps/api apps/api
RUN pnpm --filter @bake-mall/contracts build \
  && pnpm --filter @bake-mall/api build \
  && pnpm --filter @bake-mall/api deploy --prod /prod/api

FROM node:22.14.0-alpine3.21 AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S bake && adduser -S bake -G bake
COPY --from=build --chown=bake:bake /prod/api/node_modules ./node_modules
COPY --from=build --chown=bake:bake /workspace/apps/api/package.json ./package.json
COPY --from=build --chown=bake:bake /workspace/apps/api/dist ./dist

USER bake
# EXPOSE is image metadata only; set PORT at runtime and publish that same container port.
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 CMD node -e "const port=process.env.PORT??3000;fetch('http://127.0.0.1:'+port+'/api/v1/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
