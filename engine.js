// ============================================================
// ClearFlow — Data Engine
// Handles: data model, localStorage persistence, date logic,
//          week bucket assignment, projection calculations
// ============================================================

'use strict';

// ── Constants ────────────────────────────────────────────────
const STORAGE_KEY = 'clearflow_v1';

const WEEK_BUCKETS = [
  { id: 'w1', label: '1st – 7th',   start: 1,  end: 7  },
  { id: 'w2', label: '8th – 14th',  start: 8,  end: 14 },
  { id: 'w3', label: '15th – 21st', start: 15, end: 21 },
  { id: 'w4', label: '22nd – 28th', start: 22, end: 28 },
  { id: 'w5', label: '29th – 31st', start: 29, end: 31 },
];

const FREQUENCIES = ['weekly', 'biweekly', 'monthly'];
const PAY_DAYS    = ['Thursday', 'Friday'];

// ── Default Data Model ───────────────────────────────────────
function createDefaultAccount(id, name) {
  return {
    id,
    name,
    balance: 0,
    income: [],
    expenses: [],         // { id, name, amount, day, bucketId }
    oneTimeExpenses: [],  // { id, name, amount, date }
    savings: [],          // { id, name, amount, frequency }
    transfers: [],        // { id, name, amount, toAccountId, type:'regular'|'onetime', frequency?, date? }
  };
}

function createDefaultState() {
  const acct = createDefaultAccount('acct_1', 'My Checking');
  return {
    accounts: [acct],
    activeAccountId: 'acct_1',
  };
}

function createIncomeItem(overrides = {}) {
  return {
    id: uid(),
    name: '',
    type: 'fixed',        // 'fixed' | 'variable'
    fixedAmount: 0,
    minAmount: 0,
    expectedAmount: 0,
    frequency: 'biweekly',
    payDay: 'Friday',
    nextPayDate: '',
    ...overrides,
  };
}

function createExpenseItem(overrides = {}) {
  return {
    id: uid(),
    name: '',
    amount: 0,
    day: 1,
    bucketId: 'w1',
    ...overrides,
  };
}

function createOneTimeExpense(overrides = {}) {
  return {
    id: uid(),
    name: '',
    amount: 0,
    date: '',
    ...overrides,
  };
}

function createSavingsItem(overrides = {}) {
  return {
    id: uid(),
    name: '',
    amount: 0,
    frequency: 'monthly',
    ...overrides,
  };
}

function createTransferItem(overrides = {}) {
  return {
    id: uid(),
    name: '',
    amount: 0,
    toAccountId: '',
    type: 'regular',     // 'regular' | 'onetime'
    frequency: 'monthly',
    date: '',
    ...overrides,
  };
}

// ── Helpers ──────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function today() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), raw: d };
}

/** Returns max days in a given month/year (handles Feb + leap years) */
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * Given a day-of-month, return which bucket id it belongs to,
 * accounting for February (and short months): days beyond the
 * month's actual length get clamped to w4 (22–28).
 */
function bucketForDay(day, year, month) {
  const maxDay = daysInMonth(year, month);
  const effectiveDay = Math.min(day, maxDay);
  for (const b of WEEK_BUCKETS) {
    if (effectiveDay >= b.start && effectiveDay <= b.end) return b.id;
  }
  return 'w4'; // fallback
}

/**
 * Given a date string (YYYY-MM-DD), return which bucket it falls in
 * for the month it belongs to.
 */
function bucketForDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return bucketForDay(d, y, m);
}

/**
 * Returns the current bucket id based on today's date.
 */
function currentBucketId() {
  const t = today();
  return bucketForDay(t.day, t.year, t.month);
}

// ── Pay schedule helpers ─────────────────────────────────────

/**
 * Given an income item with a nextPayDate, compute all pay dates
 * that fall within the 12-week window starting from weekStart.
 * Returns array of Date objects.
 */
