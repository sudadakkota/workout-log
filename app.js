'use strict';

/* =========================================================
   Workout Log — データはこの端末のブラウザ (IndexedDB) に保存
   ========================================================= */

const DEFAULT_EXERCISES = {
  '胸': ['ベンチプレス', 'インクラインベンチプレス', 'ダンベルプレス', 'ダンベルフライ', 'チェストプレス', 'ディップス'],
  '背中': ['デッドリフト', '懸垂', 'ラットプルダウン', 'ベントオーバーロウ', 'シーテッドロウ', 'ワンハンドロウ'],
  '脚': ['スクワット', 'レッグプレス', 'ブルガリアンスクワット', 'レッグエクステンション', 'レッグカール', 'カーフレイズ'],
  '肩': ['ショルダープレス', 'サイドレイズ', 'リアレイズ', 'フロントレイズ', 'アップライトロウ'],
  '腕': ['バーベルカール', 'ダンベルカール', 'ハンマーカール', 'トライセプスエクステンション', 'ケーブルプッシュダウン'],
  'お尻': ['ヒップスラスト'],
  '腹': ['クランチ', 'レッグレイズ', 'アブローラー'],
  'その他': [],
};
const PARTS = Object.keys(DEFAULT_EXERCISES);
const TAB_TITLES = { record: '記録', history: '履歴', graph: 'グラフ', settings: '設定' };
const METRICS = { max: '最大重量', e1rm: '推定1RM', volume: 'ボリューム' };
const RANGES = { '3m': '3か月', '1y': '1年', all: '全期間' };

