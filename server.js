'use strict';

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const config = require('./config');

const DATA_DIR = path.join(__dirname, 'data');
const MENU_FILE = path.join(DATA_DIR, 'menu.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const ORDERS_TMP = path.join(DATA_DIR, 'orders.json.tmp');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// ---------------------------------------------------------------------------
// منو را یک‌بار می‌خوانیم و از آن یک نگاشت id→آیتم برای اعتبارسنجی می‌سازیم.
// ---------------------------------------------------------------------------
const menu = JSON.parse(fs.readFileSync(MENU_FILE, 'utf8'));
const itemById = new Map();
for (const cat of menu.categories) {
  for (const item of cat.items) {
    itemById.set(item.id, { ...item, categoryName: cat.name });
  }
}

// ---------------------------------------------------------------------------
// ذخیره‌سازی امن سفارش‌ها
//
// تمام نوشتن‌ها از یک صف (mutex تک‌پروسه‌ای) عبور می‌کنند تا هرگز دو نوشتن
// هم‌زمان رخ ندهد. هر نوشتن: فایل موقت → fsync → rename اتمیک روی فایل اصلی.
// چون rename در POSIX اتمیک است، خواننده هیچ‌گاه فایل نیمه‌نوشته نمی‌بیند.
// ---------------------------------------------------------------------------
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function readOrdersSync() {
  try {
    const raw = fs.readFileSync(ORDERS_FILE, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    // اگر فایل به هر دلیلی خراب بود، بهتر است متوقف شویم تا رونویسی نکنیم.
    throw new Error('orders.json قابل خواندن نیست: ' + err.message);
  }
}

// وضعیت در حافظه؛ منبع حقیقت هنگام اجرا. از روی فایل بارگذاری می‌شود.
let orders = readOrdersSync();

// صف نوشتن: هر عملیات را به یک زنجیره‌ی Promise متصل می‌کنیم.
let writeChain = Promise.resolve();
function enqueueWrite(task) {
  const run = writeChain.then(task, task);
  // خطای یک نوشتن نباید زنجیره را بشکند.
  writeChain = run.catch(() => {});
  return run;
}

let backupCounter = 0;
async function persistOrders() {
  const json = JSON.stringify(orders, null, 2);
  const fh = await fsp.open(ORDERS_TMP, 'w');
  try {
    await fh.writeFile(json, 'utf8');
    await fh.sync(); // fsync: مطمئن شویم داده روی دیسک نشسته
  } finally {
    await fh.close();
  }
  await fsp.rename(ORDERS_TMP, ORDERS_FILE); // جایگزینی اتمیک

  // هر چند نوشتن یک نسخه‌ی پشتیبان چرخشی نگه می‌داریم (۱۰ نسخه).
  if (backupCounter++ % 5 === 0) {
    const slot = (backupCounter / 5) % 10 | 0;
    fsp.writeFile(path.join(BACKUP_DIR, `orders.bak${slot}.json`), json, 'utf8').catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// کمک‌تابع‌ها
// ---------------------------------------------------------------------------
function normalizeName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .replace(/‌/g, '‌') // نیم‌فاصله را حفظ کن
    .trim();
}

// کلید یکتا برای تشخیص «همان مهمان» — بی‌توجه به فاصله‌های اضافی و بزرگی حروف.
function nameKey(name) {
  return normalizeName(name).toLowerCase().replace(/\s/g, '');
}

// اعتبارسنجی و پاک‌سازی اقلام ورودی نسبت به منو.
function sanitizeItems(rawItems) {
  if (!Array.isArray(rawItems)) return { error: 'قالب سفارش نامعتبر است.' };
  const cleaned = [];
  const seen = new Set();
  for (const it of rawItems) {
    const id = Number(it && it.id);
    if (!itemById.has(id)) continue; // آیتم ناشناخته را نادیده بگیر
    if (seen.has(id)) continue;
    let qty = Math.floor(Number(it.qty));
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    if (qty > 20) qty = 20; // سقف منطقی برای یک مهمانی
    seen.add(id);
    cleaned.push({ id, qty });
  }
  return { items: cleaned };
}

// ---------------------------------------------------------------------------
// اپلیکیشن
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// --- منو ---
app.get('/api/menu', (req, res) => {
  res.json({
    title: config.partyTitle,
    subtitle: config.partySubtitle,
    categories: menu.categories,
  });
});

// --- سفارش یک مهمان (برای ورود مجدد و ویرایش) ---
app.get('/api/order', (req, res) => {
  const key = nameKey(req.query.name);
  if (!key) return res.status(400).json({ error: 'نام لازم است.' });
  const record = orders[key];
  res.json({ order: record ? { name: record.name, items: record.items, note: record.note || '' } : null });
});

// --- ثبت/به‌روزرسانی سفارش ---
app.post('/api/order', async (req, res) => {
  const body = req.body || {};
  const displayName = normalizeName(body.name);
  const key = nameKey(displayName);

  if (!key || displayName.length < 2) {
    return res.status(400).json({ error: 'لطفاً نام و نام خانوادگی خود را کامل وارد کنید.' });
  }
  const { items, error } = sanitizeItems(body.items);
  if (error) return res.status(400).json({ error });
  if (items.length === 0) {
    return res.status(400).json({ error: 'سبد سفارش شما خالی است.' });
  }

  const note = String(body.note || '').slice(0, 500).trim();

  orders[key] = {
    name: displayName,
    items,
    note,
    updatedAt: new Date().toISOString(),
  };

  try {
    await enqueueWrite(persistOrders);
  } catch (err) {
    console.error('خطای ذخیره‌سازی سفارش:', err);
    return res.status(500).json({ error: 'ثبت سفارش با خطا مواجه شد. لطفاً دوباره تلاش کنید.' });
  }
  res.json({ ok: true, name: displayName, count: items.reduce((s, i) => s + i.qty, 0) });
});

// ---------------------------------------------------------------------------
// مدیریت — گزارش‌ها (با رمز عبور)
// ---------------------------------------------------------------------------
function checkPassword(req) {
  const provided = (req.body && req.body.password) || req.get('x-admin-password') || '';
  return provided === config.adminPassword;
}

app.post('/api/admin/report', (req, res) => {
  if (!checkPassword(req)) {
    return res.status(401).json({ error: 'رمز عبور نادرست است.' });
  }

  // گزارش هر مهمان
  const guests = Object.values(orders)
    .sort((a, b) => a.name.localeCompare(b.name, 'fa'))
    .map((g) => ({
      name: g.name,
      note: g.note || '',
      updatedAt: g.updatedAt,
      items: g.items.map((i) => ({
        title: itemById.get(i.id) ? itemById.get(i.id).title : 'نامشخص',
        category: itemById.get(i.id) ? itemById.get(i.id).categoryName : '',
        qty: i.qty,
      })),
    }));

  // جمع‌بندی اقلام (بر اساس دسته)
  const totals = new Map(); // id → qty
  for (const g of Object.values(orders)) {
    for (const it of g.items) {
      totals.set(it.id, (totals.get(it.id) || 0) + it.qty);
    }
  }
  const summaryByCategory = [];
  for (const cat of menu.categories) {
    const rows = [];
    for (const item of cat.items) {
      const qty = totals.get(item.id);
      if (qty) rows.push({ title: item.title, qty });
    }
    if (rows.length) {
      rows.sort((a, b) => b.qty - a.qty);
      summaryByCategory.push({ category: cat.name, rows });
    }
  }

  const totalGuests = guests.length;
  const totalItems = [...totals.values()].reduce((s, q) => s + q, 0);

  res.json({ generatedAt: new Date().toISOString(), totalGuests, totalItems, guests, summaryByCategory });
});

app.listen(config.port, () => {
  console.log(`\n  ${config.partyTitle}`);
  console.log(`  سایت روی http://localhost:${config.port} اجرا شد`);
  console.log(`  صفحه‌ی مدیریت: http://localhost:${config.port}/admin  (رمز: ${config.adminPassword === 'mehmooni' ? 'mehmooni  ← حتماً تغییر دهید!' : '••••••'})\n`);
});
