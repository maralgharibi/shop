const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const SITE_NAME = process.env.SITE_NAME || 'مارال';
const PAGE_SIZE = 12;
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
}));

// ---------- helpers ----------
const faDigits = '۰۱۲۳۴۵۶۷۸۹', arDigits = '٠١٢٣٤٥٦٧٨٩';
function toEnDigits(s) {
  return String(s ?? '')
    .replace(/[۰-۹]/g, d => faDigits.indexOf(d))
    .replace(/[٠-٩]/g, d => arDigits.indexOf(d));
}
function normFa(s) { // unify Arabic/Persian letters for search & storage
  return String(s ?? '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim();
}
function toInt(v) {
  const n = parseInt(toEnDigits(v).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
function money(n) { return Number(n || 0).toLocaleString('fa-IR') + ' تومان'; }
function faNum(n) { return Number(n || 0).toLocaleString('fa-IR'); }
function discountPct(p) {
  if (!p.sale_price || p.sale_price >= p.price) return 0;
  return Math.round((1 - p.sale_price / p.price) * 100);
}

app.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(16).toString('hex');
  res.locals.csrf = req.session.csrf;
  res.locals.siteName = SITE_NAME;
  res.locals.money = money;
  res.locals.faNum = faNum;
  res.locals.discountPct = discountPct;
  res.locals.isAdmin = !!req.session.adminId;
  res.locals.currentPath = req.path;
  res.locals.flash = req.session.flash; delete req.session.flash;
  res.locals.allSections = db.prepare('SELECT * FROM sections ORDER BY sort_order, id').all();
  res.locals.allCategories = db.prepare(`SELECT c.* FROM categories c LEFT JOIN sections s ON s.slug=c.section
    ORDER BY COALESCE(s.sort_order, 999), c.sort_order, c.id`).all();
  next();
});

function flash(req, type, text) { req.session.flash = { type, text }; }
function checkCsrf(req, res, next) {
  if (req.body && req.body._csrf === req.session.csrf) return next();
  (req.files || []).forEach(f => fs.unlink(f.path, () => {}));
  res.status(403).send('درخواست نامعتبر است. صفحه را دوباره بارگذاری کنید.');
}
function requireAdmin(req, res, next) {
  if (req.session.adminId) return next();
  res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
}

// attach first image to product rows
const firstImageStmt = db.prepare('SELECT filename FROM product_images WHERE product_id=? ORDER BY sort_order, id LIMIT 1');
function withImage(rows) {
  return rows.map(p => ({ ...p, image: firstImageStmt.get(p.id)?.filename || null }));
}

// ---------- uploads ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg';
      cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype);
    cb(ok ? null : new Error('فقط فایل تصویری (jpg, png, webp) مجاز است'), ok);
  },
});
function uploadImages(req, res, next) {
  upload.array('images', 8)(req, res, err => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'حجم هر عکس حداکثر ۵ مگابایت است' : err.message;
      flash(req, 'error', msg);
      return res.redirect(req.get('Referer') || '/admin');
    }
    next();
  });
}

// =====================================================
//                    PUBLIC PAGES
// =====================================================
app.get('/', (req, res) => {
  const featured = withImage(db.prepare(`SELECT p.*, c.name AS category_name FROM products p
    LEFT JOIN categories c ON c.id=p.category_id
    WHERE p.is_active=1 AND p.is_featured=1 ORDER BY p.id DESC LIMIT 8`).all());
  const newest = withImage(db.prepare(`SELECT p.*, c.name AS category_name FROM products p
    LEFT JOIN categories c ON c.id=p.category_id
    WHERE p.is_active=1 ORDER BY p.id DESC LIMIT 8`).all());
  res.render('index', { title: SITE_NAME, featured, newest });
});

