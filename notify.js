// يرسل ملخصًا يوميًا بالإيميل لموظفي التسويق (يُشغَّل من GitHub Actions)
const BIN = '6ad77431ac6210605a426c45';
const TZ = 'Asia/Riyadh';
const ADMIN = { email: 'malik.khaleel@kuzama.co', name: 'مالك خليل', admin: true };
const DEFAULT_BRANDS = [{ id: 'karazah', label: 'كرزة' }, { id: 'cloud', label: 'المطاعم السحابية' }, { id: 'shahan', label: 'شاهان' }];
const ymd = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));


const TT_RULES = [
  { brand: 'cloud', sub: 'شهبار', kw: ['شهبار', 'shahbar', 'shahbr'] },
  { brand: 'cloud', sub: 'ورق عنب عبلة', kw: ['ورق عنب', 'ورق العنب'] },
  { brand: 'karazah', kw: ['كرزة', 'الجاذرينج', 'الجاذرينغ', 'فطور', 'غداء', 'عشاء', 'سحور', 'مؤثرين', 'بلوجر', 'البلوجر', 'عيد', 'كرمبلد', 'رمضان', 'ramadan', 'brek', 'منشورات الحساب', 'مقاطع', 'erani menu', 'ramdan', 'video views', 'mofrznat'] }
];
const ttMatch = name => { const n = String(name || '').toLowerCase(); return TT_RULES.find(r => r.kw.some(w => n.includes(w.toLowerCase()))) || null };
const fmt = (n, d = 0) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: d });

async function windsor(conn, from, to) {
  const u = 'https://connectors.windsor.ai/' + conn + '?api_key=' + encodeURIComponent(process.env.WINDSOR_KEY) + '&date_from=' + from + '&date_to=' + to + '&fields=campaign,spend,impressions,clicks,date';
  const r = await fetch(u, { signal: AbortSignal.timeout(600000) });
  if (!r.ok) throw new Error(conn + ' HTTP ' + r.status);
  const j = await r.json();
  return j.data || [];
}

// يرجع { brandId: { ydate, y:{spend,imp,clk,camps:[{name,spend,imp,clk}]}, m:{spend,imp,clk} } }
async function adStats(today) {
  const y = addDays(today, -1), mStart = today.slice(0, 8) + '01';
  const from = y < mStart ? addDays(mStart, -1) : mStart; // لو اليوم أول الشهر نجيب الشهر السابق لأمس فقط
  const res = {}; const notes = [];
  const add = (bid, name, d, r) => {
    const b = res[bid] = res[bid] || { ydate: y, y: { spend: 0, imp: 0, clk: 0, camps: {} }, m: { spend: 0, imp: 0, clk: 0 } };
    const sp = +r.spend || 0, im = +r.impressions || 0, ck = +r.clicks || 0;
    if (d >= mStart && d <= y) { b.m.spend += sp; b.m.imp += im; b.m.clk += ck }
    if (d === y) { b.y.spend += sp; b.y.imp += im; b.y.clk += ck; const c = b.y.camps[name] = b.y.camps[name] || { spend: 0, imp: 0, clk: 0 }; c.spend += sp; c.imp += im; c.clk += ck }
  };
  try { (await windsor('facebook', from, y)).forEach(r => r.campaign && add('karazah', r.campaign, r.date, r)) } catch (e) { notes.push('Meta: ' + e.message) }
  try { (await windsor('tiktok', from, y)).forEach(r => { const rule = r.campaign && ttMatch(r.campaign); if (rule) add(rule.brand, r.campaign.trim(), r.date, r) }) } catch (e) { notes.push('TikTok: ' + e.message) }
  return { res, notes };
}

function collect(DB, today) {
  const brands = (DB.brandList && DB.brandList.length) ? DB.brandList : DEFAULT_BRANDS;
  const soon = addDays(today, 3);
  const out = {}; // brandId -> {now:[], soon:[]}
  const shared = { now: [], soon: [], alerts: [] };
  const back = addDays(today, -60);
  const late = (box, p) => { const e = p.end || p.due; if (p.status !== 'done' && e && e < today && e >= back) box.alerts.push({ icon: '⏰', text: 'متأخر: ' + p.title + ' (انتهى ' + e + ')' }) };
  const put = (box, date, icon, text) => {
    if (!date) return;
    if (date === today) box.now.push({ icon, text, date });
    else if (date > today && date <= soon) box.soon.push({ icon, text, date });
  };
  (DB.sharedPlans || []).forEach(p => {
    late(shared, p);
    put(shared, p.prep, '🛠', 'بدأ التحضير: ' + p.title);
    put(shared, p.due, '🚀', 'بدأ تنفيذ: ' + p.title);
    if (p.end && p.end !== p.due) put(shared, p.end, '🏁', 'آخر يوم تنفيذ: ' + p.title);
  });
  brands.forEach(b => {
    const B = (DB.brands || {})[b.id] || {}, box = out[b.id] = { label: b.label, now: [], soon: [], alerts: [] };
    (B.plans || []).forEach(p => {
      late(box, p);
      put(box, p.prep, '🛠', 'بدأ التحضير: ' + p.title);
      put(box, p.due, '🚀', 'بدأ تنفيذ: ' + p.title);
      if (p.end && p.end !== p.due) put(box, p.end, '🏁', 'آخر يوم تنفيذ: ' + p.title);
    });
    (B.campaigns || []).forEach(c => { const bu = +c.budget || 0, sp = +c.spend || 0; if (bu > 0 && sp >= bu * 0.8) box.alerts.push({ icon: sp >= bu ? '⛔' : '⚠️', text: 'ميزانية «' + c.name + '»: صرف ' + fmt(sp) + ' من ' + fmt(bu) }); });
    (B.campaigns || []).forEach(c => put(box, c.start || c.date, '📣', 'بدأت حملة «' + c.name + '»' + (c.platform ? ' — ' + c.platform : '')));
    (B.posts || []).forEach(p => put(box, p.date, '🗓', (p.status === 'sent' ? 'نُشر منشور: ' : 'منشور مجدول: ') + p.text));
  });
  return { out, shared };
}

