document.addEventListener('DOMContentLoaded', ()=>{
  try{
    // Simple Money Manager App (vanilla JS) - stores data in localStorage and uses Tesseract.js + Chart.js
    const STORAGE_KEY = 'mm_transactions_v1';

    // Utils
    const fmt = n => 'Rp' + Number(n).toLocaleString('id-ID');
    const parseCurrencyString = s => {
      if (!s) return 0;
      // normalize and detect decimal separator robustly
      let v = String(s || '').trim();
      // remove currency words and whitespace
      v = v.replace(/Rp|rp|IDR|idr|\s+/g, '');
      // keep only digits, separators and minus
      v = v.replace(/[^0-9.,-]/g, '');

      const lastDot = v.lastIndexOf('.');
      const lastComma = v.lastIndexOf(',');

      if (lastDot !== -1 && lastComma !== -1) {
        // both present: determine which is the decimal separator by position
        if (lastDot > lastComma) {
          // dot appears later -> dot is decimal separator, remove commas
          v = v.replace(/,/g, '');
        } else {
          // comma appears later -> comma is decimal separator
          v = v.replace(/\./g, '').replace(/,/g, '.');
        }
      } else if (lastComma !== -1) {
        // only comma present: decide if it's decimal (e.g., 4,50) or thousands (e.g., 4,010)
        const decimals = v.length - lastComma - 1;
        if (decimals === 3) {
          // likely thousands separators
          v = v.replace(/,/g, '');
        } else {
          // treat comma as decimal separator
          v = v.replace(/,/g, '.');
        }
      } else if (lastDot !== -1) {
        const decimals = v.length - lastDot - 1;
        if (decimals === 3) {
          // likely thousands separators
          v = v.replace(/\./g, '');
        }
        // else dot is decimal separator -> leave it
      }

      const num = parseFloat(v);
      return isNaN(num) ? 0 : num;
    }
    const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    function showToast(message, type='info', duration=4000, actionText, actionCallback){
      const container = document.getElementById('toastContainer') || (()=>{ const c=document.createElement('div'); c.id='toastContainer'; c.className='toast-container'; document.body.appendChild(c); return c; })();
      const toast = document.createElement('div'); toast.className = 'toast '+type;
      const text = document.createElement('span'); text.innerText = message; toast.appendChild(text);
      if(actionText && typeof actionCallback === 'function'){
        const btn = document.createElement('button'); btn.className = 'action'; btn.innerText = actionText;
        btn.onclick = e => { try{ actionCallback(); }catch(err){ console.error(err); } toast.classList.add('hide'); setTimeout(()=>toast.remove(),300); };
        toast.appendChild(btn);
      }
      container.appendChild(toast);
      setTimeout(()=>{ toast.classList.add('hide'); setTimeout(()=>toast.remove(),300); }, duration);
    }

    // State
    let transactions = [];
    let categories = [];

    // Elements
    const balanceEl = document.getElementById('balance');
    const incomeEl = document.getElementById('total-income');
    const expenseEl = document.getElementById('total-expense');
    const txCountEl = document.getElementById('tx-count');
    const txListEl = document.getElementById('txList');
    const addBtn = document.getElementById('addBtn');
    const descEl = document.getElementById('desc');
    const amountEl = document.getElementById('amount');
    const typeEl = document.getElementById('type');
    const fileInput = document.getElementById('fileInput');
    const imgPreview = document.getElementById('imgPreview');
    const scanBtn = document.getElementById('scanBtn');
    const ocrHint = document.getElementById('ocrHint');
    const refreshBtn = document.getElementById('refreshBtn');

    // Chart
    let chart = null;
    const canvas = document.getElementById('chart');
    const ctx = canvas ? canvas.getContext('2d') : null;

    function load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        transactions = raw ? JSON.parse(raw) : [];
      } catch (e) {
        transactions = [];
      }
      // ensure category exists on old transactions
      transactions = transactions.map(t => ({ ...t, category: t.category || 'uncategorized' }));

      // load categories or use defaults
      try{
        const cRaw = localStorage.getItem('mm_categories_v1');
        if(cRaw) categories = JSON.parse(cRaw);
        else categories = [
          { id: 'uncategorized', name: 'Lainnya', icon: '🔖', budget: 0, keywords: [] },
          { id: 'makanan', name: 'Makanan', icon: '🍔', budget: 0, keywords: ['makan','makanan','bakso','mie','nasi','jajan','snack','es krim','warteg','makan siang','makan malam'] },
          { id: 'shopping', name: 'Belanja', icon: '🛍️', budget: 0, keywords: ['belanja','beli','tas','sepatu','barang'] },
          { id: 'transport', name: 'Transport', icon: '🚗', budget: 0, keywords: ['ojek','grab','gocar','transport','bensin','tol','ongkir','taksi','bus'] },
          { id: 'salary', name: 'Gaji', icon: '💼', budget: 0, keywords: ['gaji','salary','terima','penerimaan','honor','income'] }
        ];
      }catch(e){ categories = [] }
    }
    function save() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
    }
    function saveCategories(){ localStorage.setItem('mm_categories_v1', JSON.stringify(categories)); }

    function renderCategorySelect(){
      const sel = document.getElementById('category');
      if(!sel) return;
      sel.innerHTML = '';
      categories.forEach(c=>{
        const opt = document.createElement('option'); opt.value = c.id; opt.innerText = `${c.icon} ${c.name}`; sel.appendChild(opt);
      });
    }

    function computeSpentForCategoryMonth(catId, year, month){
      const start = new Date(year, month, 1);
      const end = new Date(year, month+1, 1);
      const spent = transactions.filter(t=>t.amount<0 && t.category===catId && new Date(t.date)>=start && new Date(t.date)<end)
                    .reduce((s,t)=>s+Math.abs(t.amount),0);
      return spent;
    }

    function renderBudgets(){
      const el = document.getElementById('budgetList');
      if(!el) return;
      el.innerHTML = '';
      const now = new Date();
      categories.forEach(c=>{
        const spent = computeSpentForCategoryMonth(c.id, now.getFullYear(), now.getMonth());
        const budget = Number(c.budget)||0;
        const over = budget>0 && spent>budget;
        const item = document.createElement('div'); item.className='budget-item';
        item.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div><strong>${c.icon} <span class="cat-name">${c.name}</span></strong><div class="hint">${budget>0? 'Budget: Rp'+budget.toLocaleString('id-ID') : 'No budget set'}</div></div>
      <div style="text-align:right">
        <div>${budget>0? 'Terpakai: Rp'+spent.toLocaleString('id-ID') : 'Terpakai: Rp'+spent.toLocaleString('id-ID')}</div>
        <div class="hint" style="color:${over ? 'var(--red)' : 'var(--muted)'}">${over ? '⚠️ Budget terlampaui' : ''}</div>
      </div>
    </div>
    <div class="budget-bar"><div class="budget-bar-fill" style="width:${budget>0? Math.min(100, Math.round((spent/budget)*100)):0}%"></div></div>
    <div class="form-row" style="margin-top:6px">
      <input class="input small" data-cat="${c.id}" value="${budget>0?budget:''}" placeholder="Masukkan budget (angka)"/>
      <button class="btn save-budget" data-cat="${c.id}">Simpan</button>
    </div>
    <div class="form-row" style="margin-top:6px">
      <input class="input" data-cat-keywords="${c.id}" placeholder="Keywords (pisah koma): ${c.keywords?c.keywords.join(', '):''}" />
      <button class="btn save-keywords" data-cat="${c.id}">Simpan keywords</button>
    </div>
    <div class="cat-actions">
      <button class="btn ghost edit-cat" data-cat="${c.id}">Edit</button>
      <button class="btn ghost del-cat" data-cat="${c.id}" ${c.id==='uncategorized' ? 'disabled title="Tidak dapat dihapus"':''}>Hapus</button>
    </div>`;
        el.appendChild(item);
      });
      el.querySelectorAll('.save-budget').forEach(btn=>{
        btn.onclick = ()=> {
          const id = btn.getAttribute('data-cat');
          const input = el.querySelector(`input[data-cat="${id}"]`);
          const val = parseCurrencyString(input.value.trim());
          const cat = categories.find(x=>x.id===id);
          if(cat){ cat.budget = val; saveCategories(); renderBudgets(); }
        };
      });
      el.querySelectorAll('.save-keywords').forEach(btn=>{
        btn.onclick = ()=>{
          const id = btn.getAttribute('data-cat');
          const input = el.querySelector(`input[data-cat-keywords="${id}"]`);
          const val = input ? input.value.trim() : '';
          const cat = categories.find(x=>x.id===id);
          if(cat){ cat.keywords = val ? val.split(',').map(s=>s.trim()).filter(Boolean) : []; saveCategories(); renderBudgets(); showToast('Keywords disimpan','success'); }
        };
      });

      // Edit / Delete handlers
      el.querySelectorAll('.edit-cat').forEach(btn=>{
        btn.onclick = ()=>{
          const id = btn.getAttribute('data-cat');
          const cat = categories.find(c=>c.id===id);
          if(!cat) return;
          // open modal with edit form
          const html = `<div style="display:flex;flex-direction:column;gap:8px">
            <label>Nama kategori</label>
            <input id="editCatName" class="input" value="${cat.name}" />
            <label>Ikon (emoji)</label>
            <input id="editCatIcon" class="input" value="${cat.icon || ''}" />
            <label>Keywords (pisah koma)</label>
            <input id="editCatKeywords" class="input" value="${cat.keywords?cat.keywords.join(', '):''}" />
            <label>Budget (angka)</label>
            <input id="editCatBudget" class="input" value="${cat.budget || ''}" />
          </div>`;
          openModalWithContent(html, ()=>{
            // save
            const name = document.getElementById('editCatName').value.trim();
            const icon = document.getElementById('editCatIcon').value.trim() || cat.icon || '🔖';
            const keywords = document.getElementById('editCatKeywords').value.split(',').map(s=>s.trim()).filter(Boolean);
            const budgetVal = parseCurrencyString(document.getElementById('editCatBudget').value.trim());
            if(!name){ showToast('Nama kategori dibutuhkan','error'); return; }
            cat.name = name; cat.icon = icon; cat.keywords = keywords; cat.budget = budgetVal;
            saveCategories(); renderCategorySelect(); renderBudgets(); showToast('Kategori diperbarui','success');
          }, ()=>{ showToast('Edit dibatalkan','info'); }, 'Simpan', 'Batal');
        };
      });

      el.querySelectorAll('.del-cat').forEach(btn=>{
        btn.onclick = ()=>{
          const id = btn.getAttribute('data-cat');
          if(!id || id === 'uncategorized'){ showToast('Kategori ini tidak dapat dihapus','error'); return; }
          const cat = categories.find(c=>c.id===id);
          if(!cat) return;
          openConfirm(`Hapus kategori "${cat.name}"? Semua transaksi di kategori ini akan dipindahkan ke 'Lainnya'.`, ()=>{
            // backup deleted category and affected transactions
            const deleted = { ...cat };
            const affectedTxIds = transactions.filter(t=>t.category === id).map(t=>t.id);
            // move transactions to uncategorized
            transactions = transactions.map(t=> ({ ...t, category: t.category === id ? 'uncategorized' : t.category }));
            // remove category
            categories = categories.filter(c=>c.id !== id);
            saveCategories(); save(); renderCategorySelect(); renderBudgets(); render();
            // show undo toast
            showToast(`Kategori "${deleted.name}" dihapus`, 'warning', 8000, 'Undo', ()=>{
              // restore category if not existing
              if(!categories.find(c=>c.id === deleted.id)){
                const idx = categories.findIndex(c=>c.id === 'uncategorized');
                if(idx === -1) categories.push(deleted);
                else categories.splice(idx+1,0,deleted);
              }
              // move affected transactions back to restored category
              transactions = transactions.map(t => affectedTxIds.includes(t.id) ? { ...t, category: deleted.id } : t);
              saveCategories(); save(); renderCategorySelect(); renderBudgets(); render();
              showToast(`Kategori "${deleted.name}" dipulihkan`,'success');
            });
          }, ()=>{ showToast('Hapus kategori dibatalkan','info'); });
        };
      });
    }

    function addCategory(name, icon='🔖', budget=0){
      const id = name.toLowerCase().replace(/\s+/g,'_');
      if(categories.find(c=>c.id===id)){ showToast('Kategori sudah ada','error'); return; }
      categories.push({id,name,icon,budget});
      saveCategories(); renderCategorySelect(); renderBudgets();
    }

    function addTransaction(desc, amount, date = new Date().toISOString(), category='uncategorized'){
      const tx = { id: Date.now(), desc, amount: Number(amount), date, category };
      transactions.unshift(tx);
      save();
      render();
      renderBudgets();
      // notify if over budget
      const now = new Date(date);
      const spent = computeSpentForCategoryMonth(category, now.getFullYear(), now.getMonth());
      const cat = categories.find(c=>c.id===category);
      if(cat && cat.budget>0 && spent>cat.budget){
        // non-blocking toast notification
        setTimeout(()=> showToast(`⚠️ Budget untuk ${cat.name} terlampaui (${(spent).toLocaleString('id-ID')} > ${(cat.budget).toLocaleString('id-ID')})`,'warning'), 100);
      }
    }

    function removeTransaction(id){
      transactions = transactions.filter(t=>t.id !== id);
      save();
      render();
      renderBudgets();
    }

    // Modal elements for confirmation
    const modal = document.getElementById('confirmModal');
    const modalBody = document.getElementById('confirmModalBody');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');

    function openConfirm(message, onYes, onNo){
      if(!modal) { const proceed = window.confirm(message); if(proceed){ onYes && onYes(); } else { onNo && onNo(); } return; }
      modalBody.innerText = message;
      modal.classList.add('show'); modal.setAttribute('aria-hidden','false');
      function cleanup(){ modal.classList.remove('show'); modal.setAttribute('aria-hidden','true'); confirmYes.onclick = null; confirmNo.onclick = null; modal.removeEventListener('click', backdropHandler); document.removeEventListener('keydown', keyHandler); }
      function keyHandler(e){ if(e.key === 'Escape'){ cleanup(); onNo && onNo(); } }
      function backdropHandler(e){ if(e.target === modal || e.target.classList.contains('modal-backdrop')){ cleanup(); onNo && onNo(); } }
      confirmYes.onclick = ()=>{ cleanup(); onYes && onYes(); };
      confirmNo.onclick = ()=>{ cleanup(); onNo && onNo(); };
      modal.addEventListener('click', backdropHandler);
      document.addEventListener('keydown', keyHandler);
      confirmYes.focus();
    }

    function confirmAndRemove(id){
      const tx = transactions.find(t=>t.id===id);
      if(!tx){ showToast('Transaksi tidak ditemukan','error'); return; }
      openConfirm(`Hapus transaksi "${tx.desc || '(tanpa keterangan)'}" sebesar ${fmt(Math.abs(tx.amount))}? Aksi ini dapat dibatalkan dalam beberapa detik.`, ()=>{
        // perform deletion but allow undo
        // remove now
        removeTransaction(id);
        // show undo toast
        showToast('Transaksi dihapus','success',8000,'Undo', ()=>{
          // restore
          transactions.unshift(tx);
          save();
          render();
          renderBudgets();
          showToast('Penghapusan dibatalkan','success');
        });
      }, ()=>{ showToast('Hapus dibatalkan','info'); });
    }

    const clearExamplesBtn = document.getElementById('clearExamplesBtn');
    function updateClearExamplesBtn(){
      if(!clearExamplesBtn) return;
      const hasExamples = transactions.some(t => typeof t.desc === 'string' && /^Contoh:/i.test(t.desc));
      clearExamplesBtn.disabled = !hasExamples;
      clearExamplesBtn.style.opacity = hasExamples ? '1' : '.5';
    }

    if(clearExamplesBtn){
      clearExamplesBtn.addEventListener('click', ()=>{
        openConfirm('Hapus semua transaksi contoh (Contoh: ...)?', ()=>{
          const before = transactions.length;
          transactions = transactions.filter(t => !(typeof t.desc === 'string' && /^Contoh:/i.test(t.desc)));
          save(); render(); renderBudgets(); updateClearExamplesBtn();
          showToast(`Dihapus ${before - transactions.length} transaksi contoh`,'success');
        }, ()=>{ showToast('Penghapusan contoh dibatalkan','info'); });
      });
    }

    if(refreshBtn){
      refreshBtn.addEventListener('click', ()=>{
        load();
        renderCategorySelect();
        render();
        renderBudgets();
        updateClearExamplesBtn();
        showToast('Data disegarkan','success');
      });
    }

    function render(){
      // totals
      const totalIncome = transactions.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0);
      const totalExpense = transactions.filter(t=>t.amount<0).reduce((s,t)=>s+t.amount,0);
      const balance = totalIncome + totalExpense;

      incomeEl.innerText = `Pemasukan: ${fmt(totalIncome)}`;
      expenseEl.innerText = `Pengeluaran: ${fmt(Math.abs(totalExpense))}`;
      balanceEl.innerText = fmt(balance);
      txCountEl.innerText = transactions.length;

      // list
      txListEl.innerHTML = '';
      transactions.forEach(tx => {
        const el = document.createElement('div'); el.className='tx';
        const left = document.createElement('div'); left.className='meta';
        const cat = categories.find(c=>c.id===tx.category) || categories[0];
        const title = document.createElement('div'); title.innerHTML = `<span style="margin-right:8px">${cat.icon}</span> ${tx.desc || '(tanpa keterangan)'}`;
        const date = document.createElement('div'); date.className='hint'; date.innerText = new Date(tx.date).toLocaleString();
        left.appendChild(title); left.appendChild(date);
        const right = document.createElement('div'); right.style.display='flex'; right.style.alignItems='center'; right.style.gap='12px';
        const amt = document.createElement('div'); amt.className='amount ' + (tx.amount>0 ? 'in':'out'); amt.innerText = fmt(tx.amount);
        const del = document.createElement('button'); del.className='btn ghost'; del.innerText='Hapus'; del.onclick = ()=> confirmAndRemove(tx.id);
        right.appendChild(amt); right.appendChild(del);
        el.appendChild(left); el.appendChild(right);
        txListEl.appendChild(el);
      });

      renderChart();
    }

    function renderChart(){
      if(!ctx) return; // canvas not available
      // Group by month (last 6 months)
      const now = new Date();
      const months = [];
      for(let i=5;i>=0;i--){
        const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        months.push({ key, label: d.toLocaleString('id-ID',{month:'short',year:'numeric'}), income:0, expense:0 });
      }
      transactions.forEach(t=>{
        const d = new Date(t.date);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        const m = months.find(x=>x.key===key);
        if(m){ if(t.amount>0) m.income += t.amount; else m.expense += Math.abs(t.amount); }
      });
      const labels = months.map(m=>m.label);
      const incomes = months.map(m=>m.income);
      const expenses = months.map(m=>m.expense);

      if(chart) chart.destroy();
      chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Pemasukan', data: incomes, backgroundColor: '#10b981' },
            { label: 'Pengeluaran', data: expenses, backgroundColor: '#ef4444' }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'top' } },
          scales: { y: { ticks: { callback: v => 'Rp' + v.toLocaleString('id-ID') } } }
        }
      });
    }

    // actions
    addBtn.onclick = ()=>{
      const desc = descEl.value.trim();
      const raw = amountEl.value.trim();
      let amt = parseCurrencyString(raw);
      if(!raw){ showToast('Isi nominal dulu','error'); return; }
      const typ = typeEl.value;
      if(typ === 'expense') amt = -Math.abs(amt);
      else amt = Math.abs(amt);
      const catId = document.getElementById('category') ? document.getElementById('category').value : 'uncategorized';
      addTransaction(desc, amt, undefined, catId);
      descEl.value=''; amountEl.value='';
    }

    // quick text add
    const quickBtn = document.getElementById('quickAddBtn');
    const quickText = document.getElementById('quickText');
    if(quickBtn){
      quickBtn.onclick = ()=>{
        const t = quickText.value.trim(); if(!t) return;
        // accept formats like "Rp2000", "2000", "1.200.000", "1,200,000"
        // match longest number (with grouping separators) and optionally an Rp prefix
        const amtMatch = t.match(/(?:Rp\s*)?(\d+(?:[.,]\d{3})*(?:[.,]\d+)?)/i);
        if(!amtMatch){ showToast('Tidak menemukan nominal di teks','error'); return; }
        const numStr = amtMatch[1] || amtMatch[0];
        let amt = parseCurrencyString(numStr);
        const lower = t.toLowerCase();
        const isExpense = /\b(beli|belanja|bayar|pakai|kurang|keluar|utang|kebayar|makan|minum|jajan|donasi|ongkos|ongkir)\b/i.test(lower);
        const isIncome = /\b(terima|gaji|salary|bonus|penerimaan|income|dapat)\b/i.test(lower);
        if(isExpense) amt = -Math.abs(amt);
        else if(isIncome) amt = Math.abs(amt);
        // Determine category by keywords first (word boundaries), then by name
        let catId = document.getElementById('category') ? document.getElementById('category').value : 'uncategorized';
        for(const c of categories){
          if(c.keywords && c.keywords.some(k=> new RegExp('\\b'+escapeRegExp(k)+'\\b','i').test(lower))){ catId = c.id; break; }
        }
        // fallback: check name match with boundaries
        if(catId === 'uncategorized'){
          for(const c of categories){ if(new RegExp('\\b'+escapeRegExp(c.name.toLowerCase())+'\\b').test(lower)){ catId = c.id; break; } }
        }
        const desc = t.replace(amtMatch[0],'').trim();
        addTransaction(desc || 'Quick add', amt, new Date().toISOString(), catId);
        quickText.value='';
      }
    }

    // add category via UI
    const addCatBtn = document.getElementById('addCatBtn');
    if(addCatBtn){
      addCatBtn.onclick = ()=>{
        const n = document.getElementById('newCatName').value.trim();
        const i = document.getElementById('newCatIcon').value.trim() || '🔖';
        const b = parseCurrencyString(document.getElementById('newCatBudget').value.trim());
        if(!n){ showToast('Nama kategori dibutuhkan','error'); return; }
        addCategory(n, i || '🔖', b);
        document.getElementById('newCatName').value=''; document.getElementById('newCatIcon').value=''; document.getElementById('newCatBudget').value='';
      }
    }

    // File preview and OCR
    let lastFile = null;
    fileInput.onchange = e => {
      const f = e.target.files[0];
      lastFile = f;
      if(!f) return;
      const url = URL.createObjectURL(f);
      imgPreview.innerHTML = '';
      const im = document.createElement('img'); im.src = url; im.style.width='100%'; im.style.height='100%'; im.style.objectFit='cover';
      imgPreview.appendChild(im);
      ocrHint.innerText = 'File siap discan. Tekan Scan.';
    }

    scanBtn.onclick = async ()=>{
      if(!lastFile){ showToast('Pilih gambar dulu','error'); return; }
      // file size guard (>6MB)
      if(lastFile.size && lastFile.size > 6 * 1024 * 1024){
        showToast('Ukuran file terlalu besar untuk discan (>6MB)','warning');
        return;
      }

      // quick availability check for Tesseract (allow fallback to Tesseract.recognize)
      if(typeof Tesseract === 'undefined' || (typeof Tesseract.createWorker === 'undefined' && typeof Tesseract.recognize !== 'function')){
        showToast('Library OCR tidak tersedia. Pastikan koneksi internet atau jalankan halaman lewat server lokal (http).','error',8000);
        ocrHint.innerText = 'OCR tidak tersedia.';
        return;
      }

      ocrHint.innerText = 'Scanning... (harap tunggu)';
      const origText = scanBtn.innerText;
      scanBtn.disabled = true; scanBtn.innerText = 'Scanning...';
      let worker = null;
      const OCR_TIMEOUT_MS = 30000; // 30s
      let timeoutId = null;

      try{
        const { createWorker } = Tesseract;
        let ocrText = null;
        let lastRes = null; // keep full result (with words & boxes) for advanced selection

        // Prefer worker API when fully supported; if the returned worker lacks the expected
        // methods, gracefully fall back to Tesseract.recognize instead of throwing.
        let triedWorker = false;
        if(createWorker && typeof createWorker === 'function'){
          try{
            worker = createWorker({ logger: m => {
              if(m && m.status){
                if(typeof m.progress === 'number'){
                  const pct = Math.round(m.progress * 100);
                  ocrHint.innerText = `Scanning... ${pct}%`;
                } else {
                  ocrHint.innerText = m.status;
                }
              }
            } });
          }catch(e){
            console.warn('createWorker threw during construction, will fallback to recognize():', e);
            worker = null;
          }

          if(worker && typeof worker.load === 'function'){
            triedWorker = true;
            await worker.load();
            await worker.loadLanguage('eng');
            await worker.initialize('eng');

            // race recognize with a timeout so UI doesn't hang indefinitely
            const recognizePromise = worker.recognize(lastFile);
            const res = await Promise.race([
              recognizePromise,
              new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error('OCR timeout')), OCR_TIMEOUT_MS); })
            ]);
            if(timeoutId) clearTimeout(timeoutId);

            lastRes = res;
            ocrText = (res && res.data && res.data.text) ? res.data.text : (res.text || '');
            await worker.terminate();
            worker = null;
          }
        }

        // If worker wasn't usable, try the older Tesseract.recognize API as a fallback
        if(!triedWorker){
          if(typeof Tesseract.recognize === 'function'){
            console.warn('Worker API not supported by this build; using Tesseract.recognize fallback');
            const progressHandler = m => {
              if(m && m.status){
                if(typeof m.progress === 'number'){
                  const pct = Math.round(m.progress * 100);
                  ocrHint.innerText = `Scanning... ${pct}%`;
                } else {
                  ocrHint.innerText = m.status;
                }
              }
            };
            const recognizePromise = Tesseract.recognize(lastFile, 'eng', { logger: progressHandler });
            const res = await Promise.race([
              recognizePromise,
              new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error('OCR timeout')), OCR_TIMEOUT_MS); })
            ]);
            if(timeoutId) clearTimeout(timeoutId);
            lastRes = res;
            ocrText = (res && res.data && res.data.text) ? res.data.text : (res.text || '');
          } else {
            throw new Error('Tesseract API not available');
          }
        }

        if(!ocrText || !ocrText.trim()){
          showToast('Tidak menemukan teks pada gambar. Coba tingkatkan kontras atau gunakan foto lain.','warning');
          ocrHint.innerText = 'Tidak menemukan teks pada gambar.';
          return;
        }

        // try to find currency amounts (also accept plain numbers)
        // Prefer lines containing the explicit word "total" (exclude "subtotal") when possible
        let amtFromTotalLine = null;
        const lines = ocrText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        // search from bottom up for the most likely "total" line
        for(let i = lines.length - 1; i >= 0; i--){
          const ln = lines[i];
          const low = ln.toLowerCase();
          if(/\btotal\b/i.test(low) && !/\bsubtotal\b/i.test(low)){
            const found = ln.match(/Rp\s*[0-9.,]+|\d+(?:[.,]\d{3})*(?:[.,]\d+)?/g);
            if(found && found.length){
              // pick last numeric token in the total line (handles formats like "Total Rp 70.000")
              amtFromTotalLine = parseCurrencyString(found[found.length-1]);
              break;
            }
          }
        }

        if(amtFromTotalLine !== null){
          const lower = ocrText.toLowerCase();
          const isIncome = /income|pemasukan|gaji|salary/.test(lower);
          const amt = isIncome ? Math.abs(amtFromTotalLine) : -Math.abs(amtFromTotalLine);
          let catId = 'uncategorized';
          for(const c of categories){ if(c.keywords && c.keywords.some(k=> new RegExp('\\b'+escapeRegExp(k)+'\\b','i').test(lower))){ catId = c.id; break; } }
          addTransaction('Scan: total', amt, new Date().toISOString(), catId);
          ocrHint.innerText = `Terbaca total: ${fmt(amtFromTotalLine)} — masuk sebagai ${isIncome? 'income':'pengeluaran'}`;
          showToast('Scan berhasil: ' + fmt(amt),'success');
        } else {
          // Advanced heuristic: prefer currency tokens that are emphasized (e.g., preceded by "Rp", bold/darker text or visually brighter/different)
          // We'll use detailed OCR words (if available) and sample the image pixels within each word bbox to compute a simple emphasis score.
          let amtPicked = null;
          let foundDesc = null;
          const currencyRe = /Rp\s*[0-9.,]+|\d+(?:[.,]\d{3})*(?:[.,]\d+)?/gi;

          async function loadImage(file, maxDim = 800){
            return new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => {
                // scale down for performance
                const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve({ img, canvas, ctx, scale });
              };
              img.onerror = reject;
              img.src = URL.createObjectURL(file);
            });
          }

          function getBoxForWord(w){
            // handle common bbox shapes
            if(w.bbox && typeof w.bbox.x0 !== 'undefined'){
              return { x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0 };
            }
            if(typeof w.left !== 'undefined'){
              return { x: w.left, y: w.top, w: w.width || 0, h: w.height || 0 };
            }
            return null;
          }

          async function sampleDarkRatio(canvas, box){
            const { x, y, w, h } = box;
            if(w <= 0 || h <= 0) return 0;
            try{
              const ctx = canvas.getContext('2d');
              // clamp to canvas
              const sx = Math.max(0, Math.floor(x));
              const sy = Math.max(0, Math.floor(y));
              const sw = Math.max(1, Math.min(canvas.width - sx, Math.ceil(w)));
              const sh = Math.max(1, Math.min(canvas.height - sy, Math.ceil(h)));
              const data = ctx.getImageData(sx, sy, sw, sh).data;
              let dark = 0; let total = 0;
              for(let i = 0; i < data.length; i += 4){
                const r = data[i], g = data[i+1], b = data[i+2];
                // luminance
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                if(lum < 140) dark++;
                total++;
              }
              return total ? (dark / total) : 0;
            }catch(e){ return 0; }
          }

          // Use detailed OCR word boxes when available to score candidate numeric tokens
          if(lastRes && lastRes.data && Array.isArray(lastRes.data.words) && lastFile){
            try{
              const { canvas, scale } = await loadImage(lastFile);
              const words = lastRes.data.words;
              const candidates = [];
              for(let i = 0; i < words.length; i++){
                const w = words[i];
                const txt = (w.text || '').trim();
                if(!txt) continue;
                // check explicit Rp or numeric content
                currencyRe.lastIndex = 0;
                const numericMatch = txt.match(currencyRe);
                const prev = words[i-1] ? (words[i-1].text || '') : '';
                const next = words[i+1] ? (words[i+1].text || '') : '';
                // tokens that are numeric or adjacent to 'Rp' are candidates
                const isNumericToken = !!numericMatch || /\d/.test(txt);
                const hasRpNearby = /\brp\b/i.test(txt) || /\brp\b/i.test(prev) || /\brp\b/i.test(next);
                if(!isNumericToken && !hasRpNearby) continue;

                // get bbox and map to scaled canvas coordinates
                const b = getBoxForWord(w);
                if(!b) continue;
                const box = { x: Math.max(0, Math.round(b.x * scale)), y: Math.max(0, Math.round(b.y * scale)), w: Math.round(b.w * scale), h: Math.round(b.h * scale) };
                const darkRatio = await sampleDarkRatio(canvas, box);
                const sizeScore = (box.h / Math.max(1, canvas.height));
                const conf = (typeof w.confidence === 'number' ? (w.confidence / 100) : 0);
                // numeric value extraction: prefer numeric part in txt or nearby next token
                let amtVal = null;
                if(numericMatch && numericMatch.length){
                  amtVal = parseCurrencyString(numericMatch[numericMatch.length - 1]);
                } else {
                  // try next word
                  if(next && next.match(currencyRe)){
                    const nm = next.match(currencyRe);
                    amtVal = parseCurrencyString(nm[nm.length-1]);
                  }
                }
                // compute score: prioritize explicit Rp, dark text (bold), larger font (size), and OCR confidence
                const score = (hasRpNearby ? 3 : 0) + (darkRatio * 2) + (sizeScore * 2) + (conf * 1);
                if(amtVal && amtVal > 0){
                  candidates.push({ score, amt: amtVal, text: txt, idx: i, darkRatio, sizeScore, conf });
                }
              }

              if(candidates.length){
                candidates.sort((a,b) => b.score - a.score);
                const best = candidates[0];
                amtPicked = best.amt;
                foundDesc = `Scan (pilihan visual)`;
              }
            }catch(e){ console.warn('Emphasis scoring failed, falling back:', e); }
          }

          // fallback: use the 'amount under name' heuristic (transfer receipts) if emphasis didn't find any
          if(amtPicked === null){
            let amtUnderName = null;
            let nameDetected = null;
            for(let i = 0; i < lines.length - 1; i++){
              const cur = lines[i];
              const nxt = lines[i+1];
              // require current line to look like a name (letters, not mostly digits) and next line to contain a currency-like token
              if(/[A-Za-z]/.test(cur) && !/\d/.test(cur) && /\d/.test(nxt)){
                currencyRe.lastIndex = 0;
                const found = nxt.match(currencyRe);
                if(found && found.length){
                  amtUnderName = parseCurrencyString(found[found.length - 1]);
                  nameDetected = cur;
                  break;
                }
              }
            }
            if(amtUnderName !== null){ amtPicked = amtUnderName; foundDesc = `Scan: ${nameDetected || 'hasil scan'}`; }
          }

          // still no visual pick: fall back to largest numeric token as before
          if(amtPicked === null){
            const matches = ocrText.match(/Rp\s*[0-9.,]+|\d+(?:[.,]\d{3})*(?:[.,]\d+)?/g);
            if(matches && matches.length){
              const nums = matches.map(m => parseCurrencyString(m));
              const max = Math.max(...nums);
              amtPicked = max;
              foundDesc = `Scan: ${matches[0]||'hasil scan'}`;
            }
          }

          if(amtPicked !== null){
            const lower = ocrText.toLowerCase();
            const isIncome = /income|pemasukan|gaji|salary/.test(lower);
            const amt = isIncome ? Math.abs(amtPicked) : -Math.abs(amtPicked);
            // pick category by keyword
            let catId = 'uncategorized';
            for(const c of categories){ if(c.keywords && c.keywords.some(k=> new RegExp('\\b'+escapeRegExp(k)+'\\b','i').test(lower))){ catId = c.id; break; } }
            addTransaction(foundDesc || 'Scan result', amt, new Date().toISOString(), catId);
            // show emphasized hint if detection used visual scoring
            if(foundDesc && foundDesc.toLowerCase().includes('visual')){
              ocrHint.innerText = `Terbaca (ditekankan): ${fmt(amtPicked)}`;
            } else {
              ocrHint.innerText = `Terbaca: ${fmt(amtPicked)}`;
            }
            showToast('Scan berhasil: ' + fmt(amt),'success');
          } else {
            ocrHint.innerText = 'Tidak menemukan angka pada gambar.';
            showToast('Tidak menemukan angka pada gambar.','warning');
          }
        }
      }catch(err){
        console.error(err);
        const msg = err && err.message ? err.message : String(err);
        if(msg.includes('OCR timeout')){
          showToast('Proses scanning melebihi batas waktu. Coba gunakan foto dengan resolusi lebih rendah atau periksa koneksi.','error',8000);
          ocrHint.innerText = 'Timeout saat scanning.';
        } else if(/wasm|failed to fetch|worker/i.test(msg)){
          showToast('OCR gagal dimuat. Jika membuka file lewat file://, jalankan server lokal atau periksa koneksi.','error',8000);
          ocrHint.innerText = 'Gagal memuat engine OCR.';
        } else {
          showToast('Error saat scanning: ' + msg,'error',8000);
          ocrHint.innerText = 'Error saat scanning.';
        }
      }finally{
        try{ if(timeoutId) clearTimeout(timeoutId); }catch(e){}
        try{ if(worker) await worker.terminate(); }catch(e){}
        scanBtn.disabled = false; scanBtn.innerText = origText;
      }
    }

    // Theme (light / dark)
    const THEME_KEY = 'mm_theme';
    const themeToggle = document.getElementById('themeToggle');
    function applyTheme(theme){
      if(theme === 'light') document.documentElement.setAttribute('data-theme','light');
      else document.documentElement.removeAttribute('data-theme');
      if(themeToggle){
        themeToggle.innerText = theme === 'light' ? '☀️' : '🌙';
        themeToggle.setAttribute('aria-pressed', theme === 'light');
      }
    }
    (function initTheme(){
      const saved = localStorage.getItem(THEME_KEY);
      const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
      const initThemeVal = saved || (prefersLight ? 'light' : 'dark');
      applyTheme(initThemeVal);
      if(themeToggle){
        themeToggle.addEventListener('click', ()=>{
          const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
          const next = current === 'light' ? 'dark' : 'light';
          localStorage.setItem(THEME_KEY, next);
          applyTheme(next);
        });
      }
      if(window.matchMedia){
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        mq.addEventListener('change', e => {
          if(!localStorage.getItem(THEME_KEY)){
            applyTheme(e.matches ? 'dark' : 'light');
          }
        });
      }
    })();

    // Accessibility: senior-friendly large-mode toggle
    const ACCESS_KEY = 'mm_accessibility';
    const accessToggle = document.getElementById('accessToggle');
    const accessToggleSm = document.getElementById('accessToggleSm');
    function applyAccessibility(enabled){
      if(enabled) document.documentElement.setAttribute('data-accessibility','large');
      else document.documentElement.removeAttribute('data-accessibility');
      if(accessToggle){
        accessToggle.setAttribute('aria-pressed', !!enabled);
        accessToggle.innerText = enabled ? 'A+' : 'A+';
      }
      if(accessToggleSm){ accessToggleSm.setAttribute('aria-pressed', !!enabled); }
    }
    if(accessToggleSm){ accessToggleSm.addEventListener('click', ()=> accessToggle && accessToggle.click()); }
    const themeToggleSm = document.getElementById('themeToggleSm');
    if(themeToggleSm){ themeToggleSm.addEventListener('click', ()=> themeToggle && themeToggle.click()); }
    const refreshBtnSm = document.getElementById('refreshBtnSm');
    if(refreshBtnSm){ refreshBtnSm.addEventListener('click', ()=> refreshBtn && refreshBtn.click()); }
    (function initAccessibility(){
      const saved = localStorage.getItem(ACCESS_KEY);
      const initVal = saved === 'large';
      applyAccessibility(initVal);
      if(accessToggle){
        accessToggle.addEventListener('click', ()=>{
          const current = document.documentElement.getAttribute('data-accessibility') === 'large';
          const next = !current;
          applyAccessibility(next);
          localStorage.setItem(ACCESS_KEY, next ? 'large' : 'normal');
        });
      }
    })();

    // init
    (function init(){
      load();
      renderCategorySelect();
      renderBudgets();
      // add sample data if empty
      if(transactions.length===0){
        addTransaction('Contoh: Gaji', 5000000, new Date().toISOString(), 'salary');
        addTransaction('Contoh: Belanja', -250000, new Date().toISOString(), 'shopping');
      } else render();
      // update UI for example-clear button
      updateClearExamplesBtn();
    })();

  }catch(e){
    console.error('Init error:', e);
    showToast('Terjadi error saat inisialisasi aplikasi. Periksa console untuk detail.','error');
  }
});
