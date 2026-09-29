// Provider quota meters for the account screen (shape: GET /api/usage, app/usage_quota.py).
// Counts are metered by this app; a provider 429 ("paused") is the only authoritative signal.
import { html } from '../../vendor/preact-htm.module.js';
import { Icon } from '../icons.js';

const NUMBER = new Intl.NumberFormat('vi-VN');
const CLOCK = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' });
// vi-VN renders day/month as "30-09"; the app writes dates as "30/09".
const dayMonth = (date) => `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;

const UNIT = { requests: 'lượt', chars: 'ký tự' };
const PERIOD = { pacific_day: 'hôm nay', utc_month: 'tháng này' };

/** "14:05" when it falls today, "14:05 ngày 30/09" otherwise. @param {string} iso */
export function formatMoment(iso, now = new Date()) {
  const date = new Date(iso);
  const clock = CLOCK.format(date);
  return date.toDateString() === now.toDateString() ? clock : `${clock} ngày ${dayMonth(date)}`;
}

/** Share of the quota already used, clamped to 0–100; null when no limit is set. */
export function usedPercent(service) {
  if (!service.limit) return null;
  return Math.min(100, Math.round((service.used / service.limit) * 100));
}

function resetNote(service) {
  return service.window === 'utc_month' ? `làm mới ngày ${dayMonth(new Date(service.resets_at))}` : `làm mới lúc ${formatMoment(service.resets_at)}`;
}

function UsageMeter({ service }) {
  const unit = UNIT[service.unit] || '';
  const percent = usedPercent(service);
  const used = NUMBER.format(service.used);
  let figure;
  if (service.status === 'unconfigured') figure = 'Chưa cấu hình';
  else if (service.remaining != null) figure = html`Còn <strong>${NUMBER.format(service.remaining)}</strong> / ${NUMBER.format(service.limit)} ${unit}`;
  else figure = html`<strong>${used}</strong> ${unit}`;

  return html`
    <article class="usage-meter" data-status=${service.status}>
      <div class="usage-head">
        <h3>${service.label}</h3>
        <span class="usage-figure">${figure}</span>
      </div>
      ${percent != null &&
      html`
        <div
          class="usage-bar"
          role="progressbar"
          aria-label=${`${service.label}: đã dùng ${percent}%`}
          aria-valuemin="0"
          aria-valuemax=${service.limit}
          aria-valuenow=${Math.min(service.used, service.limit)}
        >
          <i style=${{ width: `${percent}%` }}></i>
        </div>
      `}
      ${service.status !== 'unconfigured' &&
      html`<p class="usage-note">
        ${service.remaining != null ? `Đã dùng ${used} ${unit} ${PERIOD[service.window]}` : `Đã dùng ${PERIOD[service.window]} · chưa đặt hạn mức`} · ${resetNote(service)}
      </p>`}
      ${service.status === 'paused' &&
      html`<p class="usage-alert" role="status">
        <${Icon} name="clock" size=${14} />
        Nhà cung cấp báo hết quota — ${service.waiting_chunks} đoạn đang chờ, tự thử lại lúc ${formatMoment(service.paused_until)}
      </p>`}
      ${service.status === 'exhausted' &&
      html`<p class="usage-alert" role="status"><${Icon} name="alert-circle" size=${14} /> Đã chạm hạn mức — nhà cung cấp có thể từ chối việc mới tới lúc làm mới</p>`}
      ${service.status === 'ok' &&
      service.last_quota_at &&
      html`<p class="usage-note">Lần gần nhất bị từ chối vì quota: ${formatMoment(service.last_quota_at)}</p>`}
    </article>
  `;
}

/** @param {{ services: any[] }} props — unconfigured services with no usage are hidden. */
export function UsageMeterList({ services }) {
  const shown = services.filter((s) => s.status !== 'unconfigured' || s.used > 0);
  if (shown.length === 0) return html`<p class="text-muted">Chưa cấu hình dịch vụ nào.</p>`;
  return html`<div class="usage-list">${shown.map((s) => html`<${UsageMeter} key=${s.service} service=${s} />`)}</div>`;
}
