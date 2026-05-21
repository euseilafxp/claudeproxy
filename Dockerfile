FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    dbus-x11 \
    xauth \
    fonts-liberation \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

RUN npx playwright install chromium --with-deps

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

ENV DISPLAY=:99

COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 3000

CMD ["/app/start.sh"]
