// ============================================================
// ClearFlow — UI Controller
// ============================================================
'use strict';

// Wait for engine to load
document.addEventListener('DOMContentLoaded', () => {
  const E = window.Engine;

  // ── State ───────────────────────────────────────────────
  let state = E.Storage.load();

  function save() { E.Storage.save(state); }

  function activeAccount() {
    return state.accounts.find(a => a.id === state.activeAccountId) || state.accounts[0];
  }

  // ── Auto-save on any input change ───────────────────────
  document.addEventListener('input',  debounce(save, 400));
  document.addEventListener('change', debounce(save, 400));

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ── Tab switching ────────────────────────────────────────
  const TAB_SETUP = document.getElementById('tab-setup');
  const TAB_PROJ  = document.getElementById('tab-proj');

  function switchTab(name) {
    document.querySelectorAll('.main-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    TAB_SETUP.classList.toggle('active', name === 'setup');
    TAB_PROJ .classList.toggle('active', name === 'proj');
    if (name === 'proj') renderProjections();
  }

  document.querySelectorAll('.main-tab[data-tab]').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
  });

  // ── Account strip ────────────────────────────────────────
  function renderAccountStrip() {
    const strip = document.getElementById('account-strip');
    strip.innerHTML = '';
    state.accounts.forEach(acct => {
      const chip = document.createElement('div');
      const isActive = acct.id === state.activeAccountId;
      chip.className = 'acc-chip' + (isActive ? ' active' : '');

      const nameSpan = document.createElement('span');
      nameSpan.textContent = acct.name;
      chip.appendChild(nameSpan);

      // Edit pencil — only visible on active chip
      if (isActive) {
        const editIcon = document.createElement('span');
        editIcon.className = 'acc-edit-icon';
        editIcon.textContent = ' ✎';
        editIcon.title = 'Rename account';
        editIcon.addEventListener('click', e => {
          e.stopPropagation();
          showRenameModal(acct);
        });
        chip.appendChild(editIcon);
      }

      chip.addEventListener('click', () => {
        state.activeAccountId = acct.id;
        save();
        renderAll();
      });
      strip.appendChild(chip);
    });
    const addChip = document.createElement('div');
    addChip.className = 'acc-chip add-acc';
    addChip.textContent = '+ Add Account';
    addChip.addEventListener('click', () => showAddAccountModal());
    strip.appendChild(addChip);
  }

  // ── Rename Account Modal ─────────────────────────────────
  let _renameTarget = null;

  function showRenameModal(acct) {
    _renameTarget = acct;
    const overlay = document.getElementById('rename-overlay');
    const input   = document.getElementById('rename-input');
    input.value = acct.name;
    overlay.classList.remove('hidden');
    setTimeout(() => input.focus(), 50);
  }

  document.getElementById('rename-cancel').addEventListener('click', () => {
    document.getElementById('rename-overlay').classList.add('hidden');
  });
  document.getElementById('rename-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });
  document.getElementById('rename-confirm').addEventListener('click', () => {
    const name = document.getElementById('rename-input').value.trim();
    if (_renameTarget && name) {
      _renameTarget.name = name;
      save();
      renderAll();
    }
    document.getElementById('rename-overlay').classList.add('hidden');
  });
  document.getElementById('rename-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('rename-confirm').click();
  });

  // ── Reset All Data ───────────────────────────────────────
  document.getElementById('reset-btn').addEventListener('click', () => {
    document.getElementById('reset-overlay').classList.remove('hidden');
  });
  document.getElementById('reset-cancel').addEventListener('click', () => {
    document.getElementById('reset-overlay').classList.add('hidden');
  });
  document.getElementById('reset-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });
  document.getElementById('reset-confirm').addEventListener('click', () => {
    localStorage.removeItem('clearflow_v1');
    document.getElementById('reset-overlay').classList.add('hidden');
    state = E.createDefaultState();
    save();
    renderAll();
  });

  // ── Add Account Modal ────────────────────────────────────
  function showAddAccountModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('hidden');
    document.getElementById('modal-acct-name').value = '';
    document.getElementById('modal-acct-name').focus();
  }

  document.getElementById('modal-cancel').addEventListener('click', () => {
    document.getElementById('modal-overlay').classList.add('hidden');
  });
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });
  document.getElementById('modal-confirm').addEventListener('click', () => {
    const name = document.getElementById('modal-acct-name').value.trim() || 'New Account';
    const acct = E.createDefaultAccount(E.uid(), name);
    state.accounts.push(acct);
    state.activeAccountId = acct.id;
    save();
    document.getElementById('modal-overlay').classList.add('hidden');
    renderAll();
  });
  document.getElementById('modal-acct-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('modal-confirm').click();
  });

  // ── PDF Export ───────────────────────────────────────────
  document.getElementById('pdf-btn').addEventListener('click', exportPDF);

  function exportPDF() {
    const acct = activeAccount();
    const proj = E.buildProjection(acct, state.accounts);
    const t = E.today();

    let html = `
      <html><head><meta charset="utf-8">
      <style>
        body{font-family:Georgia,serif;padding:24px;color:#1a1d2e;font-size:13px;}
        h1{font-size:22px;color:#0d9e6e;margin-bottom:4px;}
        h2{font-size:15px;margin:18px 0 8px;border-bottom:1px solid #e0e4ec;padding-bottom:4px;}
        table{width:100%;border-collapse:collapse;margin-bottom:12px;}
        th{text-align:left;font-size:11px;color:#5a6082;padding:5px 8px;border-bottom:1px solid #e0e4ec;}
        td{padding:5px 8px;border-bottom:1px solid #f0f2f5;font-size:12px;}
        .pos{color:#0d9e6e;font-weight:600;} .neg{color:#dc2626;font-weight:600;}
        .sub{font-size:11px;color:#9aa0bb;}
      </style></head><body>
      <h1>ClearFlow Budget · ${acct.name}</h1>
      <p class="sub">Generated ${t.month}/${t.day}/${t.year}</p>
      <h2>12-Week Projection</h2>
      <table>
        <tr>
          <th>Week</th><th>Dates</th><th>Income</th><th>Expenses</th>
          <th>Savings</th><th>Ending Balance</th><th>Headroom</th>
        </tr>`;

    proj.forEach((w, i) => {
      const posNeg = w.endBalanceExpected >= 0 ? 'pos' : 'neg';
      html += `<tr>
        <td>Week ${i + 1}</td>
        <td class="sub">${E.fmtDateShort(w.window.start)} – ${E.fmtDateShort(w.window.end)}</td>
        <td class="pos">${E.fmt(w.totalIncome, true)}</td>
        <td class="neg">${E.fmt(-(w.totalExpenses), true)}</td>
        <td class="neg">${E.fmt(-(w.savingsOut), true)}</td>
        <td class="${posNeg}">${E.fmt(w.endBalanceExpected)}</td>
        <td class="${posNeg}">${E.fmt(w.headroomExpected, true)}</td>
      </tr>`;
    });

    html += `</table></body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `clearflow-${acct.name.replace(/\s+/g, '-').toLowerCase()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ═══════════════════════════════════════════════════════
  // SETUP TAB RENDERING
  // ═══════════════════════════════════════════════════════

  function renderSetup() {
    const acct = activeAccount();
    renderAccountStrip();
    renderBalanceCard(acct);
    renderIncomeSection(acct);
    renderExpensesSection(acct);
    renderOneTimeSection(acct);
    renderSavingsSection(acct);
    renderTransfersSection(acct);
    updateTodayDate();
  }

  function updateTodayDate() {
    const t = E.today();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    document.getElementById('today-date').textContent = `📅 ${months[t.month-1]} ${t.day}, ${t.year}`;
  }

  // ── Balance Card ─────────────────────────────────────────
  function renderBalanceCard(acct) {
    const input = document.getElementById('balance-input');
    input.value = acct.balance !== undefined ? acct.balance : '';
    input.oninput = () => {
      acct.balance = parseFloat(input.value.replace(/[^0-9.-]/g, '')) || 0;
      save();
    };
    document.getElementById('balance-acct-name').textContent = acct.name;
  }

  // ── Income Section ───────────────────────────────────────
  function renderIncomeSection(acct) {
    const body = document.getElementById('income-body');
    body.innerHTML = '';

    acct.income.forEach((inc, idx) => {
      body.appendChild(buildIncomeItem(acct, inc, idx));
    });

    const addBtn = makeAddBtn('+ Add Income Source', () => {
      acct.income.push(E.createIncomeItem());
      save();
      renderIncomeSection(acct);
      updateSectionTotal('income-total', acct.income.reduce((s, i) => s + (i.type === 'fixed' ? i.fixedAmount : i.expectedAmount), 0), true);
    });
    body.appendChild(addBtn);

    updateIncomeTotal(acct);
  }

  function updateIncomeTotal(acct) {
    const total = acct.income.reduce((s, i) => s + (i.type === 'fixed' ? i.fixedAmount : i.expectedAmount), 0);
    const el = document.getElementById('income-total');
    el.textContent = E.fmt(total, true);
    el.style.color = 'var(--green)';
  }

  function buildIncomeItem(acct, inc, idx) {
    const wrap = document.createElement('div');
    wrap.className = 'line-item';

    const isVariable = inc.type === 'variable';

    wrap.innerHTML = `
      <div class="line-item-top">
        <input class="item-name-input" type="text" placeholder="Income source name" value="${esc(inc.name)}">
        ${isVariable ? '<span class="badge-variable">Variable</span>' : ''}
        <div class="remove-btn" title="Remove">−</div>
      </div>
      <div class="income-type-toggle">
        <button class="income-type-btn ${!isVariable ? 'active-fixed' : ''}" data-val="fixed">Fixed</button>
        <button class="income-type-btn ${isVariable  ? 'active-variable' : ''}" data-val="variable">Variable</button>
      </div>
      <div class="income-fields-fixed" style="${isVariable ? 'display:none' : ''}">
        <div class="fields-1 mb6">
          <div class="field-wrap">
            <div class="field-label">Amount (each paycheck)</div>
            <input class="field-input green" type="number" step="0.01" min="0" placeholder="0.00" value="${inc.fixedAmount || ''}">
          </div>
        </div>
      </div>
      <div class="income-fields-variable" style="${isVariable ? '' : 'display:none'}">
        <div class="fields-2 mb6">
          <div class="field-wrap">
            <div class="field-label">Min Amount</div>
            <input class="field-input purple" type="number" step="0.01" min="0" placeholder="0.00" value="${inc.minAmount || ''}">
          </div>
          <div class="field-wrap">
            <div class="field-label">Expected Amount</div>
            <input class="field-input green" type="number" step="0.01" min="0" placeholder="0.00" value="${inc.expectedAmount || ''}">
          </div>
        </div>
      </div>
      <div class="fields-3">
        <div class="field-wrap">
          <div class="field-label">Frequency</div>
          <select class="field-select" data-field="frequency">
            <option value="weekly"   ${inc.frequency === 'weekly'   ? 'selected' : ''}>Weekly</option>
            <option value="biweekly" ${inc.frequency === 'biweekly' ? 'selected' : ''}>Bi-weekly</option>
            <option value="monthly"  ${inc.frequency === 'monthly'  ? 'selected' : ''}>Monthly</option>
          </select>
        </div>
        <div class="field-wrap">
          <div class="field-label">Pay Day</div>
          <select class="field-select" data-field="payDay">
            <option value="Friday"   ${inc.payDay === 'Friday'   ? 'selected' : ''}>Friday</option>
            <option value="Thursday" ${inc.payDay === 'Thursday' ? 'selected' : ''}>Thursday</option>
          </select>
        </div>
        <div class="field-wrap">
          <div class="field-label">Next Pay Date</div>
          <input class="field-input" type="date" value="${inc.nextPayDate || ''}" data-field="nextPayDate">
        </div>
      </div>
    `;

    // Name
    wrap.querySelector('.item-name-input').addEventListener('input', e => {
      inc.name = e.target.value;
      save();
      updateIncomeTotal(acct);
    });

    // Remove
    wrap.querySelector('.remove-btn').addEventListener('click', () => {
      acct.income.splice(idx, 1);
      save();
      renderIncomeSection(acct);
    });

    // Type toggle
    wrap.querySelectorAll('.income-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        inc.type = btn.dataset.val;
        save();
        renderIncomeSection(acct);
      });
    });

    // Fixed amount
    const fixedInput = wrap.querySelector('.income-fields-fixed input');
    if (fixedInput) fixedInput.addEventListener('input', e => {
      inc.fixedAmount = parseFloat(e.target.value) || 0;
      save();
      updateIncomeTotal(acct);
    });

    // Variable amounts
    const varInputs = wrap.querySelectorAll('.income-fields-variable input');
    if (varInputs[0]) varInputs[0].addEventListener('input', e => { inc.minAmount = parseFloat(e.target.value) || 0; save(); });
    if (varInputs[1]) varInputs[1].addEventListener('input', e => { inc.expectedAmount = parseFloat(e.target.value) || 0; save(); updateIncomeTotal(acct); });

    // Selects & date
    wrap.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('change', e => { inc[el.dataset.field] = e.target.value; save(); });
    });

    return wrap;
  }

  // ── Expenses Section ─────────────────────────────────────
  function renderExpensesSection(acct) {
    const body = document.getElementById('expenses-body');
    body.innerHTML = '';

    const t = E.today();
    const currentBucket = E.currentBucketId();
    const isFeb = (m) => m === 2;

    E.WEEK_BUCKETS.forEach(bucket => {
      const isCurrentBucket = bucket.id === currentBucket;
      const bucketExpenses = acct.expenses.filter(e => e.bucketId === bucket.id);
      const total = bucketExpenses.reduce((s, e) => s + e.amount, 0);

      const group = document.createElement('div');
      group.className = 'week-group';

      const nowTag  = isCurrentBucket ? `<span class="tag tag-current">Current</span>` : '';

      group.innerHTML = `
        <div class="week-group-header">
          <div class="week-label">${bucket.label} ${nowTag}</div>
          <div class="week-total" style="color:${total > 0 ? 'var(--red)' : 'var(--text-dim)'}">${total > 0 ? E.fmt(-total) : '—'}</div>
        </div>
        <div class="week-body ${isCurrentBucket ? '' : 'hidden'}" id="wbody-${bucket.id}">
          <div class="expense-rows-${bucket.id}"></div>
        </div>
      `;

      // Toggle open/close
      group.querySelector('.week-group-header').addEventListener('click', () => {
        const wb = group.querySelector('.week-body');
        wb.classList.toggle('hidden');
      });

      body.appendChild(group);

      // Render expense rows
      const rowsContainer = group.querySelector(`.expense-rows-${bucket.id}`);
      bucketExpenses.forEach((exp, idx) => {
        rowsContainer.appendChild(buildExpenseRow(acct, exp, idx, bucket, rowsContainer, group));
      });

      // Add expense button
      const addBtn = makeAddBtn('+ Add Expense', () => {
        const newExp = E.createExpenseItem({ bucketId: bucket.id, day: bucket.start });
        acct.expenses.push(newExp);
        save();
        renderExpensesSection(acct);
        updateExpensesTotal(acct);
        // Open the week body
        const wb = document.getElementById(`wbody-${bucket.id}`);
        if (wb) wb.classList.remove('hidden');
      });

      const wbody = group.querySelector('.week-body');
      wbody.appendChild(addBtn);
    });

    updateExpensesTotal(acct);
  }

  function buildExpenseRow(acct, exp, idx, bucket, container, group) {
    const row = document.createElement('div');
    row.className = 'expense-row';
    row.innerHTML = `
      <input class="expense-name-in" type="text" placeholder="Expense name" value="${esc(exp.name)}">
      <input class="expense-amt-in"  type="number" step="0.01" min="0" placeholder="0.00" value="${exp.amount || ''}">
      <div class="remove-btn">−</div>
    `;

    row.querySelector('.expense-name-in').addEventListener('input', e => { exp.name = e.target.value; save(); });
    row.querySelector('.expense-amt-in').addEventListener('input', e => {
      exp.amount = parseFloat(e.target.value) || 0;
      save();
      updateExpensesTotal(acct);
      updateWeekTotal(group, bucket, acct);
    });
    row.querySelector('.remove-btn').addEventListener('click', () => {
      const realIdx = acct.expenses.indexOf(exp);
      if (realIdx !== -1) acct.expenses.splice(realIdx, 1);
      save();
      renderExpensesSection(acct);
    });

    return row;
  }

  function updateWeekTotal(group, bucket, acct) {
    const total = acct.expenses.filter(e => e.bucketId === bucket.id).reduce((s, e) => s + e.amount, 0);
    const totalEl = group.querySelector('.week-total');
    if (totalEl) {
      totalEl.textContent = total > 0 ? E.fmt(-total) : '—';
      totalEl.style.color = total > 0 ? 'var(--red)' : 'var(--text-dim)';
    }
  }

  function updateExpensesTotal(acct) {
    const total = acct.expenses.reduce((s, e) => s + e.amount, 0);
    const el = document.getElementById('expenses-total');
    if (el) { el.textContent = E.fmt(-total); el.style.color = 'var(--red)'; }
  }

  // ── One-Time Expenses ────────────────────────────────────
  function renderOneTimeSection(acct) {
    const body = document.getElementById('onetime-body');
    body.innerHTML = '';

    acct.oneTimeExpenses.forEach((ot, idx) => {
      body.appendChild(buildOneTimeItem(acct, ot, idx));
    });

    body.appendChild(makeAddBtn('+ Add One-Time Expense', () => {
      acct.oneTimeExpenses.push(E.createOneTimeExpense());
      save();
      renderOneTimeSection(acct);
    }));

    updateOneTimeTotal(acct);
  }

  function buildOneTimeItem(acct, ot, idx) {
    const bucketLabel = ot.date ? (E.WEEK_BUCKETS.find(b => b.id === E.bucketForDate(ot.date))?.label || '—') : '—';
    const wrap = document.createElement('div');
    wrap.className = 'line-item';
    wrap.innerHTML = `
      <div class="line-item-top">
        <input class="item-name-input" type="text" placeholder="Description" value="${esc(ot.name)}">
        <div class="remove-btn">−</div>
      </div>
      <div class="fields-2">
        <div class="field-wrap">
          <div class="field-label">Amount</div>
          <input class="field-input red" type="number" step="0.01" min="0" placeholder="0.00" value="${ot.amount || ''}">
        </div>
        <div class="field-wrap">
          <div class="field-label">Date</div>
          <input class="field-input" type="date" value="${ot.date || ''}">
        </div>
      </div>
      <div class="text-dim mt-6">→ Slots into: <strong class="week-slot">${bucketLabel}</strong></div>
    `;
    wrap.querySelector('.item-name-input').addEventListener('input', e => { ot.name = e.target.value; save(); });
    wrap.querySelectorAll('input')[1].addEventListener('input', e => { ot.amount = parseFloat(e.target.value) || 0; save(); updateOneTimeTotal(acct); });
    wrap.querySelectorAll('input')[2].addEventListener('change', e => {
      ot.date = e.target.value;
      save();
      const lbl = ot.date ? (E.WEEK_BUCKETS.find(b => b.id === E.bucketForDate(ot.date))?.label || '—') : '—';
      wrap.querySelector('.week-slot').textContent = lbl;
    });
    wrap.querySelector('.remove-btn').addEventListener('click', () => {
      acct.oneTimeExpenses.splice(idx, 1);
      save();
      renderOneTimeSection(acct);
    });
    return wrap;
  }

  function updateOneTimeTotal(acct) {
    const total = acct.oneTimeExpenses.reduce((s, e) => s + e.amount, 0);
    const el = document.getElementById('onetime-total');
    if (el) { el.textContent = total > 0 ? E.fmt(-total) : '$0.00'; el.style.color = total > 0 ? 'var(--yellow)' : 'var(--text-muted)'; }
  }

  // ── Savings Section ──────────────────────────────────────
  function renderSavingsSection(acct) {
    const body = document.getElementById('savings-body');
    body.innerHTML = '';

    acct.savings.forEach((sav, idx) => {
      body.appendChild(buildSavingsItem(acct, sav, idx));
    });

    body.appendChild(makeAddBtn('+ Add Savings Goal', () => {
      acct.savings.push(E.createSavingsItem());
      save();
      renderSavingsSection(acct);
    }));

    updateSavingsTotal(acct);
  }

  function buildSavingsItem(acct, sav, idx) {
    const wrap = document.createElement('div');
    wrap.className = 'line-item';
    wrap.innerHTML = `
      <div class="line-item-top">
        <input class="item-name-input" type="text" placeholder="Savings goal name" value="${esc(sav.name)}">
        <div class="remove-btn">−</div>
      </div>
      <div class="fields-2">
        <div class="field-wrap">
          <div class="field-label">Amount</div>
          <input class="field-input purple" type="number" step="0.01" min="0" placeholder="0.00" value="${sav.amount || ''}">
        </div>
        <div class="field-wrap">
          <div class="field-label">Frequency</div>
          <select class="field-select">
            <option value="weekly"   ${sav.frequency === 'weekly'   ? 'selected' : ''}>Weekly</option>
            <option value="biweekly" ${sav.frequency === 'biweekly' ? 'selected' : ''}>Bi-weekly</option>
            <option value="monthly"  ${sav.frequency === 'monthly'  ? 'selected' : ''}>Monthly</option>
          </select>
        </div>
      </div>
    `;
    wrap.querySelector('.item-name-input').addEventListener('input', e => { sav.name = e.target.value; save(); });
    wrap.querySelectorAll('input')[1].addEventListener('input', e => { sav.amount = parseFloat(e.target.value) || 0; save(); updateSavingsTotal(acct); });
    wrap.querySelector('select').addEventListener('change', e => { sav.frequency = e.target.value; save(); });
    wrap.querySelector('.remove-btn').addEventListener('click', () => {
      acct.savings.splice(idx, 1);
      save();
      renderSavingsSection(acct);
    });
    return wrap;
  }

  function updateSavingsTotal(acct) {
    const total = acct.savings.reduce((s, e) => s + e.amount, 0);
    const el = document.getElementById('savings-total');
    if (el) { el.textContent = E.fmt(total) + ' / mo'; el.style.color = 'var(--accent2)'; }
  }

  // ── Transfers Section ────────────────────────────────────
  function renderTransfersSection(acct) {
    const body = document.getElementById('transfers-body');
    body.innerHTML = '';

    acct.transfers.forEach((tr, idx) => {
      body.appendChild(buildTransferItem(acct, tr, idx));
    });

    body.appendChild(makeAddBtn('+ Add Transfer', () => {
      acct.transfers.push(E.createTransferItem());
      save();
      renderTransfersSection(acct);
    }));

    const count = acct.transfers.length;
    const el = document.getElementById('transfers-total');
    if (el) { el.textContent = count + ' active'; el.style.color = 'var(--text-muted)'; }
  }

  function buildTransferItem(acct, tr, idx) {
    const otherAccounts = state.accounts.filter(a => a.id !== acct.id);
    const wrap = document.createElement('div');
    wrap.className = 'line-item';

    const isOnetime = tr.type === 'onetime';

    wrap.innerHTML = `
      <div class="line-item-top">
        <input class="item-name-input" type="text" placeholder="Transfer name" value="${esc(tr.name)}">
        <div class="remove-btn">−</div>
      </div>
      <div class="fields-2">
        <div class="field-wrap">
          <div class="field-label">Amount</div>
          <input class="field-input purple" type="number" step="0.01" min="0" placeholder="0.00" value="${tr.amount || ''}">
        </div>
        <div class="field-wrap">
          <div class="field-label">To Account</div>
          <select class="field-select to-acct">
            <option value="">Select account</option>
            ${otherAccounts.map(a => `<option value="${a.id}" ${tr.toAccountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="transfer-type-toggle">
        <div class="transfer-type-btn ${!isOnetime ? 'active' : ''}" data-val="regular">↻ Regular</div>
        <div class="transfer-type-btn ${isOnetime  ? 'active' : ''}" data-val="onetime">✦ One-time</div>
      </div>
      <div class="regular-fields" style="${isOnetime ? 'display:none' : ''}">
        <div class="field-wrap mt-6">
          <div class="field-label">Frequency</div>
          <select class="field-select freq-sel">
            <option value="weekly"   ${tr.frequency === 'weekly'   ? 'selected' : ''}>Weekly</option>
            <option value="biweekly" ${tr.frequency === 'biweekly' ? 'selected' : ''}>Bi-weekly</option>
            <option value="monthly"  ${tr.frequency === 'monthly'  ? 'selected' : ''}>Monthly</option>
          </select>
        </div>
      </div>
      <div class="onetime-fields" style="${isOnetime ? '' : 'display:none'}">
        <div class="field-wrap mt-6">
          <div class="field-label">Date</div>
          <input class="field-input" type="date" value="${tr.date || ''}">
        </div>
      </div>
    `;

    wrap.querySelector('.item-name-input').addEventListener('input', e => { tr.name = e.target.value; save(); });
    wrap.querySelectorAll('input')[1].addEventListener('input', e => { tr.amount = parseFloat(e.target.value) || 0; save(); });
    wrap.querySelector('.to-acct').addEventListener('change', e => { tr.toAccountId = e.target.value; save(); });

    wrap.querySelectorAll('.transfer-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        tr.type = btn.dataset.val;
        save();
        renderTransfersSection(acct);
      });
    });

    const freqSel = wrap.querySelector('.freq-sel');
    if (freqSel) freqSel.addEventListener('change', e => { tr.frequency = e.target.value; save(); });

    const dateIn = wrap.querySelector('.onetime-fields input');
    if (dateIn) dateIn.addEventListener('change', e => { tr.date = e.target.value; save(); });

    wrap.querySelector('.remove-btn').addEventListener('click', () => {
      acct.transfers.splice(idx, 1);
      save();
      renderTransfersSection(acct);
    });

    return wrap;
  }

  // ── Section collapse toggles ─────────────────────────────
  document.querySelectorAll('.section-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const body = hdr.nextElementSibling;
      if (!body) return;
      body.classList.toggle('hidden');
      hdr.classList.toggle('collapsed');
    });
  });

  // ═══════════════════════════════════════════════════════
  // PROJECTIONS TAB
  // ═══════════════════════════════════════════════════════

  function renderProjections() {
    const acct = activeAccount();
    const proj = E.buildProjection(acct, state.accounts);
    const container = document.getElementById('proj-weeks');
    container.innerHTML = '';

    // Projection account strip
    renderProjAccountStrip(acct);

    const hasAnyVariable = proj.some(w => w.hasVariable);

    if (hasAnyVariable) {
      document.getElementById('proj-info').style.display = '';
    } else {
      document.getElementById('proj-info').style.display = 'none';
    }

    proj.forEach((week, i) => {
      container.appendChild(buildWeekCard(week, i, acct));
    });
  }

  function renderProjAccountStrip(activeAcct) {
    const strip = document.getElementById('proj-account-strip');
    if (!strip) return;
    strip.innerHTML = '';
    state.accounts.forEach(acct => {
      const chip = document.createElement('div');
      const isActive = acct.id === activeAcct.id;
      chip.className = 'acc-chip' + (isActive ? ' active' : '');

      const nameSpan = document.createElement('span');
      nameSpan.textContent = acct.name;
      chip.appendChild(nameSpan);

      if (isActive) {
        const editIcon = document.createElement('span');
        editIcon.className = 'acc-edit-icon';
        editIcon.textContent = ' ✎';
        editIcon.title = 'Rename account';
        editIcon.addEventListener('click', e => {
          e.stopPropagation();
          showRenameModal(acct);
        });
        chip.appendChild(editIcon);
      }

      chip.addEventListener('click', () => {
        state.activeAccountId = acct.id;
        save();
        renderProjections();
      });
      strip.appendChild(chip);
    });
  }

  function buildWeekCard(week, i, acct) {
    const t = E.today();
    const todayDate = new Date(t.year, t.month - 1, t.day);
    const isCurrentWeek = todayDate >= week.window.start && todayDate <= week.window.end;

    const headroom = week.endBalanceExpected;
    const posNeg   = headroom >= 0 ? 'pos' : 'neg';

    const card = document.createElement('div');
    card.className = 'week-card';

    const nowTag = isCurrentWeek ? '<span class="tag tag-current">Now</span>' : '';

    // ── Income detail items ──────────────────────────────
    let incomeDetailHtml = '';
    for (const inc of acct.income) {
      const pays = E.payDatesInWindow(inc, week.window.start, week.window.end);
      if (!pays.length) continue;
      const amt = inc.type === 'fixed'
        ? inc.fixedAmount * pays.length
        : inc.expectedAmount * pays.length;
      if (amt === 0) continue;
      const name = inc.name || 'Unnamed Income';
      const varNote = inc.type === 'variable' ? ' <span style="font-size:10px;opacity:0.7">(variable)</span>' : '';
      incomeDetailHtml += `
        <div class="proj-detail-item">
          <span class="detail-name">${esc(name)}${varNote}</span>
          <span class="detail-amt detail-income">${E.fmt(amt, true)}</span>
        </div>`;
    }
    // Transfers in as income detail
    if (week.transfersIn > 0) {
      incomeDetailHtml += `
        <div class="proj-detail-item">
          <span class="detail-name">Transfers In</span>
          <span class="detail-amt detail-income">${E.fmt(week.transfersIn, true)}</span>
        </div>`;
    }

    // ── Expense detail items ─────────────────────────────
    let expenseDetailHtml = '';
    const { start, end } = week.window;
    const monthSegs = E.getMonthsInWindow(start, end);

    for (const { year, month, dayStart, dayEnd } of monthSegs) {
      const maxDay = E.daysInMonth(year, month);
      for (const exp of acct.expenses) {
        const effDay = Math.min(exp.day, maxDay);
        if (effDay >= dayStart && effDay <= dayEnd && exp.amount > 0) {
          const name = exp.name || 'Unnamed Expense';
          expenseDetailHtml += `
            <div class="proj-detail-item">
              <span class="detail-name">${esc(name)}</span>
              <span class="detail-amt detail-expense">${E.fmt(-exp.amount)}</span>
            </div>`;
        }
      }
    }

    // One-time expenses
    for (const ot of acct.oneTimeExpenses) {
      if (!ot.date) continue;
      const [oy, om, od] = ot.date.split('-').map(Number);
      const otDate = new Date(oy, om - 1, od);
      if (otDate >= start && otDate <= end && ot.amount > 0) {
        const name = ot.name || 'One-Time Expense';
        expenseDetailHtml += `
          <div class="proj-detail-item">
            <span class="detail-name">${esc(name)} <span style="font-size:10px;opacity:0.7">(one-time)</span></span>
            <span class="detail-amt detail-onetime">${E.fmt(-ot.amount)}</span>
          </div>`;
      }
    }

    // Savings + transfers out as expense details
    if (week.savingsOut > 0) {
      expenseDetailHtml += `
        <div class="proj-detail-item">
          <span class="detail-name">Savings</span>
          <span class="detail-amt detail-expense">${E.fmt(-week.savingsOut)}</span>
        </div>`;
    }
    if (week.transfersOut > 0) {
      expenseDetailHtml += `
        <div class="proj-detail-item">
          <span class="detail-name">Transfers Out</span>
          <span class="detail-amt detail-expense">${E.fmt(-week.transfersOut)}</span>
        </div>`;
    }

    // ── Scenario pills ───────────────────────────────────
    let scenarioHtml = '';
    if (week.hasVariable) {
      scenarioHtml = `
        <div class="scenario-range">
          <div class="range-pill pill-best">
            <span class="range-pill-label">Best Case</span>
            ${E.fmt(week.endBalanceBest, true)}
          </div>
          <div class="range-pill pill-worst">
            <span class="range-pill-label">Worst Case</span>
            ${E.fmt(week.endBalanceMin, true)}
          </div>
        </div>`;
    }

    // ── Total income label ───────────────────────────────
    const totalIncomeAmt = week.totalIncome + week.transfersIn;
    const totalExpAmt    = week.totalExpenses + week.savingsOut + week.transfersOut;
    const varNote = week.hasVariable ? '<span class="c-dim"> incl. variable</span>' : '';

    card.innerHTML = `
      <div class="week-card-header">
        <div>
          <div class="week-card-label">Week ${i + 1} ${nowTag}</div>
          <div class="week-card-dates">${E.fmtDateShort(week.window.start)} – ${E.fmtDateShort(week.window.end)}</div>
        </div>
        <div>
          <div class="headroom ${posNeg}">${E.fmt(headroom, true)}</div>
          <div class="headroom-label">headroom</div>
        </div>
      </div>
      <div class="week-card-body">

        <div class="proj-row">
          <span class="proj-row-label">Starting Balance</span>
          <span class="proj-row-val c-balance">${E.fmt(week.startBalance)}</span>
        </div>

        <div class="proj-divider"></div>

        ${incomeDetailHtml
          ? `<div class="proj-group-total">
               <span class="proj-row-label">+ Income</span>
               <span class="proj-row-val c-income">${E.fmt(totalIncomeAmt, true)}${varNote}</span>
             </div>
             ${incomeDetailHtml}`
          : `<div class="proj-row">
               <span class="proj-row-label">+ Income</span>
               <span class="proj-row-val c-income">${E.fmt(0, true)}</span>
             </div>`
        }

        <div class="proj-divider"></div>

        ${expenseDetailHtml
          ? `<div class="proj-group-total">
               <span class="proj-row-label">− Expenses</span>
               <span class="proj-row-val c-expense">${E.fmt(-totalExpAmt)}</span>
             </div>
             ${expenseDetailHtml}`
          : `<div class="proj-row">
               <span class="proj-row-label">− Expenses</span>
               <span class="proj-row-val c-expense">${E.fmt(0)}</span>
             </div>`
        }

        <div class="proj-divider"></div>

        <div class="proj-row">
          <span class="proj-row-label">Ending Balance</span>
          <span class="proj-row-val ${headroom >= 0 ? 'c-income' : 'c-expense'}">${E.fmt(week.endBalanceExpected)}</span>
        </div>
        ${scenarioHtml}
      </div>
    `;

    return card;
  }

  // ── Helpers ──────────────────────────────────────────────
  function makeAddBtn(label, onClick) {
    const btn = document.createElement('button');
    btn.className = 'add-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function updateSectionTotal(id, val, positive) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = E.fmt(val, positive);
    el.style.color = positive ? 'var(--green)' : 'var(--red)';
  }

  // ── Initial render ───────────────────────────────────────
  function renderAll() {
    renderSetup();
  }

  // Measure the fixed header height precisely and set CSS var
  function setHeaderOffset() {
    const header = document.querySelector('.sticky-header');
    if (header) {
      const h = header.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--header-h', h + 'px');
    }
  }

  renderAll();
  // Set after render (account strip chips may affect height)
  requestAnimationFrame(setHeaderOffset);
  window.addEventListener('resize', setHeaderOffset);
});