function digestFor(user, col, stats) {
  const ids = user.admin ? Object.keys(col.out) : (user.brands || []).filter(id => col.out[id]);
  const sections = [];
  const sec = (title, box) => { if (box.now.length || box.soon.length || box.alerts.length) sections.push({ title, box }) };
  sec('كل البراندات (الخطة السنوية)', col.shared);
  ids.forEach(id => sec(col.out[id].label, col.out[id]));
  const adIds = ids.filter(id => stats && stats.res[id] && (stats.res[id].y.spend || stats.res[id].m.spend));
  if (!sections.length && !adIds.length) return null;
  const list = (arr, label) => arr.length ? `<div style="font-weight:700;margin:8px 0 4px">${label}</div>` + arr.map(e => `<div style="padding:5px 0;border-bottom:1px solid #eef2f4">${e.icon} ${esc(e.text)}${label.startsWith('قادم') ? ` <span style="color:#64757e">(${e.date})</span>` : ''}</div>`).join('') : '';

  const adHtml = adIds.length ? '<h2 style="color:#023f5e;margin:22px 0 6px">📊 تحديث الحملات الإعلانية</h2>' + adIds.map(id => {
    const a = stats.res[id], top = Object.entries(a.y.camps).sort((p, q) => q[1].spend - p[1].spend).filter(x => x[1].spend > 0).slice(0, 6);
    return `<h3 style="color:#023f5e;margin:14px 0 4px">${esc(col.out[id] ? col.out[id].label : id)}</h3>
    <div style="background:#f5f8fa;border-radius:8px;padding:10px">أمس (${a.ydate}): <b>صرف ${fmt(a.y.spend)}</b> · ظهور ${fmt(a.y.imp)} · نقرات ${fmt(a.y.clk)}<br>من بداية الشهر: <b>صرف ${fmt(a.m.spend)}</b> · ظهور ${fmt(a.m.imp)} · نقرات ${fmt(a.m.clk)}</div>` +
      (top.length ? '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px"><tr style="color:#64757e"><td>الحملة</td><td>صرف أمس</td><td>ظهور</td><td>نقرات</td></tr>' + top.map(([n, c]) => `<tr><td style="padding:4px 0;border-top:1px solid #eef2f4">${esc(n)}</td><td>${fmt(c.spend)}</td><td>${fmt(c.imp)}</td><td>${fmt(c.clk)}</td></tr>`).join('') + '</table>' : '');
  }).join('') + (stats.notes.length ? `<p style="color:#b45309;font-size:12px">ملاحظة: ${esc(stats.notes.join(' | '))}</p>` : '') : '';
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:640px;margin:auto;color:#16262f">
  <h2 style="color:#023f5e;border-bottom:3px solid #023f5e;padding-bottom:8px">ملخص منصة التسويق</h2>
  <p>مرحبًا ${esc(user.name || '')}، هذا ملخص اليوم والأيام القادمة:</p>` +
    adHtml + sections.map(s => `<h3 style="color:#023f5e;margin:18px 0 4px">${esc(s.title)}</h3>${list(s.box.alerts, 'تنبيهات')}${list(s.box.now, 'اليوم')}${list(s.box.soon, 'قادم خلال 3 أيام')}`).join('') +
    `<p style="margin-top:20px"><a href="https://brandkuzama-droid.github.io/marketing-hub/">فتح المنصة</a></p></div>`;
  return { html, count: sections.reduce((n, s) => n + s.box.now.length + s.box.soon.length + s.box.alerts.length, 0) + adIds.length };
}

function monthReport(DB, ym) {
  const brands = (DB.brandList && DB.brandList.length) ? DB.brandList : DEFAULT_BRANDS;
  const ms = ym + '-01', me = ym + '-31';
  let h = '';
  brands.forEach(b => {
    const B = (DB.brands || {})[b.id] || {};
    const camps = (B.campaigns || []).filter(c => { const a = c.start || c.date || '', e = c.end || c.date || ''; return a && a <= me && e >= ms });
    const k = camps.reduce((o, c) => { o.sp += +c.spend || 0; o.im += +c.impressions || 0; o.ck += +c.clicks || 0; o.rs += +c.results || 0; o.rv += +c.revenue || 0; return o }, { sp: 0, im: 0, ck: 0, rs: 0, rv: 0 });
    const posts = (B.posts || []).filter(p => (p.date || '').slice(0, 7) === ym && p.status === 'sent').length;
    const plans = (B.plans || []).concat(DB.sharedPlans || []).filter(p => (p.due || '').slice(0, 7) === ym);
    if (!camps.length && !posts && !plans.length) return;
    const top = camps.slice().sort((x, y) => (+y.spend || 0) - (+x.spend || 0)).slice(0, 5);
    h += `<h3 style="color:#023f5e;margin:18px 0 4px">${esc(b.label)}</h3><div style="background:#f5f8fa;border-radius:8px;padding:10px">${camps.length} حملة · صرف <b>${fmt(k.sp)}</b> · ظهور ${fmt(k.im)} · نقرات ${fmt(k.ck)} · نتائج ${fmt(k.rs)}${k.rv ? ' · إيراد ' + fmt(k.rv) + ' · ROAS ' + fmt(k.sp ? k.rv / k.sp : 0, 2) + 'x' : ''}<br>منشورات منشورة: ${posts} · بنود الخطة: ${plans.filter(p => p.status === 'done').length} مكتمل من ${plans.length}</div>` +
      (top.length ? '<table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:13px"><tr style="color:#64757e"><td>أعلى الحملات</td><td>صرف</td><td>نتائج</td></tr>' + top.map(c => `<tr><td style="padding:4px 0;border-top:1px solid #eef2f4">${esc(c.name)}</td><td>${fmt(c.spend)}</td><td>${fmt(c.results)}</td></tr>`).join('') + '</table>' : '');
  });
  return h ? `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:640px;margin:auto;color:#16262f"><h2 style="color:#023f5e;border-bottom:3px solid #023f5e;padding-bottom:8px">التقرير الشهري — ${ym}</h2>${h}<p style="margin-top:20px"><a href="https://brandkuzama-droid.github.io/marketing-hub/">فتح المنصة</a></p></div>` : null;
}

