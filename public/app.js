'use strict';

// ---------- کمک‌تابع‌ها ----------
const $ = (sel) => document.querySelector(sel);
const faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const toFa = (n) => String(n).replace(/\d/g, (d) => faDigits[d]);
const FALLBACK_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#f4ece1"/><text x="60" y="70" font-size="44" text-anchor="middle" fill="#c9b7a3">🍽️</text></svg>'
  );

// ---------- وضعیت ----------
const state = {
  name: localStorage.getItem('guestName') || '',
  menu: null,
  itemById: new Map(),
  cart: new Map(), // id → qty
  note: '',
};

// ---------- ابزار توست ----------
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// ---------- ناوبری بین صفحه‌ها ----------
function show(screen) {
  ['screen-gate', 'screen-menu', 'screen-done'].forEach((id) => {
    $('#' + id).classList.toggle('hidden', id !== screen);
  });
  $('#cartbar').classList.toggle('hidden', screen !== 'screen-menu');
  $('#who').classList.toggle('hidden', screen === 'screen-gate');
  window.scrollTo(0, 0);
}

// ---------- بارگذاری منو ----------
async function loadMenu() {
  const res = await fetch('/api/menu');
  const data = await res.json();
  state.menu = data;
  // عنوان: اگر خالی باشد، خط عنوان را پنهان می‌کنیم و فقط زیرعنوان می‌ماند
  const title = (data.title || '').trim();
  const titleEl = $('#party-title');
  if (title) {
    titleEl.textContent = title;
    titleEl.style.display = '';
    document.title = title + ' — سفارش شام';
  } else {
    titleEl.style.display = 'none';
    document.title = 'سفارش شام';
  }
  // زیرعنوان: با «\n» (یا خط جدید) به چند خط تقسیم می‌شود
  const subEl = $('#party-sub');
  subEl.textContent = '';
  (data.subtitle || '')
    .split(/\\n|\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((part, i) => {
      if (i) subEl.appendChild(document.createElement('br'));
      subEl.appendChild(document.createTextNode(part));
    });
  for (const cat of data.categories) {
    for (const it of cat.items)
      state.itemById.set(it.id, { ...it, categoryName: cat.name, categoryId: cat.id, categoryEn: cat.en });
  }
  renderMenu();
}

function imgTag(src, cls) {
  const safe = src || FALLBACK_IMG;
  return `<img class="${cls}" loading="lazy" src="${safe}" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'" alt="">`;
}

function renderMenu() {
  const nav = $('#catnav');
  const list = $('#menu-list');
  $('#menu-loading').classList.add('hidden');
  nav.classList.remove('hidden');

  nav.innerHTML = state.menu.categories
    .map((c) => `<button data-cat="cat-${c.id}">${c.name}</button>`)
    .join('');

  list.innerHTML = state.menu.categories
    .map(
      (c) => `
    <div class="cat-section" id="cat-${c.id}">
      <div class="cat-head">
        ${imgTag(c.pic, 'cat-thumb')}
        <h3>${c.name}</h3>
        <span class="count">${toFa(c.items.length)} مورد</span>
      </div>
      ${c.items.map((it) => itemCard(it)).join('')}
    </div>`
    )
    .join('');

  // ناوبری دسته‌ها
  nav.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.cat);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // فعال‌سازی دسته‌ی جاری هنگام اسکرول
  const sections = state.menu.categories.map((c) => document.getElementById('cat-' + c.id));
  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          nav.querySelectorAll('button').forEach((b) =>
            b.classList.toggle('active', b.dataset.cat === e.target.id)
          );
        }
      });
    },
    { rootMargin: '-45% 0px -50% 0px' }
  );
  sections.forEach((s) => s && obs.observe(s));

  refreshAllControls();
  updateCartBar();
}

function itemCard(it) {
  const desc = it.desc ? `<p class="item-desc">${toFa(it.desc)}</p>` : '';
  return `
    <div class="item" data-item="${it.id}">
      ${imgTag(it.pic, 'item-thumb')}
      <div class="item-body">
        <div class="item-title">${toFa(it.title)}</div>
        ${desc}
        <div class="item-actions" data-control="${it.id}"></div>
      </div>
    </div>`;
}

