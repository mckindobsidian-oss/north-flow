// Serves ONLY the APK and its download page, never the repository or credentials.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apk = resolve(fileURLToPath(new URL('../artifacts/North-Android-universal.apk', import.meta.url)));
const info = await stat(apk);
const digest = createHash('sha256');
for await (const chunk of createReadStream(apk)) digest.update(chunk);
const hash = digest.digest('hex');
const page = Buffer.from(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Download North for Android</title><style>body{margin:0;padding:32px 20px;background:#171121;color:#f6f0ff;font:16px/1.65 system-ui}main{max-width:540px;margin:8vh auto}h1{line-height:1.2}a{display:inline-block;background:#c6b2ff;color:#211630;padding:14px 22px;border-radius:14px;text-decoration:none;font-weight:650}small{display:block;color:#d0c5df}code{overflow-wrap:anywhere;font-size:11px}li{margin:12px 0}</style><main><small>NORTH · ANDROID</small><h1>Your focus, wherever you go.</h1><p>North · Android 8 or newer · 32-bit and 64-bit</p><a href="/North-Android.apk" download>Download APK · ${(info.size / 1048576).toFixed(1)} MB</a><ol><li>Open this page on your Android phone on the same Wi-Fi as your computer.</li><li>Wait for the download to finish. Open the APK from your phone’s Downloads app.</li><li>Allow installation from your browser or file manager if Android asks, then tap Install.</li></ol><p>If Android says “App not installed,” keep the exact message. An older North build signed with a different key cannot be updated by this file. Do not uninstall it until any unsynced local data is saved.</p><small>SHA-256</small><code>${hash}</code></main></html>`);
const server = createServer((req, res) => {
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { ...headers, Allow: 'GET, HEAD' }); return res.end(); }
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') {
    res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': page.length, 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
    return res.end(req.method === 'HEAD' ? undefined : page);
  }
  if (path !== '/North-Android.apk') { res.writeHead(404, headers); return res.end(); }
  let start = 0, end = info.size - 1, status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    if (!match || (start = Number(match[1])) >= info.size || (end = match[2] ? Number(match[2]) : end) < start || end >= info.size) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` }); return res.end();
    }
    status = 206;
  }
  res.writeHead(status, { ...headers, 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': 'attachment; filename="North-Android.apk"', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}) });
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(apk, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
});
server.listen(5176, '0.0.0.0', () => {
  console.log('North APK: http://localhost:5176');
  for (const list of Object.values(networkInterfaces())) for (const item of list || []) if (item.family === 'IPv4' && !item.internal) console.log(`Phone download (same Wi-Fi): http://${item.address}:5176`);
});