function payDatesInWindow(incomeItem, windowStart, windowEnd) {
  if (!incomeItem.nextPayDate) return [];
  const [y, m, d] = incomeItem.nextPayDate.split('-').map(Number);
  let cursor = new Date(y, m - 1, d);
  const start = new Date(windowStart);
  const end   = new Date(windowEnd);

  const stepMs = frequencyMs(incomeItem.frequency);

  // If nextPayDate is after the window, walk it BACK until it's before or at windowEnd
  // then collect dates that land in [start, end]
  if (cursor > end) {
    // Step back until cursor <= end
    while (cursor > end) cursor = new Date(cursor.getTime() - stepMs);
  } else {
    // cursor is before end; step back to find first occurrence at or before start
    while (cursor > start) cursor = new Date(cursor.getTime() - stepMs);
    // cursor is now <= start; step forward once to land at the first pay >= start
    // (unless cursor is exactly start)
    if (cursor < start) cursor = new Date(cursor.getTime() + stepMs);
  }

  // Collect all dates within window
  const dates = [];
  let scan = new Date(cursor);
  while (scan <= end) {
    if (scan >= start) dates.push(new Date(scan));
    scan = new Date(scan.getTime() + stepMs);
  }
  return dates;
}

function frequencyMs(freq) {
  switch (freq) {
    case 'weekly':    return 7  * 86400000;
    case 'biweekly':  return 14 * 86400000;
    case 'monthly':   return 30.4375 * 86400000; // avg
    default:          return 14 * 86400000;
  }
}

/** Returns true if a pay date falls within [rangeStart, rangeEnd] inclusive */
function dateInRange(date, rangeStart, rangeEnd) {
  return date >= rangeStart && date <= rangeEnd;
}

// ── 12-week projection ───────────────────────────────────────

/**
 * Build 12 weekly windows starting from the Monday on or before today.
 * Each window = 7 calendar days.
 */
function buildWeekWindows(referenceDate) {
  const ref = referenceDate || new Date();
  // Snap to start of current calendar week (Sunday-based, but we want
  // the current billing week which is already defined by bucket logic).
  // We'll use the actual current week start as today minus day-of-week offset.
  const dayOfWeek = ref.getDay(); // 0=Sun … 6=Sat
  const weekStart = new Date(ref);
  weekStart.setDate(ref.getDate() - dayOfWeek); // Sunday of this week
  weekStart.setHours(0, 0, 0, 0);

  const windows = [];
  for (let i = 0; i < 12; i++) {
    const ws = new Date(weekStart);
    ws.setDate(weekStart.getDate() + i * 7);
    const we = new Date(ws);
    we.setDate(ws.getDate() + 6);
    we.setHours(23, 59, 59, 999);
    windows.push({ start: ws, end: we, index: i });
  }
  return windows;
}

/**
 * For a given weekly window and account, compute:
 *  - incomeFixed     (fixed income landing this week)
 *  - incomeMin       (variable min)
 *  - incomeExpected  (variable expected)
 *  - totalIncome     (fixed + expected)
 *  - totalIncomeMin  (fixed + min)
 *  - expenses        (scheduled expenses + one-time)
 *  - savings         (savings contributions)
 *  - transfersOut    (outgoing transfers)
 *  - transfersIn     (incoming transfers — computed at portfolio level)
 *  - hasVariable     (bool: any variable income this week?)
 */
