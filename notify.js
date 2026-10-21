// يرسل ملخصًا يوميًا بالإيميل لموظفي التسويق (يُشغَّل من GitHub Actions)
const BIN = '6ad77431ac6210605a426c45';
const TZ = 'Asia/Riyadh';
const ADMIN = { email: 'malik.khaleel@kuzama.co', name: 'مالك خليل', admin: true };
const DEFAULT_BRANDS = [{ id: 'karazah', label: 'كرزة' }, { id: 'cloud', label: 'المطاعم السحابية' }, { id: 'shahan', label: 'شاهان' }];
const ymd = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function collect(DB, today) {
  const brands = (DB.brandList && DB.brandList.length) ? DB.brandList : DEFAULT_BRANDS;
  const soon = addDays(today, 3);
  const out = {}; // brandId -> {now:[], soon:[]}
  const shared = { now: [], soon: [] };
  const put = (box, date, icon, text) => {
    if (!date) return;
    if (date === today) box.now.push({ icon, text, date });
    else if (date > today && date <= soon) box.soon.push({ icon, text, date });
  };
  (DB.sharedPlans || []).forEach(p => {
    put(shared, p.prep, '🛠', 'بدأ التحضير: ' + p.title);
    put(shared, p.due, '🚀', 'بدأ تنفيذ: ' + p.title);
    if (p.end && p.end !== p.due) put(shared, p.end, '🏁', 'آخر يوم تنفيذ: ' + p.title);
  });
  brands.forEach(b => {
    const B = (DB.brands || {})[b.id] || {}, box = out[b.id] = { label: b.label, now: [], soon: [] };
    (B.plans || []).forEach(p => {
      put(box, p.prep, '🛠', 'بدأ التحضير: ' + p.title);
      put(box, p.due, '🚀', 'بدأ تنفيذ: ' + p.title);
      if (p.end && p.end !== p.due) put(box, p.end, '🏁', 'آخر يوم تنفيذ: ' + p.title);
    });
    (B.campaigns || []).forEach(c => put(box, c.start || c.date, '📣', 'بدأت حملة «' + c.name + '»' + (c.platform ? ' — ' + c.platform : '')));
    (B.posts || []).forEach(p => put(box, p.date, '🗓', (p.status === 'sent' ? 'نُشر منشور: ' : 'منشور مجدول: ') + p.text));
  });
  return { out, shared };
}

function digestFor(user, col) {
  const ids = user.admin ? Object.keys(col.out) : (user.brands || []).filter(id => col.out[id]);
  const sections = [];
  const sec = (title, box) => { if (box.now.length || box.soon.length) sections.push({ title, box }) };
  sec('كل البراندات (الخطة السنوية)', col.shared);
  ids.forEach(id => sec(col.out[id].label, col.out[id]));
  if (!sections.length) return null;
  const list = (arr, label) => arr.length ? `<div style="font-weight:700;margin:8px 0 4px">${label}</div>` + arr.map(e => `<div style="padding:5px 0;border-bottom:1px solid #eef2f4">${e.icon} ${esc(e.text)}${label.startsWith('قادم') ? ` <span style="color:#64757e">(${e.date})</span>` : ''}</div>`).join('') : '';
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:640px;margin:auto;color:#16262f">
  <h2 style="color:#023f5e;border-bottom:3px solid #023f5e;padding-bottom:8px">ملخص منصة التسويق</h2>
  <p>مرحبًا ${esc(user.name || '')}، هذا ملخص اليوم والأيام القادمة:</p>` +
    sections.map(s => `<h3 style="color:#023f5e;margin:18px 0 4px">${esc(s.title)}</h3>${list(s.box.now, 'اليوم')}${list(s.box.soon, 'قادم خلال 3 أيام')}`).join('') +
    `<p style="margin-top:20px"><a href="https://brandkuzama-droid.github.io/marketing-hub/">فتح المنصة</a></p></div>`;
  return { html, count: sections.reduce((n, s) => n + s.box.now.length + s.box.soon.length, 0) };
}

async function main() {
  const today = process.env.TODAY || ymd(new Date());
  const r = await fetch('https://api.jsonbin.io/v3/b/' + BIN + '/latest', { headers: { 'X-Master-Key': process.env.JSONBIN_KEY } });
  if (!r.ok) throw new Error('JSONBin HTTP ' + r.status);
  const DB = (await r.json()).record || {};
  const col = collect(DB, today);
  const users = [ADMIN, ...(DB.users || []).filter(u => u.email)];
  const dry = process.env.DRY === '1';
  let tr = null;
  if (!dry) {
    const nodemailer = require('nodemailer');
    tr = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
  }
  let sent = 0;
  for (const u of users) {
    const d = digestFor(u, col);
    if (!d) continue;
    if (dry) { console.log('[dry]', u.email, d.count, 'items'); continue; }
    await tr.sendMail({ from: '"منصة التسويق" <' + process.env.GMAIL_USER + '>', to: u.email, subject: 'ملخص منصة التسويق — ' + today, html: d.html });
    sent++; console.log('sent to', u.email, d.count);
  }
  console.log('done', today, 'emails:', sent);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1) });
module.exports = { collect, digestFor };
