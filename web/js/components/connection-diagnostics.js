// "Chẩn đoán kết nối": numbers to compare one browser with another (e.g. Safari vs Chrome on the same
// iPhone). Shows the running app version, the address the server sees (iCloud Private Relay replaces
// it with an Apple partner address), round-trip times to the server and how the page connected.
import { html, useEffect, useState } from '../../vendor/preact-htm.module.js';
import { APP_VERSION } from '../app-version.js';

const PINGS = 5;

async function measure() {
  const times = [];
  let last = null;
  for (let i = 0; i < PINGS; i++) {
    const t0 = performance.now();
    const res = await fetch('/api/diag/ping', { cache: 'no-store', credentials: 'omit' });
    last = await res.json();
    times.push(Math.round(performance.now() - t0));
  }
  const pingEntry = performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/diag/ping')).pop();
  const nav = performance.getEntriesByType('navigation')[0];
  const span = (a, b) => (nav && nav[a] > 0 && nav[b] > 0 ? Math.round(nav[b] - nav[a]) : null);
  return {
    ip: last && last.ip,
    times,
    protocol: (pingEntry && pingEntry.nextHopProtocol) || (nav && nav.nextHopProtocol) || '?',
    pageDns: span('domainLookupStart', 'domainLookupEnd'),
    pageConnect: span('connectStart', 'connectEnd'),
    pageTls: nav && nav.secureConnectionStart > 0 ? Math.round(nav.connectEnd - nav.secureConnectionStart) : null,
    pageFirstByte: span('requestStart', 'responseStart'),
  };
}

function engineLabel() {
  const ua = navigator.userAgent;
  let browser = 'Khác';
  if (/CriOS/.test(ua)) browser = 'Chrome';
  else if (/FxiOS/.test(ua)) browser = 'Firefox';
  else if (/EdgiOS|Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return standalone ? `${browser} (mở từ màn hình chính)` : browser;
}

const ms = (v) => (v === null || v === undefined ? '—' : `${v} ms`);

function Line({ label, value }) {
  return html`<div class="row diag-row"><span>${label}</span><span class="meta">${value}</span></div>`;
}

export function ConnectionDiagnostics() {
  const [result, setResult] = useState(/** @type {any} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      setResult(await measure());
    } catch {
      setError('Không đo được — kiểm tra mạng rồi thử lại.');
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    run();
  }, []);

  const sorted = result ? [...result.times].sort((a, b) => a - b) : [];
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const show = (v) => (result ? v : '…');
  return html`
    <p class="note">Mở màn này trên từng trình duyệt (ví dụ Safari và Chrome) rồi so sánh. Không đọc dữ liệu sách hay hồ sơ.</p>
    ${error && html`<div class="banner banner-error me-pad" role="alert">${error}</div>`}
    <div class="group">
      <${Line} label="Trình duyệt" value=${engineLabel()} />
      <${Line} label="Phiên bản app" value=${`v${APP_VERSION}`} />
      <${Line} label="Địa chỉ server thấy" value=${show(result && result.ip)} />
      <${Line} label="Ping tới server (trung vị)" value=${show(ms(median))} />
      <${Line} label="5 lần ping" value=${show(result && result.times.join(' · '))} />
      <${Line} label="Giao thức" value=${show(result && result.protocol)} />
    </div>
    <p class="group-title">Lúc tải trang</p>
    <div class="group">
      <${Line} label="Tra DNS" value=${show(result && ms(result.pageDns))} />
      <${Line} label="Kết nối TCP" value=${show(result && ms(result.pageConnect))} />
      <${Line} label="Bắt tay TLS" value=${show(result && ms(result.pageTls))} />
      <${Line} label="Chờ phản hồi đầu" value=${show(result && ms(result.pageFirstByte))} />
    </div>
    <div class="me-pad">
      <button class="btn btn-secondary btn-block" disabled=${running} aria-busy=${running ? 'true' : null} onClick=${run}>
        ${running ? 'Đang đo…' : 'Đo lại'}
      </button>
    </div>
  `;
}