function computeWeek(window, account, allAccounts) {
  const { start, end } = window;

  // --- Income ---
  let incomeFixed    = 0;
  let incomeMin      = 0;
  let incomeExpected = 0;
  let hasVariable    = false;

  for (const inc of account.income) {
    const pays = payDatesInWindow(inc, start, end);
    if (pays.length === 0) continue;
    if (inc.type === 'fixed') {
      incomeFixed += inc.fixedAmount * pays.length;
    } else {
      hasVariable   = true;
      incomeMin      += inc.minAmount      * pays.length;
      incomeExpected += inc.expectedAmount * pays.length;
    }
  }

  // --- Scheduled expenses (month-aware bucket) ---
  let scheduledExpenses = 0;
  // For each day in the window, check if any expense day falls in that month-bucket
  // We look at each month that this window spans
  const monthsInWindow = getMonthsInWindow(start, end);
  for (const { year, month, dayStart, dayEnd } of monthsInWindow) {
    for (const exp of account.expenses) {
      const effDay = Math.min(exp.day, daysInMonth(year, month));
      if (effDay >= dayStart && effDay <= dayEnd) {
        scheduledExpenses += exp.amount;
      }
    }
  }

  // --- One-time expenses ---
  let oneTimeExpenses = 0;
  for (const ot of account.oneTimeExpenses) {
    if (!ot.date) continue;
    const [oy, om, od] = ot.date.split('-').map(Number);
    const otDate = new Date(oy, om - 1, od);
    if (dateInRange(otDate, start, end)) {
      oneTimeExpenses += ot.amount;
    }
  }

  // --- Savings ---
  let savingsOut = 0;
  for (const sav of account.savings) {
    // Rough: monthly savings distributed to weeks that contain the 1st
    // or proportionally. We'll check if any pay period hits this window.
    // Simplified: monthly = once if window contains day 1–7 of month,
    // weekly = every week, biweekly = every other week (use same pay logic).
    if (sav.frequency === 'monthly') {
      const monthDays = getMonthsInWindow(start, end);
      for (const { dayStart, dayEnd } of monthDays) {
        if (dayStart <= 7 && dayEnd >= 1) savingsOut += sav.amount;
      }
    } else if (sav.frequency === 'weekly') {
      savingsOut += sav.amount;
    } else if (sav.frequency === 'biweekly') {
      // every other week — use index parity
      if (window.index % 2 === 0) savingsOut += sav.amount;
    }
  }

  // --- Transfers out ---
  let transfersOut = 0;
  for (const tr of account.transfers) {
    if (tr.type === 'onetime') {
      if (!tr.date) continue;
      const [ty, tm, td] = tr.date.split('-').map(Number);
      const trDate = new Date(ty, tm - 1, td);
      if (dateInRange(trDate, start, end)) transfersOut += tr.amount;
    } else {
      // regular — treat like savings frequency
      if (tr.frequency === 'weekly') {
        transfersOut += tr.amount;
      } else if (tr.frequency === 'biweekly') {
        if (window.index % 2 === 0) transfersOut += tr.amount;
      } else {
        // monthly
        const monthDays = getMonthsInWindow(start, end);
        for (const { dayStart, dayEnd } of monthDays) {
          if (dayStart <= 7 && dayEnd >= 1) transfersOut += tr.amount;
        }
      }
    }
  }

  // --- Transfers in (from other accounts targeting this one) ---
  let transfersIn = 0;
  for (const acct of allAccounts) {
    if (acct.id === account.id) continue;
    for (const tr of acct.transfers) {
      if (tr.toAccountId !== account.id) continue;
      if (tr.type === 'onetime') {
        if (!tr.date) continue;
        const [ty, tm, td] = tr.date.split('-').map(Number);
        const trDate = new Date(ty, tm - 1, td);
        if (dateInRange(trDate, start, end)) transfersIn += tr.amount;
      } else {
        if (tr.frequency === 'weekly') {
          transfersIn += tr.amount;
        } else if (tr.frequency === 'biweekly') {
          if (window.index % 2 === 0) transfersIn += tr.amount;
        } else {
          const monthDays = getMonthsInWindow(start, end);
          for (const { dayStart, dayEnd } of monthDays) {
            if (dayStart <= 7 && dayEnd >= 1) transfersIn += tr.amount;
          }
        }
      }
    }
  }

  const totalExpenses = scheduledExpenses + oneTimeExpenses;
  const totalIncome   = incomeFixed + incomeExpected;
  const totalIncomeMin = incomeFixed + incomeMin;
  const totalIncomeBest = incomeFixed + incomeExpected; // same as expected for "best"

  return {
    incomeFixed,
    incomeMin,
    incomeExpected,
    hasVariable,
    totalIncome,
    totalIncomeMin,
    totalIncomeBest,
    scheduledExpenses,
    oneTimeExpenses,
    totalExpenses,
    savingsOut,
    transfersOut,
    transfersIn,
    // net = income + transfersIn - expenses - savings - transfersOut
    netExpected: totalIncome    + transfersIn - totalExpenses - savingsOut - transfersOut,
    netMin:      totalIncomeMin + transfersIn - totalExpenses - savingsOut - transfersOut,
    netBest:     totalIncomeBest + transfersIn - totalExpenses - savingsOut - transfersOut,
  };
}