// کنترل افزودن/استپر برای هر آیتم را بر اساس تعداد در سبد می‌سازد
function controlHTML(id) {
  const qty = state.cart.get(id) || 0;
  if (qty === 0) {
    return `<button class="add-btn" data-add="${id}">افزودن +</button>`;
  }
  return `
    <div class="stepper">
      <button data-dec="${id}" aria-label="کاهش">−</button>
      <span class="qty">${toFa(qty)}</span>
      <button data-inc="${id}" aria-label="افزایش">+</button>
    </div>`;
}

function refreshControl(id) {
  document.querySelectorAll(`[data-control="${id}"]`).forEach((el) => {
    el.innerHTML = controlHTML(id);
  });
}
function refreshAllControls() {
  document.querySelectorAll('[data-control]').forEach((el) => {
    el.innerHTML = controlHTML(Number(el.dataset.control));
  });
}

function setQty(id, qty) {
  if (qty <= 0) state.cart.delete(id);
  else state.cart.set(id, Math.min(qty, 20));
  refreshControl(id);
  updateCartBar();
}

function updateCartBar() {
  const total = [...state.cart.values()].reduce((s, q) => s + q, 0);
  $('#cart-count').textContent = toFa(total);
  const bar = $('#view-order');
  bar.disabled = total === 0;
  bar.style.opacity = total === 0 ? '0.65' : '1';
}

// ---------- شیت مرور سفارش ----------
function openSheet() {
  // یادآوری هر بار که شیت باز می‌شود از نو ارزیابی می‌شود
  state.reminderAck = false;
  $('#reminder').classList.add('hidden');
  const lines = $('#sheet-lines');
  if (state.cart.size === 0) {
    lines.innerHTML = '<div class="empty-cart">هنوز چیزی انتخاب نکرده‌اید.</div>';
    $('#confirm-order').disabled = true;
    $('#note-wrap').classList.add('hidden');
  } else {
    $('#confirm-order').disabled = false;
    $('#note-wrap').classList.remove('hidden');
    lines.innerHTML = [...state.cart.entries()]
      .map(([id, qty]) => {
        const it = state.itemById.get(id);
        if (!it) return '';
        return `
        <div class="line" data-line="${id}">
          ${imgTag(it.pic, '')}
          <div class="l-body">
            <div class="l-title">${toFa(it.title)}</div>
            <div class="l-cat">${it.categoryName}</div>
          </div>
          <div class="stepper">
            <button data-dec="${id}" aria-label="کاهش">−</button>
            <span class="qty">${toFa(qty)}</span>
            <button data-inc="${id}" aria-label="افزایش">+</button>
          </div>
        </div>`;
      })
      .join('');
  }
  $('#note-input').value = state.note;
  $('#sheet-backdrop').classList.add('open');
}
function closeSheet() {
  $('#sheet-backdrop').classList.remove('open');
}

// وقتی داخل شیت تعداد تغییر کند، اگر آیتمی صفر شد، خط آن حذف می‌شود
function syncSheetLine(id) {
  const line = document.querySelector(`[data-line="${id}"]`);
  const qty = state.cart.get(id) || 0;
  if (!line) return;
  if (qty === 0) {
    line.remove();
    if (state.cart.size === 0) openSheet(); // نمایش حالت خالی
  } else {
    line.querySelector('.qty').textContent = toFa(qty);
  }
}

// ---------- یادآوری ملایم نوشیدنی/پیش‌غذا ----------
function findCat(en) {
  return state.menu.categories.find((c) => c.en && c.en.toLowerCase() === en.toLowerCase());
}

// دسته‌هایی (نوشیدنی/پیش‌غذا) که مهمان هیچ آیتمی از آن‌ها انتخاب نکرده است
function missingSuggestions() {
  const orderedCats = new Set(
    [...state.cart.keys()].map((id) => {
      const it = state.itemById.get(id);
      return it && it.categoryId;
    })
  );
  const out = [];
  const drink = findCat('Beverages');
  const appetizer = findCat('Appetizer');
  if (drink && !orderedCats.has(drink.id)) out.push({ label: 'نوشیدنی', catId: drink.id });
  if (appetizer && !orderedCats.has(appetizer.id)) out.push({ label: 'پیش‌غذا', catId: appetizer.id });
  return out;
}