async function main() {
  const today = process.env.TODAY || ymd(new Date());
  const r = await fetch('https://api.jsonbin.io/v3/b/' + BIN + '/latest', { headers: { 'X-Master-Key': process.env.JSONBIN_KEY } });
  if (!r.ok) throw new Error('JSONBin HTTP ' + r.status);
  const DB = (await r.json()).record || {};
  const col = collect(DB, today);
  const stats = process.env.WINDSOR_KEY ? await adStats(today) : null;
  const users = [ADMIN, ...(DB.users || []).filter(u => u.email)];
  const dry = process.env.DRY === '1';
  let tr = null;
  if (!dry) {
    const nodemailer = require('nodemailer');
    tr = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
  }
  let sent = 0;
  for (const u of users) {
    const d = digestFor(u, col, stats);
    if (!d) continue;
    if (dry) { console.log('[dry]', u.email, d.count, 'items'); continue; }
    await tr.sendMail({ from: '"منصة التسويق" <' + process.env.GMAIL_USER + '>', to: u.email, subject: 'ملخص منصة التسويق — ' + today, html: d.html });
    sent++; console.log('sent to', u.email, d.count);
  }
  // تقرير الشهر السابق (أول يوم من الشهر) — يوصل للمدير فقط
  if (today.endsWith('-01') || process.env.MONTHLY === '1') {
    const prev = addDays(today.slice(0, 8) + '01', -1).slice(0, 7), rep = monthReport(DB, prev);
    if (rep && !dry) { await tr.sendMail({ from: '"منصة التسويق" <' + process.env.GMAIL_USER + '>', to: ADMIN.email, subject: 'التقرير الشهري — ' + prev, html: rep }); console.log('monthly report sent', prev) }
    else console.log('monthly report', rep ? 'dry' : 'empty');
  }
  // نسخة احتياطية أسبوعية (الجمعة) للمدير
  const dow = new Date(today + 'T12:00:00Z').getUTCDay();
  if (dow === 5 || process.env.BACKUP === '1') {
    if (!dry) { await tr.sendMail({ from: '"منصة التسويق" <' + process.env.GMAIL_USER + '>', to: ADMIN.email, subject: 'نسخة احتياطية — منصة التسويق ' + today, text: 'مرفق نسخة من بيانات المنصة (JSON). احتفظ بها في مكان آمن.', attachments: [{ filename: 'marketing-hub-backup-' + today + '.json', content: JSON.stringify(DB) }] }); console.log('backup sent') }
    else console.log('backup dry');
  }
  console.log('done', today, 'emails:', sent);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1) });
module.exports = { collect, digestFor, ttMatch, monthReport };