/* ---------- utils ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => toKey(new Date());
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); };
const WD = '日月火水木金土';
const fmtDate = (k) => { const d = fromKey(k); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} (${WD[d.getDay()]})`; };
const fmtShort = (k) => { const d = fromKey(k); return `${d.getMonth() + 1}/${d.getDate()}`; };
const fmtNum = (n) => String(Math.round(n * 100) / 100);
const fmtInt = (n) => Math.round(n).toLocaleString('ja-JP');
const e1rm = (w, r) => (r <= 0 ? 0 : r === 1 ? w : w * (1 + r / 30)); // Epley
const last = (arr) => arr[arr.length - 1];
const byCreated = (a, b) => a.createdAt - b.createdAt;

/* ---------- storage ---------- */
const Store = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('workout-log', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async get(key) {
    try {
      const db = await this.open();
      return await new Promise((res, rej) => {
        const q = db.transaction('kv').objectStore('kv').get(key);
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
    } catch {
      try { const v = localStorage.getItem('wl:' + key); return v ? JSON.parse(v) : undefined; } catch { return undefined; }
    }
  },
  async set(key, value) {
    try {
      const db = await this.open();
      await new Promise((res, rej) => {
        const t = db.transaction('kv', 'readwrite');
        t.objectStore('kv').put(value, key);
        t.oncomplete = res;
        t.onerror = () => rej(t.error);
      });
    } catch {
      try { localStorage.setItem('wl:' + key, JSON.stringify(value)); } catch { toast('保存に失敗しました'); }
    }
  },
};

function defaultState() {
  const exercises = [];
  for (const [part, names] of Object.entries(DEFAULT_EXERCISES)) {
    for (const name of names) exercises.push({ id: uid(), name, part });
  }
  return { version: 1, exercises, sets: [], settings: { restSec: 90 }, lastBackup: null, bodyWeights: [], cardio: [] };
}

function normalizeState(d) {
  const base = defaultState();
  return {
    version: 1,
    exercises: d.exercises.map((e) => ({ id: String(e.id), name: String(e.name), part: PARTS.includes(e.part) ? e.part : 'その他' })),
    sets: d.sets
      .filter((s) => s && s.exerciseId && /^\d{4}-\d{2}-\d{2}$/.test(s.date))
      .map((s) => ({
        id: String(s.id || uid()),
        date: s.date,
        exerciseId: String(s.exerciseId),
        weight: Number(s.weight) || 0,
        reps: Number(s.reps) || 0,
        createdAt: Number(s.createdAt) || 0,
        ...(s.memo ? { memo: String(s.memo) } : {}),
      })),
    settings: { ...base.settings, ...(d.settings || {}) },
    lastBackup: d.lastBackup || null,
    // 体重・有酸素運動は今は画面がないが、取り込んだデータを失わないよう保持する
    bodyWeights: Array.isArray(d.bodyWeights) ? d.bodyWeights : [],
    cardio: Array.isArray(d.cardio) ? d.cardio : [],
  };
}

let S = null;
let persistAsked = false;
async function save() {
  await Store.set('state', S);
  if (!persistAsked && navigator.storage && navigator.storage.persist) {
    persistAsked = true;
    navigator.storage.persist().catch(() => {});
  }
}

/* ---------- ui state ---------- */
const ui = { tab: 'record', date: todayKey(), pending: {}, graphEx: null, metric: 'max', range: '1y' };

/* ---------- data helpers ---------- */
const exById = (id) => S.exercises.find((e) => e.id === id);
const setsOn = (date) => S.sets.filter((s) => s.date === date).sort(byCreated);
const setsOfEx = (exId) => S.sets.filter((s) => s.exerciseId === exId);

function prevSession(exId, beforeDate) {
  let best = null;
  for (const s of S.sets) if (s.exerciseId === exId && s.date < beforeDate && (!best || s.date > best)) best = s.date;
  if (!best) return null;
  return { date: best, sets: S.sets.filter((s) => s.exerciseId === exId && s.date === best).sort(byCreated) };
}

function lastUsedMap() {
  const m = new Map();
  for (const s of S.sets) if (!m.has(s.exerciseId) || m.get(s.exerciseId) < s.date) m.set(s.exerciseId, s.date);
  return m;
}

function groupByDate(sets) {
  const m = new Map();
  for (const s of sets) { if (!m.has(s.date)) m.set(s.date, []); m.get(s.date).push(s); }
  return m;
}

/* =========================================================
   Views
   ========================================================= */
function render() {
  $('#title').textContent = TAB_TITLES[ui.tab];
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  const view = $('#view');
  if (ui.tab === 'record') view.innerHTML = renderRecord();
  else if (ui.tab === 'history') view.innerHTML = renderHistory();
  else if (ui.tab === 'graph') view.innerHTML = renderGraph();
  else view.innerHTML = renderSettings();
}

/* ---------- 記録 ---------- */
function renderRecord() {
  const date = ui.date;
  const sets = setsOn(date);
  const order = [];
  for (const s of sets) if (!order.includes(s.exerciseId)) order.push(s.exerciseId);
  for (const id of ui.pending[date] || []) if (!order.includes(id) && exById(id)) order.push(id);

  let h = `
    <div class="datebar">
      <button class="icon-btn" data-act="prev-day" aria-label="前の日">‹</button>
      <label class="date-pick">${fmtDate(date)}${date === todayKey() ? '<span class="today-badge">今日</span>' : ''}
        <input type="date" id="dateInput" value="${date}" aria-label="日付を選ぶ">
      </label>
      <button class="icon-btn" data-act="next-day" aria-label="次の日">›</button>
    </div>`;

  if (!order.length) {
    h += `<div class="empty"><div class="big">🏋️</div>${date === todayKey() ? '今日のトレーニングを記録しよう' : 'この日の記録はありません'}</div>`;
  }
  for (const id of order) h += exerciseCard(id, date, sets.filter((s) => s.exerciseId === id));

  h += `<button class="btn dashed block" data-act="open-picker">＋ 種目を追加</button>`;

  if (sets.length) {
    const vol = sets.reduce((a, s) => a + s.weight * s.reps, 0);
    h += `<div class="card day-summary" style="margin-top:12px">
      <div><b>${order.length}</b><span>種目</span></div>
      <div><b>${sets.length}</b><span>セット</span></div>
      <div><b>${fmtInt(vol)}</b><span>総ボリューム(kg)</span></div>
    </div>`;
  }
  return h;
}

function exerciseCard(id, date, list) {
  const ex = exById(id);
  const prev = prevSession(id, date);
  const ref = last(list) || (prev && last(prev.sets));

  // PR = それまでの最高重量を超えたセット
  const before = S.sets.filter((s) => s.exerciseId === id && s.date < date);
  let running = before.length ? Math.max(...before.map((s) => s.weight)) : null;
  const rows = list.map((s, i) => {
    const isPR = running !== null && s.weight > running;
    if (running === null || s.weight > running) running = s.weight;
    return `<li>
      <span class="set-no">${i + 1}</span>
      <span class="set-val"><b>${fmtNum(s.weight)}</b> kg × <b>${s.reps}</b> 回${s.memo ? `<span class="set-memo">${esc(s.memo)}</span>` : ''}</span>
      <button class="del" data-act="memo-set" data-id="${s.id}" aria-label="メモ">✎</button>
      ${isPR ? '<span class="pr">PR</span>' : ''}
      <button class="del" data-act="del-set" data-id="${s.id}" aria-label="このセットを削除">×</button>
    </li>`;
  }).join('');

  return `<section class="card">
    <div class="card-head">
      <div><div class="ex-name">${esc(ex.name)}</div><span class="chip">${esc(ex.part)}</span></div>
      ${list.length
        ? `<button class="icon-btn" data-act="show-graph" data-ex="${id}" aria-label="グラフを見る"><svg viewBox="0 0 24 24"><path d="M4 4v16h16"/><path d="M7.5 15l4-4.5 3 3L20 7"/></svg></button>`
        : `<button class="icon-btn" data-act="remove-pending" data-ex="${id}" aria-label="この種目を外す">×</button>`}
    </div>
    ${prev ? `<div class="prev">前回 ${fmtShort(prev.date)}：${prev.sets.map((s) => `${fmtNum(s.weight)}×${s.reps}`).join(', ')}</div>` : ''}
    ${prev && prev.sets.some((s) => s.memo) ? `<div class="prev-memo">📝 ${prev.sets.filter((s) => s.memo).map((s) => esc(s.memo)).join(' / ')}</div>` : ''}
    ${rows ? `<ol class="sets">${rows}</ol>` : ''}
    <form class="add-set" data-ex="${id}">
      <label class="unit-input"><input name="w" type="number" inputmode="decimal" step="any" min="0" value="${ref ? fmtNum(ref.weight) : ''}" placeholder="0" aria-label="重量"><span>kg</span></label>
      <label class="unit-input"><input name="r" type="number" inputmode="numeric" step="1" min="1" value="${ref ? ref.reps : ''}" placeholder="0" aria-label="回数"><span>回</span></label>
      <button class="btn primary" type="submit">追加</button>
    </form>
  </section>`;
}

function openPicker() {
  $('#sheetBody').innerHTML = `
    <div class="sheet-head"><h2>種目を選ぶ</h2><button class="btn" data-act="close-sheet">閉じる</button></div>
    <input type="search" id="exSearch" placeholder="種目を検索" autocomplete="off">
    <div id="pickList" class="pick-list"></div>
    <div class="section-title">新しい種目を作る</div>
    <form id="newExForm" class="inline-form">
      <input type="text" name="name" placeholder="種目名" required>
      <select name="part">${PARTS.map((p) => `<option>${p}</option>`).join('')}</select>
      <button class="btn primary" type="submit">作成</button>
    </form>`;
  renderPickList('');
  $('#sheet').hidden = false;
}

function renderPickList(q) {
  const used = lastUsedMap();
  const query = q.trim().toLowerCase();
  const match = (e) => !query || e.name.toLowerCase().includes(query);
  let h = '';
  const item = (e) => `<button class="pick-item" data-act="pick-ex" data-id="${e.id}"><span>${esc(e.name)}</span><span class="small">${used.has(e.id) ? '前回 ' + fmtShort(used.get(e.id)) : ''}</span></button>`;

  if (!query) {
    const recent = S.exercises.filter((e) => used.has(e.id)).sort((a, b) => (used.get(b.id) > used.get(a.id) ? 1 : -1)).slice(0, 5);
    if (recent.length) h += `<div class="part-head">最近</div>` + recent.map(item).join('');
  }
  for (const part of PARTS) {
    const list = S.exercises.filter((e) => e.part === part && match(e));
    if (list.length) h += `<div class="part-head">${part}</div>` + list.map(item).join('');
  }
  $('#pickList').innerHTML = h || '<p class="muted small">見つかりません。下で新しく作れます。</p>';
}

function closeSheet() { $('#sheet').hidden = true; $('#sheetBody').innerHTML = ''; }

function addPending(exId) {
  const list = ui.pending[ui.date] || (ui.pending[ui.date] = []);
  if (!list.includes(exId)) list.push(exId);
}

/* ---------- 履歴 ---------- */
function renderHistory() {
  if (!S.sets.length) return `<div class="empty"><div class="big">📅</div>まだ記録がありません</div>`;
  const byDate = groupByDate(S.sets);
  const dates = [...byDate.keys()].sort().reverse();
  const thisMonth = todayKey().slice(0, 7);
  const monthDays = dates.filter((d) => d.startsWith(thisMonth)).length;
  const weekAgo = addDays(todayKey(), -6);
  const weekDays = dates.filter((d) => d >= weekAgo).length;

  let h = `<div class="stat-row">
    <div class="stat"><b>${weekDays}</b><span>直近7日</span></div>
    <div class="stat"><b>${monthDays}</b><span>今月の日数</span></div>
    <div class="stat"><b>${dates.length}</b><span>累計日数</span></div>
  </div>`;

  let month = '';
  for (const d of dates) {
    const m = d.slice(0, 7);
    if (m !== month) {
      month = m;
      h += `<div class="section-title">${Number(m.slice(0, 4))}年${Number(m.slice(5))}月</div>`;
    }
    const sets = byDate.get(d);
    const names = [];
    for (const s of sets.sort(byCreated)) {
      const n = exById(s.exerciseId)?.name ?? '(削除された種目)';
      if (!names.includes(n)) names.push(n);
    }
    const vol = sets.reduce((a, s) => a + s.weight * s.reps, 0);
    h += `<button class="hist-item" data-act="goto-date" data-date="${d}">
      <div class="hist-date">${fmtDate(d)}</div>
      <div class="hist-ex">${names.map(esc).join(' / ')}</div>
      <div class="hist-meta">${sets.length}セット · ${fmtInt(vol)} kg</div>
    </button>`;
  }
  return h;
}

/* ---------- グラフ ---------- */
function renderGraph() {
  const used = lastUsedMap();
  const exList = S.exercises.filter((e) => used.has(e.id)).sort((a, b) => (used.get(b.id) > used.get(a.id) ? 1 : -1));
  if (!exList.length) return `<div class="empty"><div class="big">📈</div>記録するとここにグラフが出ます</div>`;
  if (!exList.some((e) => e.id === ui.graphEx)) ui.graphEx = exList[0].id;

  const all = setsOfEx(ui.graphEx);
  const byDate = groupByDate(all);
  let points = [...byDate.keys()].sort().map((d) => {
    const ss = byDate.get(d);
    const v = ui.metric === 'max' ? Math.max(...ss.map((s) => s.weight))
      : ui.metric === 'e1rm' ? Math.max(...ss.map((s) => e1rm(s.weight, s.reps)))
      : ss.reduce((a, s) => a + s.weight * s.reps, 0);
    return { date: d, v };
  });
  if (ui.range !== 'all') {
    const from = addDays(todayKey(), ui.range === '3m' ? -92 : -366);
    points = points.filter((p) => p.date >= from);
  }

  const maxSet = all.reduce((b, s) => (!b || s.weight > b.weight ? s : b), null);
  const bestE = all.reduce((b, s) => (!b || e1rm(s.weight, s.reps) > e1rm(b.weight, b.reps) ? s : b), null);
  const recent = [...byDate.keys()].sort().reverse().slice(0, 8);

  return `
    <div class="card">
      <select id="graphEx" aria-label="種目">${exList.map((e) => `<option value="${e.id}" ${e.id === ui.graphEx ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
      <div class="seg">${Object.entries(METRICS).map(([k, v]) => `<button data-act="metric" data-v="${k}" class="${ui.metric === k ? 'active' : ''}">${v}</button>`).join('')}</div>
      <div class="seg">${Object.entries(RANGES).map(([k, v]) => `<button data-act="range" data-v="${k}" class="${ui.range === k ? 'active' : ''}">${v}</button>`).join('')}</div>
      ${points.length ? lineChart(points) : '<p class="muted small" style="text-align:center;padding:40px 0">この期間の記録はありません</p>'}
    </div>
    <div class="card">
      <div class="kv"><span>最高重量</span><b>${fmtNum(maxSet.weight)} kg × ${maxSet.reps} <span class="muted small">(${fmtShort(maxSet.date)})</span></b></div>
      <div class="kv"><span>推定1RM 最高</span><b>${fmtNum(e1rm(bestE.weight, bestE.reps))} kg <span class="muted small">(${fmtShort(bestE.date)})</span></b></div>
      <div class="kv"><span>実施回数</span><b>${byDate.size} 回</b></div>
    </div>
    <div class="section-title">最近の記録</div>
    ${recent.map((d) => `<button class="hist-item" data-act="goto-date" data-date="${d}">
      <div class="hist-date">${fmtDate(d)}</div>
      <div class="hist-ex">${byDate.get(d).sort(byCreated).map((s) => `${fmtNum(s.weight)}×${s.reps}`).join(', ')}</div>
    </button>`).join('')}`;
}

function lineChart(points) {
  const W = 340, H = 200, L = 40, R = 12, T = 12, B = 26;
  const xs = points.map((p) => fromKey(p.date).getTime());
  const vs = points.map((p) => p.v);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...vs), y1 = Math.max(...vs);
  if (y0 === y1) { y0 -= Math.max(1, y0 * 0.1); y1 += Math.max(1, y1 * 0.1); }
  const padY = (y1 - y0) * 0.1;
  y0 = Math.max(0, y0 - padY); y1 += padY;
  const X = (t) => (x1 === x0 ? (L + W - R) / 2 : L + ((t - x0) / (x1 - x0)) * (W - L - R));
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);

  let grid = '';
  for (let i = 0; i <= 3; i++) {
    const v = y0 + ((y1 - y0) * i) / 3;
    const y = Y(v);
    grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="axis-label" x="${L - 6}" y="${y + 3}" text-anchor="end">${v >= 1000 ? fmtInt(v) : fmtNum(Math.round(v * 10) / 10)}</text>`;
  }
  const pts = points.map((p, i) => [X(xs[i]), Y(p.v)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1][0].toFixed(1)} ${H - B} L${pts[0][0].toFixed(1)} ${H - B} Z` : '';
  const dots = pts.length <= 60 ? pts.map((p, i) => `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="3"><title>${fmtShort(points[i].date)}: ${fmtNum(points[i].v)}</title></circle>`).join('') : '';
  const lbl = `<text class="axis-label" x="${L}" y="${H - 8}">${fmtShort(points[0].date)}</text>`
    + (points.length > 1 ? `<text class="axis-label" x="${W - R}" y="${H - 8}" text-anchor="end">${fmtShort(last(points).date)}</text>` : '');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${METRICS[ui.metric]}の推移">
    ${grid}${area ? `<path class="area" d="${area}"/>` : ''}<path class="line" d="${line}"/>${dots}${lbl}
  </svg>`;
}

/* ---------- 設定 ---------- */
function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

function renderSettings() {
  const counts = new Map();
  for (const s of S.sets) counts.set(s.exerciseId, (counts.get(s.exerciseId) || 0) + 1);
  const lb = S.lastBackup ? new Date(S.lastBackup) : null;

  let h = '';
  if (!isStandalone()) {
    h += `<div class="notice"><b>ホーム画面に追加するのがおすすめ</b><br>
      Safariの共有ボタン →「ホーム画面に追加」でアプリのように使えます。
      Safariでしばらく開かないとデータが消えることがあるので、ホーム画面から使ってください。</div>`;
  }

  h += `<div class="section-title">バックアップ</div>
    <div class="card">
      <div class="small muted">データはこの端末の中だけに保存されています。機種変更やもしもの時のために、ときどき書き出しておいてください。</div>
      <div class="small" style="margin-top:6px">最終バックアップ：${lb ? `${lb.getFullYear()}/${lb.getMonth() + 1}/${lb.getDate()}` : 'まだありません'}</div>
      <div class="btn-row">
        <button class="btn primary" data-act="export">書き出す</button>
        <button class="btn" data-act="import">読み込む</button>
      </div>
      <input type="file" id="importFile" accept=".json,application/json" hidden>
    </div>

    <div class="section-title">休憩タイマー</div>
    <div class="card row-between">
      <span>セット追加後に自動スタート</span>
      <select id="restSec" style="width:auto">
        ${[0, 30, 60, 90, 120, 150, 180, 240].map((s) => `<option value="${s}" ${S.settings.restSec === s ? 'selected' : ''}>${s ? `${Math.floor(s / 60) ? Math.floor(s / 60) + '分' : ''}${s % 60 ? (s % 60) + '秒' : ''}` : 'オフ'}</option>`).join('')}
      </select>
    </div>

    <div class="section-title">種目</div>
    <div class="card">
      <form id="addExForm" class="inline-form" style="margin-top:0">
        <input type="text" name="name" placeholder="新しい種目名" required>
        <select name="part">${PARTS.map((p) => `<option>${p}</option>`).join('')}</select>
        <button class="btn primary" type="submit">追加</button>
      </form>`;
  for (const part of PARTS) {
    const list = S.exercises.filter((e) => e.part === part);
    if (!list.length) continue;
    h += `<div class="part-head">${part}</div>`;
    for (const e of list) {
      h += `<div class="ex-row">
        <span class="name">${esc(e.name)}</span>
        <span class="count">${counts.get(e.id) ? counts.get(e.id) + 'セット' : ''}</span>
        <button class="icon-btn" data-act="rename-ex" data-id="${e.id}" aria-label="名前を変える"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
        <button class="icon-btn" data-act="delete-ex" data-id="${e.id}" aria-label="削除">×</button>
      </div>`;
    }
  }
  h += `</div>
    <p class="muted small" style="text-align:center">記録 ${S.sets.length} セット · 種目 ${S.exercises.length}</p>`;
  return h;
}

async function exportData() {
  S.lastBackup = new Date().toISOString();
  const name = `workout-log-${todayKey()}.json`;
  const file = new File([JSON.stringify(S)], name, { type: 'application/json' });
  let shared = false;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); shared = true; } catch (e) { if (e.name === 'AbortError') return; }
  }
  if (!shared) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  await save();
  render();
  toast('書き出しました');
}

