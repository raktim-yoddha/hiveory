/**
 * The Linux desktop a bot's computer runs (ADR 0022, 0032): Xvfb + a small window manager, x11vnc +
 * noVNC for "take control", xdotool and ImageMagick for the bot's desktop tools, an accessibility bus
 * (AT-SPI) so the bot can read the screen as UI elements, Chromium, and common dev tools. Built with
 * `docker build -` (or `podman build -f -`) from this text, so the same build works on this computer and
 * on an SSH host. Bump COMPUTER_IMAGE_VERSION whenever it changes: existing computers then offer Rebuild.
 */
export const COMPUTER_IMAGE_VERSION = 2
export const COMPUTER_IMAGE = `hiveory-computer:${COMPUTER_IMAGE_VERSION}`
/**
 * The base image, pinned by digest (debian:bookworm-slim, multi-arch index, 2026-10-08), so every
 * computer starts from the same bytes and a retagged upstream image can't change it. Re-pin on purpose.
 */
export const BASE_IMAGE = 'debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587'
/** Label on every container Hiveory manages; a container without it is never touched. */
export const MANAGED_LABEL = 'com.hiveory.computer'
/** The image version a container was made from (its image's label), to offer Rebuild when it is older. */
export const IMAGE_LABEL = `${MANAGED_LABEL}.image`
export const DISPLAY = ':1'
export const SCREEN = { width: 1280, height: 800 }
export const NOVNC_PORT = 6080
/** Where the desktop's session bus address is written, for commands started later with `exec`. */
export const DBUS_ENV_FILE = '/tmp/hiveory-dbus'
/** Elements the UI tree lists at most (a busy page has thousands). */
export const MAX_UI_ELEMENTS = 400

const DESKTOP_SCRIPT = `#!/bin/sh
Xvfb ${DISPLAY} -screen 0 ${SCREEN.width}x${SCREEN.height}x24 -nolisten tcp &
sleep 1
# A session bus with the accessibility bus on it, shared with everything started later.
eval "$(dbus-launch --sh-syntax)"
echo "export DBUS_SESSION_BUS_ADDRESS='$DBUS_SESSION_BUS_ADDRESS'" > ${DBUS_ENV_FILE}
/usr/libexec/at-spi-bus-launcher --launch-immediately >/dev/null 2>&1 &
fluxbox >/dev/null 2>&1 &
# The VNC server listens inside the container only; noVNC is the one door, published on loopback.
x11vnc -display ${DISPLAY} -forever -shared -nopw -localhost -rfbport 5900 -quiet >/dev/null 2>&1 &
exec websockify --web /usr/share/novnc ${NOVNC_PORT} localhost:5900
`

/** Prints the visible UI elements of every app as "role "name" at x,y" (their centres), indented by depth. */
const UI_TREE_SCRIPT = `#!/usr/bin/env python3
import sys
try:
    import pyatspi
except Exception:
    print("The accessibility library is missing.")
    sys.exit(2)

LIMIT = ${MAX_UI_ELEMENTS}
ACTIONABLE = {"push button", "toggle button", "check box", "radio button", "menu item", "link", "entry", "text", "combo box", "list item", "page tab", "spin button", "slider"}
out = []

def walk(node, depth):
    if len(out) >= LIMIT:
        return
    try:
        role = node.getRoleName()
        name = (node.name or "").strip().replace("\\n", " ")
        showing = node.getState().contains(pyatspi.STATE_SHOWING)
        x, y, w, h = node.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
    except Exception:
        return
    if not showing:
        return
    if w > 0 and h > 0 and (name or role in ACTIONABLE):
        out.append("%s%s \\"%s\\" at %d,%d" % ("  " * min(depth, 8), role, name[:80], x + w // 2, y + h // 2))
    for i in range(min(node.childCount, 500)):
        try:
            walk(node.getChildAtIndex(i), depth + 1)
        except Exception:
            pass

for app in pyatspi.Registry.getDesktop(0):
    walk(app, 0)
print("\\n".join(out) if out else "(No UI elements: the app may not expose them. Use desktop_screenshot.)")
if len(out) >= LIMIT:
    print("(cut at %d elements)" % LIMIT)
`

const b64 = (text: string): string => Buffer.from(text).toString('base64')

export const COMPUTER_DOCKERFILE = `FROM ${BASE_IMAGE}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \\
      xvfb fluxbox x11vnc novnc websockify xdotool imagemagick x11-utils \\
      dbus-x11 at-spi2-core python3-pyatspi \\
      chromium fonts-dejavu-core fonts-noto-color-emoji ca-certificates \\
      curl git python3 nodejs npm procps less nano \\
    && rm -rf /var/lib/apt/lists/* \\
    && useradd -m -s /bin/bash bot && mkdir -p /workspace && chown bot:bot /workspace \\
    && ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html \\
    && echo ${b64(DESKTOP_SCRIPT)} | base64 -d > /usr/local/bin/hiveory-desktop \\
    && echo ${b64(UI_TREE_SCRIPT)} | base64 -d > /usr/local/bin/hiveory-ui-tree \\
    && chmod 755 /usr/local/bin/hiveory-desktop /usr/local/bin/hiveory-ui-tree
USER bot
WORKDIR /workspace
ENV DISPLAY=${DISPLAY} NO_AT_BRIDGE=0 GTK_MODULES=gail:atk-bridge
LABEL ${IMAGE_LABEL}="${COMPUTER_IMAGE_VERSION}"
CMD ["/usr/local/bin/hiveory-desktop"]
`
