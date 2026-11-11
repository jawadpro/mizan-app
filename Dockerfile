# Mizan for self-hosting (docker-compose.yml) and the sample-data demo (docker-compose.demo.yml). Production on Vercel doesn't use this file.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/next.config.mjs ./
COPY --from=build /app/docker/start.sh ./docker/start.sh
# A Windows checkout may have turned the script's line endings into CRLF, which Linux cannot run.
RUN sed -i 's/\r$//' ./docker/start.sh && chmod +x ./docker/start.sh
EXPOSE 3000
CMD ["sh", "./docker/start.sh"]