async function importData(file) {
  let d;
  try { d = JSON.parse(await file.text()); } catch { toast('ファイルを読めませんでした'); return; }
  if (!d || !Array.isArray(d.sets) || !Array.isArray(d.exercises)) { toast('このアプリのバックアップではないようです'); return; }
  if (!confirm(`${d.sets.length}セット分の記録で、今のデータを置き換えます。よろしいですか？`)) return;
  S = normalizeState(d);
  await save();
  render();
  toast('読み込みました');
}

/* ---------- タイマー ---------- */
const timer = { end: 0, h: null };
function startTimer(sec = S.settings.restSec) {
  if (!sec) return;
  timer.end = Date.now() + sec * 1000;
  $('#timer').classList.remove('done');
  $('#timer').hidden = false;
  clearInterval(timer.h);
  timer.h = setInterval(tick, 250);
  tick();
}
function tick() {
  const left = Math.ceil((timer.end - Date.now()) / 1000);
  if (left <= 0) {
    clearInterval(timer.h);
    $('#timerTime').textContent = '終了！';
    $('#timer').classList.add('done');
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    return;
  }
  $('#timerTime').textContent = `${Math.floor(left / 60)}:${pad(left % 60)}`;
}
function stopTimer() { clearInterval(timer.h); $('#timer').hidden = true; }

