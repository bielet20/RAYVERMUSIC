FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p data
# No .env file needed — env vars injected by Coolify/Docker Compose
EXPOSE 3001
CMD ["node", "server.js"]