app.get('/shop', (req, res) => {
  const q = normFa(req.query.q || '');
  const cat = String(req.query.cat || '');
  const sectionRow = req.query.section ? db.prepare('SELECT * FROM sections WHERE slug=?').get(String(req.query.section)) : null;
  const section = sectionRow ? sectionRow.slug : '';
  const brands = [].concat(req.query.brand || []).map(normFa).filter(Boolean);
  const min = toInt(req.query.min);
  const max = toInt(req.query.max);
  const inStock = req.query.instock === '1';
  const onSale = req.query.sale === '1';
  const sort = String(req.query.sort || 'newest');
  const page = Math.max(1, toInt(req.query.page) || 1);

  const where = ['p.is_active=1'];
  const params = {};
  if (q) {
    where.push('(p.name LIKE @q OR p.brand LIKE @q OR p.short_desc LIKE @q OR p.description LIKE @q OR p.suitable_for LIKE @q OR c.name LIKE @q)');
    params.q = `%${q}%`;
  }
  let currentCat = null;
  if (cat) {
    currentCat = db.prepare('SELECT * FROM categories WHERE slug=?').get(cat);
    if (currentCat) { where.push('p.category_id=@catId'); params.catId = currentCat.id; }
  }
  if (section) { where.push('c.section=@section'); params.section = section; }
  if (brands.length) {
    where.push(`p.brand IN (${brands.map((_, i) => '@b' + i).join(',')})`);
    brands.forEach((b, i) => { params['b' + i] = b; });
  }
  if (min !== null) { where.push('COALESCE(p.sale_price, p.price) >= @min'); params.min = min; }
  if (max !== null) { where.push('COALESCE(p.sale_price, p.price) <= @max'); params.max = max; }
  if (inStock) where.push('p.stock > 0');
  if (onSale) where.push('p.sale_price IS NOT NULL AND p.sale_price < p.price');

  const orders = {
    newest: 'p.id DESC',
    cheap: 'COALESCE(p.sale_price, p.price) ASC',
    expensive: 'COALESCE(p.sale_price, p.price) DESC',
    discount: '(CAST(p.price - COALESCE(p.sale_price, p.price) AS REAL) / p.price) DESC',
  };
  const orderBy = orders[sort] || orders.newest;

  const base = `FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) n ${base}`).get(params).n;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const products = withImage(db.prepare(
    `SELECT p.*, c.name AS category_name ${base} ORDER BY p.stock > 0 DESC, ${orderBy} LIMIT ${PAGE_SIZE} OFFSET ${(Math.min(page, pages) - 1) * PAGE_SIZE}`
  ).all(params));

  const allBrands = db.prepare(`SELECT DISTINCT brand FROM products WHERE is_active=1 AND brand IS NOT NULL AND brand<>'' ORDER BY brand`).all().map(r => r.brand);

  // build query string helper for pagination / chips
  const qsBase = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k === 'page') continue;
    [].concat(v).forEach(x => x !== '' && qsBase.append(k, x));
  }

  let heading = 'همه محصولات';
  if (currentCat) heading = currentCat.name;
  else if (sectionRow) heading = sectionRow.name;
  if (q) heading = `نتایج جستجو برای «${q}»`;

  res.render('shop', {
    title: heading + ' | ' + SITE_NAME, heading, products, total, page: Math.min(page, pages), pages,
    filters: { q, cat, section, brands, min, max, inStock, onSale, sort },
    allBrands, qsBase: qsBase.toString(),
  });
});

app.get('/product/:id', (req, res, next) => {
  const p = db.prepare(`SELECT p.*, c.name AS category_name, c.slug AS category_slug, s.slug AS section_slug, s.name AS section_name
    FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN sections s ON s.slug=c.section
    WHERE p.id=? AND p.is_active=1`).get(toInt(req.params.id));
  if (!p) return next();
  const images = db.prepare('SELECT * FROM product_images WHERE product_id=? ORDER BY sort_order, id').all(p.id);
  const related = withImage(db.prepare(`SELECT p.*, c.name AS category_name FROM products p
    LEFT JOIN categories c ON c.id=p.category_id
    WHERE p.is_active=1 AND p.category_id IS ? AND p.id<>? ORDER BY RANDOM() LIMIT 4`).all(p.category_id, p.id));
  res.render('product', { title: p.name + ' | ' + SITE_NAME, p, images, related });
});

// =====================================================
//                       ADMIN
// =====================================================
app.get('/admin/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin');
  res.render('admin/login', { title: 'ورود مدیر', error: null, next: req.query.next || '/admin' });
});