/* ---------- toast ---------- */
let toastT;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 1800);
}

/* =========================================================
   Events
   ========================================================= */
const actions = {
  'prev-day': () => { ui.date = addDays(ui.date, -1); render(); },
  'next-day': () => { ui.date = addDays(ui.date, 1); render(); },
  'open-picker': openPicker,
  'close-sheet': closeSheet,
  'pick-ex': (t) => { addPending(t.dataset.id); closeSheet(); render(); },
  'remove-pending': (t) => {
    const list = ui.pending[ui.date] || [];
    ui.pending[ui.date] = list.filter((id) => id !== t.dataset.ex);
    render();
  },
  'memo-set': async (t) => {
    const s = S.sets.find((x) => x.id === t.dataset.id);
    const memo = prompt('メモ（空にすると削除）', s.memo || '');
    if (memo === null) return;
    if (memo.trim()) s.memo = memo.trim(); else delete s.memo;
    await save();
    render();
  },
  'del-set': async (t) => {
    if (!confirm('このセットを削除しますか？')) return;
    const s = S.sets.find((x) => x.id === t.dataset.id);
    if (s) addPending(s.exerciseId); // 最後の1セットを消してもカードは残す
    S.sets = S.sets.filter((x) => x.id !== t.dataset.id);
    await save();
    render();
  },
  'show-graph': (t) => { ui.graphEx = t.dataset.ex; switchTab('graph'); },
  'goto-date': (t) => { ui.date = t.dataset.date; switchTab('record'); },
  metric: (t) => { ui.metric = t.dataset.v; render(); },
  range: (t) => { ui.range = t.dataset.v; render(); },
  export: exportData,
  import: () => $('#importFile').click(),
  'rename-ex': async (t) => {
    const ex = exById(t.dataset.id);
    const name = prompt('新しい名前', ex.name);
    if (!name || !name.trim() || name.trim() === ex.name) return;
    ex.name = name.trim();
    await save();
    render();
  },
  'delete-ex': async (t) => {
    const ex = exById(t.dataset.id);
    const n = setsOfEx(ex.id).length;
    const msg = n ? `「${ex.name}」と、その記録 ${n} セットをすべて削除します。元に戻せません。よろしいですか？` : `「${ex.name}」を削除しますか？`;
    if (!confirm(msg)) return;
    S.exercises = S.exercises.filter((e) => e.id !== ex.id);
    S.sets = S.sets.filter((s) => s.exerciseId !== ex.id);
    await save();
    render();
  },
  'timer-add': () => { timer.end = Math.max(timer.end, Date.now()) + 30000; startTimer((timer.end - Date.now()) / 1000); },
  'timer-stop': stopTimer,
};

