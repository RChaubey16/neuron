FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm exec prisma generate
RUN pnpm run build
RUN pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/generated ./generated
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main"]