const loginAttempts = new Map();
app.post('/admin/login', checkCsrf, (req, res) => {
  const ip = req.ip;
  const a = loginAttempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60 * 1000) { a.n = 0; a.t = Date.now(); }
  const nextUrl = String(req.body.next || '/admin').startsWith('/admin') ? req.body.next : '/admin';
  if (a.n >= 10) {
    return res.status(429).render('admin/login', { title: 'ورود مدیر', error: 'تلاش‌های زیادی انجام شد. ۱۵ دقیقه بعد دوباره امتحان کنید.', next: nextUrl });
  }
  const user = db.prepare('SELECT * FROM admins WHERE username=?').get(String(req.body.username || '').trim());
  if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password_hash)) {
    a.n++; loginAttempts.set(ip, a);
    return res.status(401).render('admin/login', { title: 'ورود مدیر', error: 'نام کاربری یا رمز عبور اشتباه است', next: nextUrl });
  }
  loginAttempts.delete(ip);
  req.session.regenerate(() => {
    req.session.adminId = user.id;
    req.session.adminName = user.username;
    res.redirect(nextUrl);
  });
});

app.post('/admin/logout', checkCsrf, (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.use('/admin', requireAdmin);
app.use('/admin', (req, res, next) => { res.locals.adminName = req.session.adminName; next(); });

// --- dashboard / product list ---
app.get('/admin', (req, res) => {
  const q = normFa(req.query.q || '');
  const cat = toInt(req.query.cat);
  const where = ['1=1']; const params = {};
  if (q) { where.push('(p.name LIKE @q OR p.brand LIKE @q)'); params.q = `%${q}%`; }
  if (cat) { where.push('p.category_id=@cat'); params.cat = cat; }
  const products = withImage(db.prepare(`SELECT p.*, c.name AS category_name FROM products p
    LEFT JOIN categories c ON c.id=p.category_id WHERE ${where.join(' AND ')} ORDER BY p.id DESC`).all(params));
  const stats = {
    products: db.prepare('SELECT COUNT(*) n FROM products').get().n,
    active: db.prepare('SELECT COUNT(*) n FROM products WHERE is_active=1').get().n,
    outOfStock: db.prepare('SELECT COUNT(*) n FROM products WHERE stock<=0').get().n,
    categories: db.prepare('SELECT COUNT(*) n FROM categories').get().n,
  };
  res.render('admin/dashboard', { title: 'پنل مدیریت', products, stats, q, cat });
});

// --- product form ---
function readProductForm(body) {
  const price = toInt(body.price) || 0;
  let sale = toInt(body.sale_price);
  if (!sale || sale >= price) sale = null;
  return {
    name: normFa(body.name),
    brand: normFa(body.brand) || null,
    category_id: toInt(body.category_id),
    price,
    sale_price: sale,
    stock: toInt(body.stock) ?? 0,
    suitable_for: normFa(body.suitable_for) || null,
    volume: normFa(body.volume) || null,
    short_desc: normFa(body.short_desc) || null,
    description: normFa(body.description) || null,
    features: normFa(body.features) || null,
    how_to_use: normFa(body.how_to_use) || null,
    ingredients: normFa(body.ingredients) || null,
    is_active: body.is_active ? 1 : 0,
    is_featured: body.is_featured ? 1 : 0,
  };
}
function saveImages(productId, files) {
  const start = db.prepare('SELECT COALESCE(MAX(sort_order), -1) m FROM product_images WHERE product_id=?').get(productId).m + 1;
  const ins = db.prepare('INSERT INTO product_images (product_id, filename, sort_order) VALUES (?,?,?)');
  (files || []).forEach((f, i) => ins.run(productId, f.filename, start + i));
}
function removeFile(name) {
  const fp = path.join(UPLOAD_DIR, path.basename(name));
  fs.unlink(fp, () => {});
}

app.get('/admin/products/new', (req, res) => {
  res.render('admin/product-form', { title: 'افزودن محصول', p: { is_active: 1 }, images: [] });
});

app.post('/admin/products', uploadImages, checkCsrf, (req, res) => {
  const data = readProductForm(req.body);
  if (!data.name || !data.price) {
    (req.files || []).forEach(f => removeFile(f.filename));
    flash(req, 'error', 'نام و قیمت محصول الزامی است');
    return res.redirect('/admin/products/new');
  }
  const info = db.prepare(`INSERT INTO products
    (name, brand, category_id, price, sale_price, stock, suitable_for, volume, short_desc, description, features, how_to_use, ingredients, is_active, is_featured)
    VALUES (@name,@brand,@category_id,@price,@sale_price,@stock,@suitable_for,@volume,@short_desc,@description,@features,@how_to_use,@ingredients,@is_active,@is_featured)`).run(data);
  saveImages(info.lastInsertRowid, req.files);
  flash(req, 'success', 'محصول با موفقیت اضافه شد');
  res.redirect('/admin');
});

app.get('/admin/products/:id/edit', (req, res, next) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(toInt(req.params.id));
  if (!p) return next();
  const images = db.prepare('SELECT * FROM product_images WHERE product_id=? ORDER BY sort_order, id').all(p.id);
  res.render('admin/product-form', { title: 'ویرایش محصول', p, images });
});

app.post('/admin/products/:id', uploadImages, checkCsrf, (req, res, next) => {
  const id = toInt(req.params.id);
  const exists = db.prepare('SELECT id FROM products WHERE id=?').get(id);
  if (!exists) return next();
  const data = readProductForm(req.body);
  if (!data.name || !data.price) {
    (req.files || []).forEach(f => removeFile(f.filename));
    flash(req, 'error', 'نام و قیمت محصول الزامی است');
    return res.redirect(`/admin/products/${id}/edit`);
  }
  db.prepare(`UPDATE products SET name=@name, brand=@brand, category_id=@category_id, price=@price, sale_price=@sale_price,
    stock=@stock, suitable_for=@suitable_for, volume=@volume, short_desc=@short_desc, description=@description,
    features=@features, how_to_use=@how_to_use, ingredients=@ingredients, is_active=@is_active, is_featured=@is_featured
    WHERE id=@id`).run({ ...data, id });
  saveImages(id, req.files);
  // remove ticked images
  const del = [].concat(req.body.delete_images || []).map(toInt).filter(Boolean);
  del.forEach(imgId => {
    const img = db.prepare('SELECT * FROM product_images WHERE id=? AND product_id=?').get(imgId, id);
    if (img) { db.prepare('DELETE FROM product_images WHERE id=?').run(imgId); removeFile(img.filename); }
  });
  // set cover image
  const cover = toInt(req.body.cover_image);
  if (cover) {
    db.prepare('UPDATE product_images SET sort_order = sort_order + 1 WHERE product_id=?').run(id);
    db.prepare('UPDATE product_images SET sort_order = 0 WHERE id=? AND product_id=?').run(cover, id);
  }
  flash(req, 'success', 'تغییرات ذخیره شد');
  res.redirect(`/admin/products/${id}/edit`);
});

app.post('/admin/products/:id/delete', checkCsrf, (req, res) => {
  const id = toInt(req.params.id);
  const imgs = db.prepare('SELECT filename FROM product_images WHERE product_id=?').all(id);
  db.prepare('DELETE FROM products WHERE id=?').run(id);
  imgs.forEach(i => removeFile(i.filename));
  flash(req, 'success', 'محصول حذف شد');
  res.redirect('/admin');
});

// quick toggle active from list
app.post('/admin/products/:id/toggle', checkCsrf, (req, res) => {
  db.prepare('UPDATE products SET is_active = 1 - is_active WHERE id=?').run(toInt(req.params.id));
  res.redirect(req.get('Referer') || '/admin');
});

// --- categories ---
function slugify(s) {
  const base = String(s || '').trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return base || 'cat-' + Date.now();
}
function validSection(slug) {
  const row = db.prepare('SELECT slug FROM sections WHERE slug=?').get(String(slug || ''));
  return row ? row.slug : (db.prepare('SELECT slug FROM sections ORDER BY sort_order, id LIMIT 1').get()?.slug || 'skin');
}

// --- sections (main groups such as skin, hair, makeup, perfume) ---
app.post('/admin/sections', checkCsrf, (req, res) => {
  const name = normFa(req.body.name);
  if (!name) { flash(req, 'error', 'نام بخش را وارد کنید'); return res.redirect('/admin/categories'); }
  let slug = slugify(req.body.slug || name);
  if (db.prepare('SELECT 1 FROM sections WHERE slug=?').get(slug)) slug += '-' + Date.now().toString(36);
  db.prepare('INSERT INTO sections (name, slug, emoji, description, sort_order) VALUES (?,?,?,?,?)')
    .run(name, slug, normFa(req.body.emoji) || null, normFa(req.body.description) || null, toInt(req.body.sort_order) || 0);
  flash(req, 'success', `بخش «${name}» اضافه شد. حالا می‌توانید برایش دسته‌بندی بسازید.`);
  res.redirect('/admin/categories');
});
app.post('/admin/sections/:id', checkCsrf, (req, res) => {
  const name = normFa(req.body.name);
  if (name) {
    db.prepare('UPDATE sections SET name=?, emoji=?, description=?, sort_order=? WHERE id=?')
      .run(name, normFa(req.body.emoji) || null, normFa(req.body.description) || null, toInt(req.body.sort_order) || 0, toInt(req.params.id));
    flash(req, 'success', 'بخش به‌روز شد');
  }
  res.redirect('/admin/categories');
});
app.post('/admin/sections/:id/delete', checkCsrf, (req, res) => {
  const sec = db.prepare('SELECT * FROM sections WHERE id=?').get(toInt(req.params.id));
  if (!sec) return res.redirect('/admin/categories');
  const used = db.prepare('SELECT COUNT(*) n FROM categories WHERE section=?').get(sec.slug).n;
  if (used) flash(req, 'error', `ابتدا ${faNum(used)} دسته‌بندیِ این بخش را حذف یا به بخش دیگری منتقل کنید`);
  else { db.prepare('DELETE FROM sections WHERE id=?').run(sec.id); flash(req, 'success', 'بخش حذف شد'); }
  res.redirect('/admin/categories');
});

app.get('/admin/categories', (req, res) => {
  const cats = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id) AS count
    FROM categories c LEFT JOIN sections s ON s.slug=c.section ORDER BY COALESCE(s.sort_order, 999), c.sort_order, c.id`).all();
  const sections = db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM categories c WHERE c.section=s.slug) AS count
    FROM sections s ORDER BY s.sort_order, s.id`).all();
  res.render('admin/categories', { title: 'بخش‌ها و دسته‌بندی‌ها', cats, sections });
});
app.post('/admin/categories', checkCsrf, (req, res) => {
  const name = normFa(req.body.name);
  if (!name) { flash(req, 'error', 'نام دسته‌بندی را وارد کنید'); return res.redirect('/admin/categories'); }
  let slug = slugify(req.body.slug || name);
  if (db.prepare('SELECT 1 FROM categories WHERE slug=?').get(slug)) slug += '-' + Date.now().toString(36);
  db.prepare('INSERT INTO categories (name, slug, section, sort_order) VALUES (?,?,?,?)')
    .run(name, slug, validSection(req.body.section), toInt(req.body.sort_order) || 0);
  flash(req, 'success', 'دسته‌بندی اضافه شد');
  res.redirect('/admin/categories');
});
app.post('/admin/categories/:id', checkCsrf, (req, res) => {
  const name = normFa(req.body.name);
  if (name) {
    db.prepare('UPDATE categories SET name=?, section=?, sort_order=? WHERE id=?')
      .run(name, validSection(req.body.section), toInt(req.body.sort_order) || 0, toInt(req.params.id));
    flash(req, 'success', 'دسته‌بندی به‌روز شد');
  }
  res.redirect('/admin/categories');
});
app.post('/admin/categories/:id/delete', checkCsrf, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id=?').run(toInt(req.params.id));
  flash(req, 'success', 'دسته‌بندی حذف شد (محصولاتش بدون دسته شدند)');
  res.redirect('/admin/categories');
});

// --- password ---
app.get('/admin/password', (req, res) => res.render('admin/password', { title: 'تغییر رمز عبور' }));
app.post('/admin/password', checkCsrf, (req, res) => {
  const me = db.prepare('SELECT * FROM admins WHERE id=?').get(req.session.adminId);
  const { current, next: newPass, confirm } = req.body;
  if (!bcrypt.compareSync(String(current || ''), me.password_hash)) flash(req, 'error', 'رمز فعلی اشتباه است');
  else if (!newPass || newPass.length < 6) flash(req, 'error', 'رمز جدید باید حداقل ۶ کاراکتر باشد');
  else if (newPass !== confirm) flash(req, 'error', 'تکرار رمز با رمز جدید یکسان نیست');
  else {
    db.prepare('UPDATE admins SET password_hash=? WHERE id=?').run(bcrypt.hashSync(newPass, 10), me.id);
    flash(req, 'success', 'رمز عبور تغییر کرد');
  }
  res.redirect('/admin/password');
});

// ---------- 404 & errors ----------
app.use((req, res) => res.status(404).render('404', { title: 'صفحه پیدا نشد' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('خطای سرور');
});

app.listen(PORT, () => console.log(`✔ ${SITE_NAME} running at http://localhost:${PORT}`));
