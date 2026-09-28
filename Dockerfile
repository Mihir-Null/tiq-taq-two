# Two stages: build the web app, then a slim image that runs the lobby server
# (which also serves the built app).
#
#   docker build -t tiq-taq-two .
#   docker run -p 8787:8787 tiq-taq-two
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
USER node
EXPOSE 8787
CMD ["node", "server/main.ts"]
