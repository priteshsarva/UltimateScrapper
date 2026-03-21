# FROM ghcr.io/puppeteer/puppeteer:24.1.1

# # Set Puppeteer to use the built-in Chromium
# ENV PUPPETEER_SKIP_DOWNLOAD=true

# WORKDIR /usr/src/app

# COPY package*.json ./
# RUN npm ci
# COPY . .

# # Find Puppeteer's Chromium path and set it as an ENV variable
# ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium-browser"

# CMD ["node", "index.js"]



FROM node:18-slim

# Install Chromium
RUN apt-get update && apt-get install -y chromium && rm -rf /var/lib/apt/lists/*


# Install necessary dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libgtk-3-0 \
    libxshmfence1 \
    libxslt1.1 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies, including Puppeteer
RUN npm install --omit=dev --no-cache --prefer-offline

# Copy application files
COPY . .

# Expose the necessary port
EXPOSE 3000

# Launch command
CMD ["node", "index.js"]
