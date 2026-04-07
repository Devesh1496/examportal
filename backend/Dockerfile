# Use Microsoft's Playwright image which includes Node.js and all browser binaries
FROM mcr.microsoft.com/playwright:v1.58.2-noble

# Set working directory
WORKDIR /app

# Install system dependencies (Poppler for PDF-to-Image conversion)
RUN apt-get update && apt-get install -y \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of your backend code
COPY . .

# Playwright binaries are already in the image, but we ensure they're linked
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Start the application
CMD [ "node", "server.js" ]
