(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const toEn = s => String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

  // ---------- shop: filter drawer (mobile) ----------
  const filters = $('#filters');
  let backdrop;
  function openFilters() {
    filters.classList.add('open');
    backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    backdrop.onclick = closeFilters;
    document.body.appendChild(backdrop);
  }
  function closeFilters() {
    filters.classList.remove('open');
    backdrop && backdrop.remove();
  }
  $('#open-filters')?.addEventListener('click', openFilters);
  $$('.filter-close').forEach(b => b.addEventListener('click', closeFilters));

  // auto-submit checkbox filters on desktop
  const form = $('#filter-form');
  if (form) {
    $$('[data-auto]', form).forEach(el => el.addEventListener('change', () => {
      if (window.innerWidth > 860) form.submit();
    }));
  }

  // sort select -> update URL
  $('#sort-select')?.addEventListener('change', e => {
    const url = new URL(location.href);
    url.searchParams.set('sort', e.target.value);
    url.searchParams.delete('page');
    location.href = url.toString();
  });

  // ---------- product page: gallery & tabs ----------
  const main = $('#gallery-main img');
  $$('.thumbs button').forEach(btn => btn.addEventListener('click', () => {
    if (main) main.src = btn.dataset.src;
    $$('.thumbs button').forEach(b => b.classList.toggle('active', b === btn));
  }));
  $$('.tab-btns button').forEach(btn => btn.addEventListener('click', () => {
    $$('.tab-btns button').forEach(b => b.classList.toggle('active', b === btn));
    $$('.tab-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== btn.dataset.tab));
  }));

  // ---------- admin: mobile menu ----------
  $('#admin-menu')?.addEventListener('click', () => $('#admin-side').classList.toggle('open'));

  // ---------- admin: money inputs with thousand separators ----------
  function fmt(input) {
    const digits = toEn(input.value).replace(/[^\d]/g, '');
    input.value = digits ? Number(digits).toLocaleString('en-US') : '';
  }
  const priceIn = $('input[name="price"]'), saleIn = $('input[name="sale_price"]'), hint = $('#discount-hint');
  function updateHint() {
    if (!hint) return;
    const p = +toEn(priceIn.value).replace(/[^\d]/g, ''), s = +toEn(saleIn.value).replace(/[^\d]/g, '');
    if (p && s && s < p) hint.textContent = `تخفیف: ${Math.round((1 - s / p) * 100)}٪`;
    else if (s && p && s >= p) hint.textContent = 'قیمت تخفیف باید کمتر از قیمت اصلی باشد (نادیده گرفته می‌شود)';
    else hint.textContent = '';
  }
  $$('.money-input').forEach(i => i.addEventListener('input', () => { fmt(i); updateHint(); }));
  if (priceIn) updateHint();

  // ---------- admin: image dropzone + preview ----------
  const dz = $('#dropzone'), fileInput = $('#file-input'), preview = $('#preview');
  if (dz && fileInput) {
    const showPreview = () => {
      preview.innerHTML = '';
      Array.from(fileInput.files).forEach(f => {
        const div = document.createElement('div');
        div.className = 'img-item';
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        const cap = document.createElement('div');
        cap.className = 'opts';
        cap.textContent = 'جدید';
        div.append(img, cap);
        preview.appendChild(div);
      });
    };
    fileInput.addEventListener('change', showPreview);
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => {
      const dt = new DataTransfer();
      Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')).slice(0, 8).forEach(f => dt.items.add(f));
      fileInput.files = dt.files;
      showPreview();
    });
  }

  // highlight chosen cover image
  $$('input[name="cover_image"]').forEach(r => r.addEventListener('change', () => {
    $$('input[name="cover_image"]').forEach(x => x.closest('.img-item').classList.toggle('cover', x.checked));
  }));
})();
