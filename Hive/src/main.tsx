import React from 'react';
import ReactDOM from 'react-dom/client';
import HomePage from './app/HomePage';
import 'xterm/css/xterm.css';
import './app/globals.css';

// Global Window.open Interceptor for Tauri Desktop App:
// Embedded widgets (like GlassChat) call window.open() for browser sign-in/OAuth.
// If the widget builds a relative URL on localhost (e.g. http://localhost:5173/signin?...),
// we rewrite the origin to https://glasschat.app and delegate to system default browser.
if (typeof window !== 'undefined') {
  const originalOpen = window.open;
  window.open = function (url?: string | URL, target?: string, features?: string) {
    if (url) {
      let urlStr = typeof url === 'string' ? url : url.toString();

      // Rewrite GlassChat auth URLs to official https://glasschat.app origin
      if (
        urlStr.includes("desktopAuth=") ||
        urlStr.includes("/signin") ||
        urlStr.includes("provider=") ||
        urlStr.includes("glasschat")
      ) {
        urlStr = urlStr.replace(/^http:\/\/localhost:\d+/, "https://glasschat.app");
        if (urlStr.startsWith("/")) {
          urlStr = `https://glasschat.app${urlStr}`;
        }
      }

      if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
        import('@tauri-apps/plugin-shell')
          .then(({ open: openShellUrl }) => openShellUrl(urlStr))
          .catch(() => originalOpen.call(window, urlStr, target, features));
        return null;
      }
    }
    return originalOpen.call(window, url, target, features);
  };
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HomePage />
  </React.StrictMode>
);
