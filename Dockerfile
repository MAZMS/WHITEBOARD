FROM node:20-slim

# Install LibreOffice Writer (DOCX→PDF conversion) + fonts
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libreoffice-writer \
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig && \
    rm -rf /var/lib/apt/lists/*

# Configure fontconfig to include app fonts (Google Fonts downloaded at runtime)
RUN mkdir -p /app/fonts && \
    echo '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><dir>/app/fonts</dir></fontconfig>' > /etc/fonts/conf.d/99-app-fonts.conf && \
    fc-cache -f

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

EXPOSE 8080
CMD ["node", "server.js"]