function switchTab(tab) {
  ui.tab = tab;
  render();
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('.tabbar button');
  if (tabBtn) { switchTab(tabBtn.dataset.tab); return; }
  if (e.target.id === 'sheet') { closeSheet(); return; }
  const t = e.target.closest('[data-act]');
  if (t && actions[t.dataset.act]) { e.preventDefault(); actions[t.dataset.act](t, e); }
});

document.addEventListener('submit', async (e) => {
  const f = e.target;
  e.preventDefault();
  if (f.classList.contains('add-set')) {
    const weight = parseFloat(String(f.w.value).replace(',', '.'));
    const reps = parseInt(f.r.value, 10);
    if (!(weight >= 0) || !(reps > 0)) { toast('重量と回数を入れてください'); return; }
    S.sets.push({ id: uid(), date: ui.date, exerciseId: f.dataset.ex, weight, reps, createdAt: Date.now() });
    await save();
    render();
    startTimer();
  } else if (f.id === 'newExForm' || f.id === 'addExForm') {
    const name = f.elements.name.value.trim(); // f.name はフォーム自身の name 属性になるので elements 経由
    if (!name) return;
    if (S.exercises.some((x) => x.name === name)) { toast('同じ名前の種目があります'); return; }
    const ex = { id: uid(), name, part: f.elements.part.value };
    S.exercises.push(ex);
    await save();
    if (f.id === 'newExForm') { addPending(ex.id); closeSheet(); }
    render();
    toast(`「${name}」を追加しました`);
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'dateInput' && t.value) { ui.date = t.value; render(); }
  else if (t.id === 'graphEx') { ui.graphEx = t.value; render(); }
  else if (t.id === 'restSec') { S.settings.restSec = Number(t.value); await save(); toast('保存しました'); }
  else if (t.id === 'importFile' && t.files[0]) { await importData(t.files[0]); t.value = ''; }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'exSearch') renderPickList(e.target.value);
});

// 日付が変わったあとにアプリへ戻ってきたら「今日」に合わせる
let lastToday = todayKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && todayKey() !== lastToday) {
    if (ui.date === lastToday) ui.date = todayKey();
    lastToday = todayKey();
    render();
  }
});

/* ---------- boot ---------- */
(async function boot() {
  const saved = await Store.get('state');
  S = saved ? normalizeState(saved) : defaultState();
  if (!saved) await save();
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
