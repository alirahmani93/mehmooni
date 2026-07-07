'use strict';

const $ = (s) => document.querySelector(s);
const faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const toFa = (n) => String(n).replace(/\d/g, (d) => faDigits[d]);

// جلوگیری از XSS: نام و توضیح مهمان ورودی کاربر است و باید escape شود.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function faTime(iso) {
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric',
    }).format(new Date(iso));
  } catch (_) {
    return '';
  }
}

let currentPw = sessionStorage.getItem('adminPw') || '';
let lastData = null;

async function fetchReport(pw) {
  const res = await fetch('/api/admin/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'خطا');
  return data;
}

function renderSummary(data) {
  const el = $('#tab-summary');
  if (!data.summaryByCategory.length) {
    el.innerHTML = '<div class="empty-cart">هنوز هیچ سفارشی ثبت نشده است.</div>';
    return;
  }
  el.innerHTML = data.summaryByCategory
    .map(
      (cat) => `
      <div class="sum-cat">${esc(cat.category)}</div>
      ${cat.rows
        .map(
          (r) => `<div class="sum-row"><span>${toFa(esc(r.title))}</span><span class="q">${toFa(r.qty)} عدد</span></div>`
        )
        .join('')}`
    )
    .join('');
}

function renderGuests(data) {
  const el = $('#tab-guests');
  if (!data.guests.length) {
    el.innerHTML = '<div class="empty-cart">هنوز هیچ سفارشی ثبت نشده است.</div>';
    return;
  }
  el.innerHTML = data.guests
    .map(
      (g) => `
      <div class="card">
        <div class="guest-head">
          <span class="gname">${esc(g.name)}</span>
          <span class="gtime">${faTime(g.updatedAt)}</span>
        </div>
        <ul class="guest-items">
          ${g.items
            .map(
              (it) =>
                `<li><span>${toFa(esc(it.title))} <small style="color:var(--ink-faint)">(${esc(it.category)})</small></span><span class="qbadge">${toFa(it.qty)}</span></li>`
            )
            .join('')}
        </ul>
        ${g.note ? `<div class="gnote">📝 ${esc(g.note)}</div>` : ''}
      </div>`
    )
    .join('');
}

function render(data) {
  lastData = data;
  $('#stat-guests').textContent = toFa(data.totalGuests);
  $('#stat-items').textContent = toFa(data.totalItems);
  $('#stat-time').textContent = faTime(data.generatedAt);
  renderSummary(data);
  renderGuests(data);
}

// ساخت نسخه‌ی متنی ساده برای ارسال به رستوران
function buildText(data) {
  const L = [];
  L.push('=== جمع‌بندی اقلام سفارش‌شده ===');
  for (const cat of data.summaryByCategory) {
    L.push('\n[' + cat.category + ']');
    for (const r of cat.rows) L.push(`  ${toFa(r.title)} — ${toFa(r.qty)} عدد`);
  }
  L.push('\n\n=== سفارش هر مهمان ===');
  for (const g of data.guests) {
    L.push('\n• ' + g.name + ':');
    for (const it of g.items) L.push(`   - ${toFa(it.title)} × ${toFa(it.qty)}`);
    if (g.note) L.push('   📝 ' + g.note);
  }
  L.push(`\n\nمجموع: ${toFa(data.totalGuests)} مهمان، ${toFa(data.totalItems)} قلم.`);
  return L.join('\n');
}

async function load(pw) {
  const data = await fetchReport(pw);
  currentPw = pw;
  sessionStorage.setItem('adminPw', pw);
  $('#login').classList.add('hidden');
  $('#report').classList.remove('hidden');
  render(data);
}

// ---------- رویدادها ----------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('#pw').value;
  $('#login-err').textContent = '';
  try {
    await load(pw);
  } catch (err) {
    $('#login-err').textContent = err.message || 'ورود ناموفق بود';
  }
});

$('#btn-refresh').addEventListener('click', async () => {
  try {
    render(await fetchReport(currentPw));
  } catch (err) {
    alert(err.message);
  }
});

$('#btn-print').addEventListener('click', () => window.print());

$('#btn-copy').addEventListener('click', async () => {
  if (!lastData) return;
  try {
    await navigator.clipboard.writeText(buildText(lastData));
    $('#btn-copy').textContent = '✓ کپی شد';
    setTimeout(() => ($('#btn-copy').textContent = '📋 کپی متن'), 1500);
  } catch (_) {
    alert('کپی ناموفق بود. متن در کنسول چاپ شد.');
    console.log(buildText(lastData));
  }
});

document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    $('#tab-summary').classList.toggle('hidden', tab !== 'summary');
    $('#tab-guests').classList.toggle('hidden', tab !== 'guests');
  });
});

// اگر رمز در نشست ذخیره شده، خودکار وارد شو
if (currentPw) {
  load(currentPw).catch(() => {
    sessionStorage.removeItem('adminPw');
    currentPw = '';
  });
}
