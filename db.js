const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'shop.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  emoji TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  section TEXT NOT NULL DEFAULT 'skin',   -- = sections.slug
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brand TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  price INTEGER NOT NULL DEFAULT 0,
  sale_price INTEGER,
  stock INTEGER NOT NULL DEFAULT 0,
  suitable_for TEXT,          -- e.g. پوست چرب، موی خشک
  volume TEXT,                -- e.g. 200 میلی‌لیتر
  short_desc TEXT,
  description TEXT,
  features TEXT,              -- one feature per line
  how_to_use TEXT,
  ingredients TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id);
`);

// ---- First-run seed ----
function seed() {
  const adminCount = db.prepare('SELECT COUNT(*) c FROM admins').get().c;
  if (adminCount === 0) {
    const user = process.env.ADMIN_USER || 'admin';
    const pass = process.env.ADMIN_PASS || 'admin123';
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)')
      .run(user, bcrypt.hashSync(pass, 10));
    console.log(`[seed] admin created -> username: ${user}  password: ${pass}`);
  }

  const catCount = db.prepare('SELECT COUNT(*) c FROM categories').get().c;
  if (catCount === 0) {
    const cats = [
      ['شوینده و پاک‌کننده صورت', 'cleanser', 'skin', 1],
      ['کرم آبرسان و مرطوب‌کننده', 'moisturizer', 'skin', 2],
      ['ضدآفتاب', 'sunscreen', 'skin', 3],
      ['سرم و درمان پوست', 'serum', 'skin', 4],
      ['ماسک صورت', 'face-mask', 'skin', 5],
      ['شامپو', 'shampoo', 'hair', 6],
      ['نرم‌کننده و ماسک مو', 'conditioner', 'hair', 7],
      ['روغن و سرم مو', 'hair-oil', 'hair', 8],
    ];
    const ins = db.prepare('INSERT INTO categories (name, slug, section, sort_order) VALUES (?,?,?,?)');
    cats.forEach(c => ins.run(...c));

    const catId = slug => db.prepare('SELECT id FROM categories WHERE slug=?').get(slug).id;
    const insP = db.prepare(`INSERT INTO products
      (name, brand, category_id, price, sale_price, stock, suitable_for, volume, short_desc, description, features, how_to_use, ingredients, is_featured)
      VALUES (@name,@brand,@category_id,@price,@sale_price,@stock,@suitable_for,@volume,@short_desc,@description,@features,@how_to_use,@ingredients,@is_featured)`);
    const samples = [
      { name: 'ژل شستشوی صورت پوست چرب', brand: 'سینره', category_id: catId('cleanser'), price: 285000, sale_price: 249000, stock: 25, suitable_for: 'پوست چرب و مختلط', volume: '200 میلی‌لیتر', short_desc: 'پاک‌کنندگی عمیق بدون خشکی', description: 'این ژل شستشو با فرمولاسیون ملایم، چربی اضافه و آلودگی‌های پوست را پاک می‌کند و حس طراوت می‌دهد.', features: 'فاقد سولفات\nتنظیم‌کننده چربی پوست\nمناسب استفاده روزانه\nتست‌شده درماتولوژیک', how_to_use: 'صبح و شب مقدار کمی را روی پوست مرطوب ماساژ دهید و با آب ولرم بشویید.', ingredients: 'نیاسینامید، عصاره چای سبز، زینک', is_featured: 1 },
      { name: 'کرم آبرسان هیالورونیک اسید', brand: 'آردن', category_id: catId('moisturizer'), price: 420000, sale_price: null, stock: 12, suitable_for: 'انواع پوست', volume: '50 میلی‌لیتر', short_desc: 'آبرسانی ۲۴ ساعته با بافت سبک', description: 'کرمی سبک و سریع‌الجذب که رطوبت پوست را در طول روز حفظ می‌کند.', features: 'بافت ژل‌کرم سبک\nحاوی هیالورونیک اسید\nفاقد چربی\nمناسب زیر آرایش', how_to_use: 'پس از شستشو روی پوست صورت و گردن بمالید.', ingredients: 'هیالورونیک اسید، گلیسیرین، آلوئه‌ورا', is_featured: 1 },
      { name: 'کرم ضدآفتاب SPF50 بی‌رنگ', brand: 'مدیلن', category_id: catId('sunscreen'), price: 360000, sale_price: 315000, stock: 30, suitable_for: 'پوست حساس', volume: '40 میلی‌لیتر', short_desc: 'محافظت بالا در برابر UVA و UVB', description: 'ضدآفتاب بی‌رنگ با پوشش سبک و بدون ردِ سفید.', features: 'SPF50+\nضدآب\nبدون رد سفید\nمناسب پوست حساس', how_to_use: '۲۰ دقیقه قبل از قرار گرفتن در معرض آفتاب استفاده و هر ۲ ساعت تمدید کنید.', ingredients: 'فیلترهای شیمیایی و فیزیکی، ویتامین E', is_featured: 1 },
      { name: 'سرم ویتامین C روشن‌کننده', brand: 'لافارر', category_id: catId('serum'), price: 590000, sale_price: null, stock: 8, suitable_for: 'پوست کدر', volume: '30 میلی‌لیتر', short_desc: 'روشن‌کننده و یکدست‌کننده رنگ پوست', description: 'سرمی با غلظت مناسب ویتامین C برای درخشندگی و کاهش لک‌ها.', features: 'ویتامین C پایدار\nکاهش لک و تیرگی\nآنتی‌اکسیدان قوی', how_to_use: 'صبح‌ها ۲ تا ۳ قطره قبل از مرطوب‌کننده استفاده کنید.', ingredients: 'ویتامین C، فرولیک اسید، ویتامین E', is_featured: 0 },
      { name: 'شامپو تقویت‌کننده موی ضعیف', brand: 'سریتا', category_id: catId('shampoo'), price: 195000, sale_price: 169000, stock: 40, suitable_for: 'موی ضعیف و ریزشی', volume: '300 میلی‌لیتر', short_desc: 'تقویت ریشه و کاهش ریزش', description: 'شامپویی با عصاره‌های گیاهی که به تقویت ریشه مو کمک می‌کند.', features: 'حاوی کافئین\nفاقد پارابن\nمناسب استفاده روزانه', how_to_use: 'روی موی خیس ماساژ دهید، ۲ دقیقه صبر و سپس آبکشی کنید.', ingredients: 'کافئین، بیوتین، عصاره رزماری', is_featured: 1 },
      { name: 'ماسک موی آرگان', brand: 'پرایم', category_id: catId('conditioner'), price: 310000, sale_price: null, stock: 0, suitable_for: 'موی خشک و آسیب‌دیده', volume: '250 میلی‌لیتر', short_desc: 'ترمیم و نرمی عمیق مو', description: 'ماسک ترمیم‌کننده با روغن آرگان برای موهای خشک و وزدار.', features: 'ترمیم موهای رنگ‌شده\nکاهش وز مو\nرایحه ملایم', how_to_use: 'پس از شامپو روی ساقه مو بمالید و پس از ۵ دقیقه بشویید.', ingredients: 'روغن آرگان، کراتین، شی‌باتر', is_featured: 0 },
      { name: 'روغن مو چندکاره', brand: 'بیول', category_id: catId('hair-oil'), price: 270000, sale_price: 229000, stock: 15, suitable_for: 'انواع مو', volume: '100 میلی‌لیتر', short_desc: 'براق‌کننده و محافظ حرارت', description: 'روغنی سبک برای درخشش مو و محافظت در برابر حرارت سشوار و اتو.', features: 'محافظ حرارتی\nبدون چربی و سنگینی\nبراق‌کننده', how_to_use: 'چند قطره روی موی نم‌دار یا خشک بمالید.', ingredients: 'روغن آرگان، روغن جوجوبا، ویتامین E', is_featured: 0 },
    ];
    samples.forEach(p => insP.run(p));
    console.log('[seed] sample categories & products added');
  }
}
seed();

// ---- Sections (main groups) + extra categories: also runs on databases created by the older version ----
function seedSections() {
  if (db.prepare('SELECT COUNT(*) c FROM sections').get().c > 0) return;
  const secs = [
    ['مراقبت پوست', 'skin', '🧴', 'پاک‌کننده، آبرسان، ضدآفتاب، سرم', 1],
    ['مراقبت مو', 'hair', '💆‍♀️', 'شامپو، ماسک، روغن و سرم مو', 2],
    ['آرایشی', 'makeup', '💄', 'رژ لب، ریمل، کرم پودر، سایه', 3],
    ['عطر و ادکلن', 'perfume', '🌸', 'عطر زنانه، مردانه، بادی اسپلش', 4],
    ['بهداشت شخصی', 'body', '🛁', 'شامپو بدن، دئودورانت، مراقبت دهان', 5],
  ];
  const insS = db.prepare('INSERT INTO sections (name, slug, emoji, description, sort_order) VALUES (?,?,?,?,?)');
  secs.forEach(x => insS.run(...x));

  const cats = [
    ['کرم پودر و کوشن', 'foundation', 'makeup', 10],
    ['رژ لب و برق لب', 'lipstick', 'makeup', 11],
    ['ریمل و خط چشم', 'mascara', 'makeup', 12],
    ['سایه و رژگونه', 'eyeshadow', 'makeup', 13],
    ['لاک ناخن', 'nail-polish', 'makeup', 14],
    ['ابزار آرایش', 'makeup-tools', 'makeup', 15],
    ['عطر زنانه', 'women-perfume', 'perfume', 20],
    ['عطر مردانه', 'men-perfume', 'perfume', 21],
    ['عطر یونیسکس', 'unisex-perfume', 'perfume', 22],
    ['بادی اسپلش و میست', 'body-mist', 'perfume', 23],
    ['شامپو بدن و صابون', 'body-wash', 'body', 30],
    ['دئودورانت و ضدتعریق', 'deodorant', 'body', 31],
    ['لوسیون و کرم بدن', 'body-lotion', 'body', 32],
    ['بهداشت دهان و دندان', 'oral-care', 'body', 33],
  ];
  const insC = db.prepare('INSERT OR IGNORE INTO categories (name, slug, section, sort_order) VALUES (?,?,?,?)');
  cats.forEach(c => insC.run(...c));

  // a few sample products for the new sections (only on a store that still has the original samples)
  if (db.prepare('SELECT COUNT(*) c FROM products').get().c > 10) return;
  const catId = slug => db.prepare('SELECT id FROM categories WHERE slug=?').get(slug)?.id ?? null;
  const insP = db.prepare(`INSERT INTO products
    (name, brand, category_id, price, sale_price, stock, suitable_for, volume, short_desc, description, features, how_to_use, ingredients, is_featured)
    VALUES (@name,@brand,@category_id,@price,@sale_price,@stock,@suitable_for,@volume,@short_desc,@description,@features,@how_to_use,@ingredients,@is_featured)`);
  [
    { name: 'رژ لب مات ماندگار', brand: 'گلدن رز', category_id: catId('lipstick'), price: 245000, sale_price: 199000, stock: 20, suitable_for: 'انواع لب', volume: 'رنگ ۰۵ – رز خاکی', short_desc: 'بافت مات و مخملی، ماندگاری بالا', description: 'رژ لب مات با بافت سبک که لب را خشک نمی‌کند و تا ۸ ساعت ماندگار است.', features: 'ماندگاری تا ۸ ساعت\nحاوی ویتامین E\nبدون حالت پوسته‌پوسته', how_to_use: 'از مرکز لب شروع کرده و به سمت گوشه‌ها بکشید.', ingredients: 'روغن جوجوبا، ویتامین E، رنگدانه‌های معدنی', is_featured: 1 },
    { name: 'ریمل حجم‌دهنده ضدآب', brand: 'اسنس', category_id: catId('mascara'), price: 210000, sale_price: null, stock: 18, suitable_for: 'مژه‌های کم‌پشت', volume: '12 میلی‌لیتر', short_desc: 'حجم و بلندی چشمگیر', description: 'ریمل ضدآب با برس مخصوص که مژه‌ها را جدا، بلند و پرحجم نشان می‌دهد.', features: 'ضدآب و ضدتعریق\nبدون گلوله شدن\nرنگ مشکی عمیق', how_to_use: 'برس را از ریشه به سمت نوک مژه‌ها به‌صورت زیگزاگ بکشید.', ingredients: '', is_featured: 0 },
    { name: 'کرم پودر سبک با پوشش متوسط', brand: 'مای', category_id: catId('foundation'), price: 380000, sale_price: 329000, stock: 14, suitable_for: 'پوست نرمال تا خشک', volume: '30 میلی‌لیتر – شماره 102', short_desc: 'پوشش طبیعی و یکدست', description: 'کرم پودری با بافت سبک که پوشش طبیعی ایجاد می‌کند و حالت ماسک روی صورت نمی‌دهد.', features: 'دارای SPF15\nبافت سبک\nفینیش نیمه‌مات', how_to_use: 'با براش یا پد اسفنجی روی پوست پخش کنید.', ingredients: '', is_featured: 0 },
    { name: 'ادو پرفیوم زنانه گلی', brand: 'رودیر', category_id: catId('women-perfume'), price: 1450000, sale_price: 1290000, stock: 6, suitable_for: 'زنانه', volume: '100 میلی‌لیتر', short_desc: 'رایحه گلی و شیرین، ماندگاری بالا', description: 'عطری گرم و لطیف با رایحه گل‌های سفید، مناسب مهمانی و استفاده روزانه.', features: 'غلظت ادو پرفیوم\nماندگاری ۶ تا ۸ ساعت\nپخش بوی متوسط', how_to_use: 'روی نقاط نبض مانند مچ دست و پشت گوش اسپری کنید.', ingredients: 'نت آغازین: برگاموت، گلابی\nنت میانی: یاسمن، گل رز\nنت پایانی: وانیل، مشک', is_featured: 1 },
    { name: 'ادکلن مردانه چوبی', brand: 'جانوین', category_id: catId('men-perfume'), price: 980000, sale_price: null, stock: 9, suitable_for: 'مردانه', volume: '100 میلی‌لیتر', short_desc: 'رایحه چوبی و تند', description: 'رایحه‌ای چوبی و ادویه‌ای مناسب فصل‌های سرد و استفاده رسمی.', features: 'ماندگاری بالا\nمناسب پاییز و زمستان', how_to_use: 'از فاصله ۱۵ سانتی‌متری روی گردن و سینه اسپری کنید.', ingredients: 'نت آغازین: فلفل صورتی\nنت میانی: اسطوخودوس\nنت پایانی: چوب صندل، عنبر', is_featured: 0 },
    { name: 'بادی اسپلش وانیل', brand: 'بیو', category_id: catId('body-mist'), price: 260000, sale_price: 219000, stock: 25, suitable_for: 'زنانه', volume: '250 میلی‌لیتر', short_desc: 'رایحه ملایم و شیرین برای هر روز', description: 'اسپری بدن سبک با رایحه وانیل که حس تازگی می‌دهد.', features: 'رایحه ملایم\nمناسب استفاده روزانه', how_to_use: 'روی بدن و لباس اسپری کنید.', ingredients: 'وانیل، مشک سفید', is_featured: 0 },
    { name: 'دئودورانت رول ۴۸ ساعته', brand: 'اوریفلیم', category_id: catId('deodorant'), price: 145000, sale_price: null, stock: 30, suitable_for: 'پوست حساس', volume: '50 میلی‌لیتر', short_desc: 'بدون الکل، محافظت ۴۸ ساعته', description: 'دئودورانت رول ملایم که بدون ایجاد لک روی لباس از بوی بد بدن جلوگیری می‌کند.', features: 'فاقد الکل\nبدون لک روی لباس\nمناسب پوست حساس', how_to_use: 'روی پوست تمیز و خشک زیر بغل بکشید.', ingredients: '', is_featured: 0 },
    { name: 'شامپو بدن کرمی شیر و عسل', brand: 'سیو', category_id: catId('body-wash'), price: 115000, sale_price: 99000, stock: 40, suitable_for: 'پوست خشک', volume: '400 میلی‌لیتر', short_desc: 'نرم‌کننده و مرطوب‌کننده پوست', description: 'شامپو بدن کرمی که هنگام شستشو پوست را نرم و مرطوب نگه می‌دارد.', features: 'pH متعادل\nرایحه ملایم\nمرطوب‌کننده', how_to_use: 'روی پوست خیس یا لیف بمالید و آبکشی کنید.', ingredients: 'عصاره شیر، عسل، گلیسیرین', is_featured: 0 },
  ].filter(p => p.category_id).forEach(p => insP.run(p));
  console.log('[seed] sections (makeup, perfume, body) added');
}
seedSections();

module.exports = db;
