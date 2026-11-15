'use client';

import { useEffect } from 'react';

// Inside Telegram (a Mini App) the portal says it is ready, opens to full height and gives Telegram the colours of its own
// header and page. Telegram's script is not loaded: these few events are posted directly, as
// https://core.telegram.org/api/web-events describes, so the page runs no code from elsewhere.
export const TELEGRAM_NAME = 'venue_tg_name';
const HEADER = '#162033'; // --color-ink, the strip at the top of every portal page
const PAGE = '#f5f7fa'; // --color-paper

type Webview = { TelegramWebviewProxy?: { postEvent(type: string, data: string): void } };

function post(eventType: string, eventData: object = {}) {
  const proxy = (window as Webview).TelegramWebviewProxy;
  if (proxy) proxy.postEvent(eventType, JSON.stringify(eventData));
  // Telegram on the web shows the portal in a frame; it is the only site allowed to frame one.
  else
    window.parent.postMessage(JSON.stringify({ eventType, eventData }), 'https://web.telegram.org');
}

export function TelegramApp() {
  useEffect(() => {
    const inside = Boolean((window as Webview).TelegramWebviewProxy) || window.parent !== window;
    if (!inside) return;
    post('web_app_ready');
    post('web_app_expand');
    post('web_app_set_header_color', { color: HEADER });
    post('web_app_set_background_color', { color: PAGE });
    // Telegram puts its signed data in the address the first page opens with; the server checks it before the name is used.
    const initData = new URLSearchParams(location.hash.slice(1)).get('tgWebAppData');
    if (!initData) return;
    fetch('/api/portal/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData }),
    })
      .then((response) => (response.ok ? (response.json() as Promise<{ name: string }>) : null))
      .then((answer) => {
        if (answer?.name) sessionStorage.setItem(TELEGRAM_NAME, answer.name);
      })
      .catch((error: unknown) => console.error('Telegram data was not checked:', error));
  }, []);
  return null;
}
