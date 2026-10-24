"use strict";
/* Service worker của Nguyễn Nhật.
   Đổi VERSION mỗi lần sửa code để người dùng nhận được toast "Có phiên bản mới". */
const VERSION = "v1.0.0";
const CORE_CACHE = "core-" + VERSION;
const RUNTIME_CACHE = "runtime-v1";
const HLS_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";
const SHELL = [
  "./", "./index.html", "./manifest.json",
  "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-32.png"
];
const STREAM_EXT = /\.(m3u8|ts|aac|mp3|m4s)$/i;

/* Cài đặt: nạp app shell. KHÔNG tự gọi skipWaiting để không đổi code giữa lúc đang nghe nhạc. */
self.addEventListener("install", e => {
  e.waitUntil((async () => {
    try {
      const cache = await caches.open(CORE_CACHE);
      try { await cache.addAll(SHELL); }
      catch (err) {                                  // một file thiếu (ví dụ chưa tạo icon) thì vẫn lưu các file còn lại
        console.warn("[sw] addAll lỗi, thử từng file", err);
        await Promise.allSettled(SHELL.map(u => cache.add(u)));
      }
    } catch (err) { console.warn("[sw] không mở được cache khi cài đặt", err); }
  })());
});

/* Trang bấm "Cập nhật" thì mới kích hoạt bản mới */
self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

/* Kích hoạt: xóa cache app shell của các phiên bản cũ */
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith("core-") && k !== CORE_CACHE).map(k => caches.delete(k)));
    } catch (err) { console.warn("[sw] dọn cache cũ lỗi", err); }
    await self.clients.claim();
  })());
});

/* Cache trước, thiếu thì lấy mạng rồi lưu. Lỗi cache không làm hỏng request. */
async function cacheFirst(req, cacheName) {
  let cache = null;
  try {
    cache = await caches.open(cacheName);
    const hit = await cache.match(req);
    if (hit) return hit;
  } catch (err) { console.warn("[sw] đọc cache lỗi", err); }
  const res = await fetch(req);                      // lỗi mạng thì để request thất bại tự nhiên
  if (cache && res && (res.ok || res.type === "opaque")) {
    try { await cache.put(req, res.clone()); } catch (err) { console.warn("[sw] ghi cache lỗi", err); }
  }
  return res;
}

/* Điều hướng: trả index.html từ cache ngay, đồng thời cập nhật ngầm từ mạng (stale-while-revalidate) */
async function navigate(e) {
  let cache = null, cached = null;
  try {
    cache = await caches.open(CORE_CACHE);
    cached = (await cache.match("./index.html", { ignoreSearch: true })) || (await cache.match("./", { ignoreSearch: true }));
  } catch (err) { console.warn("[sw] đọc cache điều hướng lỗi", err); }
  const net = fetch(e.request).then(res => {
    if (res && res.ok && cache) cache.put("./index.html", res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  if (cached) { e.waitUntil(net); return cached; }
  const res = await net;
  return res || Response.error();
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (req.headers.has("range")) return;              // seek audio: để trình duyệt tự xử lý
  if (req.destination === "audio" || req.destination === "video") return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (STREAM_EXT.test(url.pathname)) return;         // luồng radio, đoạn HLS: không bao giờ cache
  const isHls = req.url === HLS_URL;
  if (url.origin !== self.location.origin && !isHls) return;
  if (isHls) { e.respondWith(cacheFirst(req, RUNTIME_CACHE)); return; }
  if (req.mode === "navigate") { e.respondWith(navigate(e)); return; }
  e.respondWith(cacheFirst(req, CORE_CACHE));
});

/* Nút "Báo lại" / "Tắt" trên thông báo báo thức: chuyển cho trang xử lý, không có trang thì mở trang */
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const action = e.action || "open";
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    list.forEach(c => c.postMessage({ type: "ALARM_ACTION", action, tag: e.notification.tag }));
    if (list.length) { try { await list[0].focus(); } catch (err) {} }
    else { try { await self.clients.openWindow("./?open=alarm"); } catch (err) {} }
  })());
});