/**
 * Returns an array of { year, month, dayStart, dayEnd } for each calendar-month
 * that overlaps [start, end]. dayStart/dayEnd are the actual day-of-month
 * range of the overlap.
 */
function getMonthsInWindow(start, end) {
  const result = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const year  = cursor.getFullYear();
    const month = cursor.getMonth() + 1;
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd   = new Date(year, month,     0); // last day

    const overlapStart = start > monthStart ? start : monthStart;
    const overlapEnd   = end   < monthEnd   ? end   : monthEnd;

    if (overlapStart <= overlapEnd) {
      result.push({
        year,
        month,
        dayStart: overlapStart.getDate(),
        dayEnd:   overlapEnd.getDate(),
      });
    }
    cursor = new Date(year, month, 1); // advance to next month
  }
  return result;
}

/**
 * Build the full 12-week projection for one account.
 * Returns array of week objects with running balance.
 */
function buildProjection(account, allAccounts, referenceDate) {
  const windows = buildWeekWindows(referenceDate);
  const weeks   = [];
  let runningBalance = parseFloat(account.balance) || 0;

  for (const window of windows) {
    const w = computeWeek(window, account, allAccounts);

    const endBalanceExpected = runningBalance + w.netExpected;
    const endBalanceMin      = runningBalance + w.netMin;
    const endBalanceBest     = runningBalance + w.netBest;

    weeks.push({
      window,
      ...w,
      startBalance:        runningBalance,
      endBalanceExpected,
      endBalanceMin,
      endBalanceBest,
      headroomExpected:    endBalanceExpected,
      headroomMin:         endBalanceMin,
      headroomBest:        endBalanceBest,
    });

    runningBalance = endBalanceExpected; // chain on expected
  }
  return weeks;
}

// ── Storage ──────────────────────────────────────────────────
const Storage = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : createDefaultState();
    } catch (e) {
      console.warn('Storage load error', e);
      return createDefaultState();
    }
  },
  save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Storage save error', e);
    }
  },
};

