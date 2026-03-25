# Dockerfile for AL-MUDIR
# Lightweight Node.js + Python simple HTTP server

FROM node:18-alpine

WORKDIR /app

# Copy all files
COPY . .

# Install simple http server globally
RUN npm install -g http-server

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/index.html || exit 1

# Start server
CMD ["http-server", "-c-1", "-p", "8080", "--gzip", "--brotli"]
