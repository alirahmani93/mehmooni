// پیکربندی سایت — مقادیر را با متغیرهای محیطی (environment variables) می‌توان بازنویسی کرد.
module.exports = {
  // پورتی که سرور روی آن اجرا می‌شود
  port: process.env.PORT || 4123,

  // رمز عبور صفحه‌ی مدیریت (/admin). حتماً پیش از مهمانی این را تغییر دهید:
  //   ADMIN_PASSWORD=یک-رمز-قوی node server.js
  adminPassword: process.env.ADMIN_PASSWORD || 'mehmooni',

  // عنوان مهمانی که در بالای سایت نمایش داده می‌شود.
  // اگر خالی باشد، خط عنوان اصلاً نمایش داده نمی‌شود (فقط زیرعنوان می‌ماند).
  partyTitle: process.env.PARTY_TITLE || '',
  partySubtitle: process.env.PARTY_SUBTITLE || 'سفارش شام خود را از قبل ثبت کنید',
};