// ── Format helpers ───────────────────────────────────────────
function fmt(n, showSign = false) {
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (showSign) return (n < 0 ? '−$' : '+$') + s;
  return (n < 0 ? '−$' : '$') + s;
}

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateShort(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Test Suite (20+ checks) ──────────────────────────────────
function runTests() {
  const results = [];
  let passed = 0;
  let failed = 0;

  function check(label, actual, expected, tolerance = 0.01) {
    const ok = Math.abs(actual - expected) <= tolerance;
    results.push({ label, actual, expected, ok });
    if (ok) passed++; else failed++;
  }

  // ── Helpers for tests ──
  const REF = new Date(2026, 2, 23); // March 23, 2026 (month is 0-indexed)

  function makeAccount(overrides = {}) {
    return {
      ...createDefaultAccount('test_acct', 'Test'),
      ...overrides,
    };
  }

  // ─────────────────────────────────────────────
  // TEST 1: daysInMonth — February non-leap year
  check('T01 daysInMonth Feb 2025', daysInMonth(2025, 2), 28);

  // TEST 2: daysInMonth — February leap year
  check('T02 daysInMonth Feb 2024', daysInMonth(2024, 2), 29);

  // TEST 3: daysInMonth — March
  check('T03 daysInMonth Mar 2026', daysInMonth(2026, 3), 31);

  // TEST 4: bucketForDay — day 1 → w1
  check('T04 bucket day 1 → w1', WEEK_BUCKETS.findIndex(b => b.id === bucketForDay(1, 2026, 3)), 0);

  // TEST 5: bucketForDay — day 15 → w3
  check('T05 bucket day 15 → w3', WEEK_BUCKETS.findIndex(b => b.id === bucketForDay(15, 2026, 3)), 2);

  // TEST 6: bucketForDay — day 29 in February (non-leap) → clamps to 28 → w4
  check('T06 bucket day 29 in Feb 2025 → w4', WEEK_BUCKETS.findIndex(b => b.id === bucketForDay(29, 2025, 2)), 3);

  // TEST 7: bucketForDay — day 30 in February → w4
  check('T07 bucket day 30 in Feb 2025 → w4', WEEK_BUCKETS.findIndex(b => b.id === bucketForDay(30, 2025, 2)), 3);

  // TEST 8: bucketForDay — day 31 in February → w4
  check('T08 bucket day 31 in Feb 2025 → w4', WEEK_BUCKETS.findIndex(b => b.id === bucketForDay(31, 2025, 2)), 3);

  // TEST 9: bucketForDay — day 29 in March → w5
  check('T09 bucket day 29 in March → w5', WEEK_BUCKETS.findIndex(b => b.id === bucketForDay(29, 2026, 3)), 4);

  // TEST 10: payDatesInWindow — biweekly, nextPay Mar 28, window Mar 22–28
  const incBiweekly = createIncomeItem({ nextPayDate: '2026-03-28', frequency: 'biweekly', type: 'fixed', fixedAmount: 2400 });
  const win0 = buildWeekWindows(REF)[0];
  const paysW0 = payDatesInWindow(incBiweekly, win0.start, win0.end);
  check('T10 biweekly pay lands in week 0', paysW0.length, 1);

  // TEST 11: biweekly income with next pay Apr 12 (not a multiple of 14 from any date in Mar 22-28)
  // Mar 22-28 window: Apr 12 - 14 days = Mar 29 which is OUTSIDE Mar 22-28 → 0 pays expected
  const incBiweekly2 = createIncomeItem({ nextPayDate: '2026-04-12', frequency: 'biweekly', type: 'fixed', fixedAmount: 1500 });
  const paysW0b = payDatesInWindow(incBiweekly2, win0.start, win0.end);
  check('T11 biweekly pay Apr12 does not land in Mar 22-28 window', paysW0b.length, 0);

  // TEST 12: Simple fixed income week — net
  const acct12 = makeAccount({
    balance: 1000,
    income: [createIncomeItem({ nextPayDate: '2026-03-23', frequency: 'weekly', type: 'fixed', fixedAmount: 500 })],
    expenses: [createExpenseItem({ day: 24, amount: 200, bucketId: 'w4' })],
  });
  const proj12 = buildProjection(acct12, [acct12], REF);
  // Week 0: start=1000, income=500 (Mar 23 is Monday of ref week), expense day 24 is in same window's month
  // net = 500 - 200 = 300, end = 1300
  check('T12 simple weekly income net', proj12[0].netExpected, 300);

  // TEST 13: Variable income — expected vs min differ
  const acct13 = makeAccount({
    balance: 500,
    income: [createIncomeItem({ nextPayDate: '2026-03-23', frequency: 'weekly', type: 'variable', minAmount: 100, expectedAmount: 400 })],
  });
  const proj13 = buildProjection(acct13, [acct13], REF);
  check('T13 variable income expected', proj13[0].netExpected, 400);
  check('T13b variable income min', proj13[0].netMin, 100);

  // TEST 14: hasVariable flag
  check('T14 hasVariable true', proj13[0].hasVariable ? 1 : 0, 1);

  // TEST 15: Fixed income hasVariable=false
  const acct15 = makeAccount({
    balance: 0,
    income: [createIncomeItem({ nextPayDate: '2026-03-23', frequency: 'weekly', type: 'fixed', fixedAmount: 800 })],
  });
  const proj15 = buildProjection(acct15, [acct15], REF);
  check('T15 fixed income hasVariable false', proj15[0].hasVariable ? 1 : 0, 0);

  // TEST 16: One-time expense lands in correct week
  const acct16 = makeAccount({
    balance: 2000,
    income: [],
    oneTimeExpenses: [createOneTimeExpense({ date: '2026-03-25', amount: 350 })],
  });
  const proj16 = buildProjection(acct16, [acct16], REF);
  check('T16 one-time expense in correct week', proj16[0].oneTimeExpenses, 350);
  check('T16b one-time not in next week', proj16[1].oneTimeExpenses, 0);

  // TEST 17: One-time expense in a future week
  const acct17 = makeAccount({
    balance: 3000,
    income: [],
    oneTimeExpenses: [createOneTimeExpense({ date: '2026-04-05', amount: 500 })],
  });
  const proj17 = buildProjection(acct17, [acct17], REF);
  check('T17 one-time future expense week 0 = 0', proj17[0].oneTimeExpenses, 0);
  check('T17b one-time future expense week 2 = 500', proj17[2].oneTimeExpenses, 500);

  // TEST 18: Running balance chains correctly across weeks
  const acct18 = makeAccount({
    balance: 1000,
    income: [createIncomeItem({ nextPayDate: '2026-03-23', frequency: 'weekly', type: 'fixed', fixedAmount: 200 })],
    expenses: [],
  });
  const proj18 = buildProjection(acct18, [acct18], REF);
  check('T18 week1 startBalance = week0 endBalance', proj18[1].startBalance, proj18[0].endBalanceExpected);

  // TEST 19: Savings reduces ending balance
  const acct19 = makeAccount({
    balance: 2000,
    income: [createIncomeItem({ nextPayDate: '2026-03-23', frequency: 'weekly', type: 'fixed', fixedAmount: 500 })],
    savings: [createSavingsItem({ amount: 100, frequency: 'weekly' })],
  });
  const proj19 = buildProjection(acct19, [acct19], REF);
  check('T19 savings deducted from net', proj19[0].netExpected, 400); // 500 income - 100 savings

  // TEST 20: Transfer out reduces source account balance
  const acctSrc = makeAccount({
    id: 'src', balance: 3000,
    income: [],
    transfers: [createTransferItem({ amount: 300, toAccountId: 'dst', type: 'regular', frequency: 'weekly' })],
  });
  const acctDst = makeAccount({ id: 'dst', balance: 500, income: [], transfers: [] });
  const projSrc = buildProjection(acctSrc, [acctSrc, acctDst], REF);
  check('T20 transfer out deducted from source', projSrc[0].transfersOut, 300);

  // TEST 21: Transfer in increases destination account balance
  const projDst = buildProjection(acctDst, [acctSrc, acctDst], REF);
  check('T21 transfer in credited to destination', projDst[0].transfersIn, 300);

  // TEST 22: February — expense on day 31 shifts to w4
  const acct22 = makeAccount({
    balance: 1000,
    income: [],
    expenses: [createExpenseItem({ day: 31, amount: 150 })],
  });
  // Simulate a window in February
  const febStart = new Date(2027, 1, 21); // Feb 21, 2027
  const febEnd   = new Date(2027, 1, 27);
  const monthsFeb = getMonthsInWindow(febStart, febEnd);
  // Day 31 clamped to 28 in Feb → 28 is in dayStart(21)..dayEnd(27)? 28>27 so NOT in this range
  // It should land in the last day of feb = 28 → which is in Feb 22–28 range
  const febWin29 = new Date(2027, 1, 22);
  const febWin29End = new Date(2027, 1, 28, 23, 59, 59);
  const mFeb = getMonthsInWindow(febWin29, febWin29End);
  let feb31Cost = 0;
  for (const { year, month, dayStart, dayEnd } of mFeb) {
    const effDay = Math.min(31, daysInMonth(year, month));
    if (effDay >= dayStart && effDay <= dayEnd) feb31Cost += 150;
  }
  check('T22 day-31 expense in Feb lands in w4 (22–28)', feb31Cost, 150);

  // TEST 23: Multiple incomes same week — fixed + variable
  const acct23 = makeAccount({
    balance: 0,
    income: [
      createIncomeItem({ nextPayDate: '2026-03-23', frequency: 'weekly', type: 'fixed', fixedAmount: 1000 }),
      createIncomeItem({ nextPayDate: '2026-03-23', frequency: 'weekly', type: 'variable', minAmount: 200, expectedAmount: 600 }),
    ],
  });
  const proj23 = buildProjection(acct23, [acct23], REF);
  check('T23 mixed income expected = 1000+600', proj23[0].totalIncome, 1600);
  check('T23b mixed income min = 1000+200', proj23[0].totalIncomeMin, 1200);

  // TEST 24: Negative headroom shows correctly (endBalance < 0)
  const acct24 = makeAccount({
    balance: 100,
    income: [],
    expenses: [createExpenseItem({ day: 23, amount: 500 })],
  });
  const proj24 = buildProjection(acct24, [acct24], REF);
  check('T24 negative headroom', proj24[0].endBalanceExpected < 0 ? 1 : 0, 1);

  // TEST 25: Biweekly income every other week
  const acct25 = makeAccount({
    balance: 0,
    income: [createIncomeItem({ nextPayDate: '2026-03-27', frequency: 'biweekly', type: 'fixed', fixedAmount: 2000 })],
  });
  const proj25 = buildProjection(acct25, [acct25], REF);
  const w0pays = payDatesInWindow(acct25.income[0], proj25[0].window.start, proj25[0].window.end);
  const w1pays = payDatesInWindow(acct25.income[0], proj25[1].window.start, proj25[1].window.end);
  const w2pays = payDatesInWindow(acct25.income[0], proj25[2].window.start, proj25[2].window.end);
  // Mar 27 is in week 0. Next pay is Apr 10 (week 2).
  check('T25 biweekly pay in week 0', w0pays.length >= 1 ? 1 : 0, 1);
  check('T25b biweekly no pay in week 1', w1pays.length, 0);
  check('T25c biweekly pay in week 2', w2pays.length >= 1 ? 1 : 0, 1);

  console.log(`\n=== ClearFlow Test Results: ${passed}/${passed + failed} passed ===\n`);
  results.forEach(r => {
    console.log(`${r.ok ? '✅' : '❌'} ${r.label}: got ${r.actual}, expected ${r.expected}`);
  });

  return { passed, failed, total: passed + failed, results };
}

// Export for use in app
window.Engine = {
  // Data factories
  createDefaultState, createDefaultAccount, createIncomeItem,
  createExpenseItem, createOneTimeExpense, createSavingsItem, createTransferItem,
  // Engine
  buildProjection, buildWeekWindows, computeWeek,
  bucketForDay, bucketForDate, currentBucketId, daysInMonth,
  payDatesInWindow, getMonthsInWindow,
  // Storage
  Storage,
  // Helpers
  uid, today, fmt, fmtDate, fmtDateShort,
  WEEK_BUCKETS, FREQUENCIES, PAY_DAYS,
  // Tests
  runTests,
};