function showReminder(missing) {
  const names = missing.map((m) => m.label).join(' و ');
  const el = $('#reminder');
  el.innerHTML = `
    <div class="reminder-text">راستی، هنوز ${names} انتخاب نکرده‌اید. اگر دوست دارید، می‌توانید آن را هم کنار غذایتان به سفارش اضافه کنید.</div>
    <div class="reminder-actions">
      <button class="remind-add" data-jump="${missing[0].catId}">مشاهده و افزودن</button>
      <button class="remind-skip">همین خوب است، ثبت کن</button>
    </div>`;
  el.classList.remove('hidden');
  el.querySelector('.remind-add').addEventListener('click', () => {
    closeSheet();
    const target = document.getElementById('cat-' + missing[0].catId);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  el.querySelector('.remind-skip').addEventListener('click', doSubmit);
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------- ثبت سفارش ----------
// روی «ثبت نهایی» — اگر نوشیدنی/پیش‌غذا نبود، یک‌بار یادآوری ملایم می‌کند و بعد ثبت.
function confirmOrder() {
  if (state.cart.size === 0) return;
  const missing = missingSuggestions();
  if (missing.length && !state.reminderAck) {
    state.reminderAck = true; // فقط یک‌بار در هر باز شدن شیت
    showReminder(missing);
    return;
  }
  doSubmit();
}

async function doSubmit() {
  const items = [...state.cart.entries()].map(([id, qty]) => ({ id, qty }));
  if (items.length === 0) return;
  state.note = $('#note-input').value.trim();
  const btn = $('#confirm-order');
  btn.disabled = true;
  btn.textContent = 'در حال ثبت…';
  try {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: state.name, items, note: state.note }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'خطا در ثبت سفارش');
    closeSheet();
    $('#done-name').textContent = state.name;
    show('screen-done');
  } catch (err) {
    toast(err.message || 'ثبت سفارش با خطا مواجه شد.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'ثبت نهایی سفارش';
  }
}

// ---------- ورود نام و بارگذاری سفارش قبلی ----------
async function enterWithName(name) {
  state.name = name;
  localStorage.setItem('guestName', name);
  $('#who-name').textContent = name;

  // اگر این مهمان قبلاً سفارش داده، آن را بارگذاری کن
  try {
    const res = await fetch('/api/order?name=' + encodeURIComponent(name));
    const data = await res.json();
    state.cart.clear();
    if (data.order && Array.isArray(data.order.items)) {
      for (const it of data.order.items) {
        if (state.itemById.has(it.id)) state.cart.set(it.id, it.qty);
      }
      state.note = data.order.note || '';
      if (state.cart.size) toast('سفارش قبلی شما بارگذاری شد');
    }
  } catch (_) {}

  refreshAllControls();
  updateCartBar();
  show('screen-menu');
}

// ---------- رویدادها ----------
function wire() {
  $('#name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#name-input').value.replace(/\s+/g, ' ').trim();
    if (name.length < 2) {
      toast('لطفاً نام کامل خود را وارد کنید');
      return;
    }
    enterWithName(name);
  });

  $('#change-name').addEventListener('click', () => {
    $('#name-input').value = state.name;
    show('screen-gate');
  });

  // افزودن/استپر — با واگذاری رویداد (event delegation)
  document.body.addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.add) {
      setQty(Number(t.dataset.add), 1);
      toast('به سفارش اضافه شد');
    } else if (t.dataset.inc) {
      const id = Number(t.dataset.inc);
      setQty(id, (state.cart.get(id) || 0) + 1);
      syncSheetLine(id);
    } else if (t.dataset.dec) {
      const id = Number(t.dataset.dec);
      setQty(id, (state.cart.get(id) || 0) - 1);
      syncSheetLine(id);
    }
  });

  $('#view-order').addEventListener('click', openSheet);
  $('#close-sheet').addEventListener('click', closeSheet);
  $('#sheet-backdrop').addEventListener('click', (e) => {
    if (e.target === $('#sheet-backdrop')) closeSheet();
  });
  $('#confirm-order').addEventListener('click', confirmOrder);

  $('#edit-again').addEventListener('click', () => {
    show('screen-menu');
    openSheet();
  });
  $('#done-menu').addEventListener('click', () => show('screen-menu'));
}

// ---------- شروع ----------
(async function init() {
  wire();
  await loadMenu();
  if (state.name) {
    $('#name-input').value = state.name;
    await enterWithName(state.name);
  } else {
    show('screen-gate');
  }
})();
