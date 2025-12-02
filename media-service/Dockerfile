FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --production

FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
COPY sql ./sql
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=base /app/node_modules ./node_modules
COPY package*.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/sql ./sql

EXPOSE 4000

CMD ["node", "dist/server.js"]
