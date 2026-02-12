FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Expose the port (default 3000, but can be overridden)
EXPOSE 3000

# Start command
CMD ["node", "server.js"]
