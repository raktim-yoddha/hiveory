/**
 * The Linux desktop a bot's Docker computer runs (ADR 0022): Xvfb + a small
 * window manager, x11vnc + noVNC for "take control", xdotool and ImageMagick
 * for the bot's desktop tools, Chromium, and common dev tools. Built with
 * `docker build -` from this text, so the same build works on this computer
 * and on an SSH host. Bump COMPUTER_IMAGE_VERSION whenever it changes.
 */
export const COMPUTER_IMAGE_VERSION = 1
export const COMPUTER_IMAGE = `hiveory-computer:${COMPUTER_IMAGE_VERSION}`
/** Label on every container Hiveory manages; a container without it is never touched. */
export const MANAGED_LABEL = 'com.hiveory.computer'
export const DISPLAY = ':1'
export const SCREEN = { width: 1280, height: 800 }
export const NOVNC_PORT = 6080

const DESKTOP_SCRIPT = [
  '#!/bin/sh',
  `Xvfb ${DISPLAY} -screen 0 ${SCREEN.width}x${SCREEN.height}x24 -nolisten tcp &`,
  'sleep 1',
  'fluxbox >/dev/null 2>&1 &',
  // The VNC server listens inside the container only; noVNC is the one door, published on loopback.
  `x11vnc -display ${DISPLAY} -forever -shared -nopw -localhost -rfbport 5900 -quiet >/dev/null 2>&1 &`,
  `exec websockify --web /usr/share/novnc ${NOVNC_PORT} localhost:5900`
].join('\\n')

export const COMPUTER_DOCKERFILE = `FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \\
      xvfb fluxbox x11vnc novnc websockify xdotool imagemagick x11-utils \\
      chromium fonts-dejavu-core fonts-noto-color-emoji ca-certificates \\
      curl git python3 nodejs npm procps less nano \\
    && rm -rf /var/lib/apt/lists/* \\
    && useradd -m -s /bin/bash bot && mkdir -p /workspace && chown bot:bot /workspace \\
    && ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html \\
    && printf '${DESKTOP_SCRIPT}\\n' > /usr/local/bin/hiveory-desktop && chmod 755 /usr/local/bin/hiveory-desktop
USER bot
WORKDIR /workspace
ENV DISPLAY=${DISPLAY}
LABEL ${MANAGED_LABEL}.image="${COMPUTER_IMAGE_VERSION}"
CMD ["/usr/local/bin/hiveory-desktop"]
`
