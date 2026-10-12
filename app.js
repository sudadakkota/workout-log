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
const PART_COLORS = {
  '胸': '#e5484d', '背中': '#3e7bfa', '脚': '#30a46c', '肩': '#f5a524',
  '腕': '#8e4ec6', 'お尻': '#e93d82', '腹': '#12a594', 'その他': '#8b8d98',
};
// アシストマシンで行うことが多い種目（初回起動時にアシスト種目として印を付ける）
const ASSIST_NAME = /懸垂|チンニング|ディップス/;

const TAB_TITLES = { home: 'ホーム', record: '記録', history: '履歴', graph: 'グラフ', settings: '設定' };
const RANGES = { '3m': '3か月', '1y': '1年', all: '全期間' };

// 総負荷量のたとえ（t）
const THINGS = [
  { e: '🐼', n: 'パンダ', t: 0.1, u: '頭' },
  { e: '🐄', n: '牛', t: 0.6, u: '頭' },
  { e: '🚗', n: '乗用車', t: 1.5, u: '台' },
  { e: '🐘', n: 'アフリカゾウ', t: 6, u: '頭' },
  { e: '🚌', n: '路線バス', t: 12, u: '台' },
  { e: '🦕', n: 'ブラキオサウルス', t: 50, u: '頭' },
  { e: '🐋', n: 'シロナガスクジラ', t: 150, u: '頭' },
  { e: '✈️', n: 'ジャンボジェット', t: 400, u: '機' },
  { e: '🗼', n: '東京タワー', t: 4000, u: '基' },
];

/* ---------- utils ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => toKey(new Date());
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); };
const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 86400000);
const WD = '日月火水木金土';
const fmtDate = (k) => { const d = fromKey(k); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} (${WD[d.getDay()]})`; };
const fmtShort = (k) => { const d = fromKey(k); return `${d.getMonth() + 1}/${d.getDate()}`; };
const fmtNum = (n) => String(Math.round(n * 100) / 100);
const fmtInt = (n) => Math.round(n).toLocaleString('ja-JP');
const fmtTon = (kg) => (kg >= 100000 ? fmtInt(kg / 1000) : (kg / 1000).toFixed(2));
const e1rm = (w, r) => (r <= 0 ? 0 : r === 1 ? w : w * (1 + r / 30)); // Epley
const last = (arr) => arr[arr.length - 1];
const byCreated = (a, b) => a.createdAt - b.createdAt;
const ago = (k) => { const n = daysBetween(k, todayKey()); return n === 0 ? '今日' : n === 1 ? '昨日' : `${n}日前`; };

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
    for (const name of names) exercises.push({ id: uid(), name, part, ...(ASSIST_NAME.test(name) ? { assist: true } : {}) });
  }
  return { version: 1, exercises, sets: [], settings: { restSec: 90, assistInit: true }, lastBackup: null, bodyWeights: [], cardio: [] };
}

function normalizeState(d) {
  const base = defaultState();
  return {
    version: 1,
    exercises: d.exercises.map((e) => ({
      id: String(e.id),
      name: String(e.name).normalize('NFC'), // 旧アプリの名前は濁点が分かれた形のことがある
      part: PARTS.includes(e.part) ? e.part : 'その他',
      ...(e.assist ? { assist: true } : {}),
    })),
    sets: d.sets
      .filter((s) => s && s.exerciseId && /^\d{4}-\d{2}-\d{2}$/.test(s.date))
      .map((s) => ({
        id: String(s.id || uid()),
        date: s.date,
        exerciseId: String(s.exerciseId),
        weight: Number(s.weight) || 0,
        reps: Number(s.reps) || 0,
        createdAt: Number(s.createdAt) || 0,
        ...(s.memo ? { memo: String(s.memo).normalize('NFC') } : {}),
      })),
    settings: { ...base.settings, assistInit: false, ...(d.settings || {}) },
    lastBackup: d.lastBackup || null,
    // 体重・有酸素運動は今は画面がないが、取り込んだデータを失わないよう保持する
    bodyWeights: Array.isArray(d.bodyWeights) ? d.bodyWeights : [],
    cardio: Array.isArray(d.cardio) ? d.cardio : [],
  };
}

// 取り込んだデータ（アシストの印がない）に一度だけ印を付ける
function migrate() {
  if (S.settings.assistInit) return false;
  for (const e of S.exercises) if (ASSIST_NAME.test(e.name)) e.assist = true;
  S.settings.assistInit = true;
  return true;
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
const ui = {
  tab: 'home', date: todayKey(), pending: {},
  graphEx: null, metric: 'max', range: '1y',
  calMonth: todayKey().slice(0, 7), calPart: 'ALL',
};

/* ---------- data helpers ---------- */
const exById = (id) => S.exercises.find((e) => e.id === id);
const isAssist = (exId) => !!(exById(exId) || {}).assist;
const setsOn = (date) => S.sets.filter((s) => s.date === date).sort(byCreated);
const setsOfEx = (exId) => S.sets.filter((s) => s.exerciseId === exId);
// 負荷量（アシスト種目は実際の重さがわからないので含めない）
const volumeOf = (sets) => sets.reduce((a, s) => a + (isAssist(s.exerciseId) ? 0 : s.weight * s.reps), 0);

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

// 日付 → その日にやった部位の一覧（PARTS の順）
function partsByDate() {
  const m = new Map();
  for (const s of S.sets) {
    const p = (exById(s.exerciseId) || {}).part || 'その他';
    if (!m.has(s.date)) m.set(s.date, new Set());
    m.get(s.date).add(p);
  }
  for (const [k, v] of m) m.set(k, PARTS.filter((p) => v.has(p)));
  return m;
}

const partChip = (p) => `<span class="chip" style="--c:${PART_COLORS[p]}">${esc(p)}</span>`;

/* =========================================================
   Views
   ========================================================= */
function render() {
  $('#title').textContent = TAB_TITLES[ui.tab];
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  const fn = { home: renderHome, record: renderRecord, history: renderHistory, graph: renderGraph, settings: renderSettings }[ui.tab];
  $('#view').innerHTML = fn();
}

/* ---------- ホーム ---------- */
function thingFor(kg) {
  const t = kg / 1000;
  let pick = THINGS[0];
  for (const th of THINGS) if (t >= th.t * 1.5) pick = th;
  return { ...pick, x: t / pick.t };
}

function loadCard(title, kg, extra = '') {
  const th = thingFor(kg);
  return `<div class="card load">
    <div class="load-title">${title}</div>
    <div class="load-row"><span class="load-val">${fmtTon(kg)}<small> t</small></span>
      <span class="load-thing" title="${th.n} 1${th.u} ≈ ${th.t}t"><span class="emoji">${th.e}</span>${th.n} ×<b>${th.x.toFixed(1)}</b></span></div>
    ${extra}
  </div>`;
}

function renderHome() {
  const today = todayKey();
  const vol7 = volumeOf(S.sets.filter((s) => s.date > addDays(today, -7)));
  const vol28 = volumeOf(S.sets.filter((s) => s.date > addDays(today, -28)));
  const volAll = volumeOf(S.sets);
  const days = new Set(S.sets.map((s) => s.date));
  const monthDays = [...days].filter((d) => d.startsWith(today.slice(0, 7))).length;

  // 直近6週（今日から7日ずつさかのぼる）
  const weeks = [];
  for (let i = 0; i < 6; i++) {
    const to = addDays(today, -7 * i), from = addDays(to, -6);
    weeks.push(volumeOf(S.sets.filter((s) => s.date >= from && s.date <= to)));
  }
  const wmax = Math.max(1, ...weeks);
  const bars = `<div class="wbars">${weeks.map((v, i) => `
    <div class="wbar"><span>${i ? i + '週前' : '直近7日'}</span><i style="width:${(v / wmax) * 100}%" class="${i ? '' : 'now'}"></i><em>${fmtTon(v)}t</em></div>`).join('')}</div>`;

  // 総合計：次の目標
  const th = thingFor(volAll);
  const nextN = Math.floor(th.x) + 1;
  const goal = volAll > 0
    ? `<div class="goal">次の目標：${th.e}${th.n} <b>${nextN}</b>${th.u}分まで あと <b>${fmtTon(nextN * th.t * 1000 - volAll)}</b> t</div>`
    : '';

  // 部位ごとの最終日
  const lastByPart = new Map();
  for (const [date, parts] of partsByDate()) for (const p of parts) if (!lastByPart.has(p) || lastByPart.get(p) < date) lastByPart.set(p, date);
  const partTiles = PARTS.filter((p) => lastByPart.has(p)).map((p) => {
    const d = lastByPart.get(p);
    return `<button class="ptile" data-act="part-history" data-part="${p}" style="--c:${PART_COLORS[p]}">
      <span class="ptile-name">${p}</span><span class="ptile-ago ${daysBetween(d, today) >= 7 ? 'stale' : ''}">${ago(d)}</span></button>`;
  }).join('');

  const todaySets = setsOn(today);
  return `
    <button class="btn primary block big" data-act="goto-date" data-date="${today}">
      ${todaySets.length ? `今日の記録を見る（${todaySets.length}セット）` : '＋ 今日のトレーニングを記録'}
    </button>
    <div class="stat-row">
      <div class="stat"><b>${monthDays}</b><span>今月の日数</span></div>
      <div class="stat"><b>${days.size}</b><span>累計日数</span></div>
      <div class="stat"><b>${fmtInt(S.sets.length)}</b><span>累計セット</span></div>
    </div>
    ${partTiles ? `<div class="section-title">部位ごとの最終トレーニング</div><div class="ptiles">${partTiles}</div>` : ''}
    <div class="section-title">合計負荷量</div>
    ${loadCard('直近7日間', vol7, bars)}
    ${loadCard('直近28日間', vol28)}
    ${loadCard('総合計', volAll, goal)}
    <p class="muted tiny center">負荷量 = 重量 × 回数の合計（アシスト種目は含みません）</p>`;
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

  if (sets.length) {
    h += `<div class="day-summary">
      <span><b>${order.length}</b>種目</span><span><b>${sets.length}</b>セット</span><span><b>${fmtInt(volumeOf(sets))}</b>kg</span>
    </div>`;
  }
  if (!order.length) {
    h += `<div class="empty"><div class="big">🏋️</div>${date === todayKey() ? '今日のトレーニングを記録しよう' : 'この日の記録はありません'}</div>`;
  }
  for (const id of order) h += exerciseCard(id, date, sets.filter((s) => s.exerciseId === id));
  h += `<button class="btn dashed block" data-act="open-picker">＋ 種目を追加</button>`;
  return h;
}

function exerciseCard(id, date, list) {
  const ex = exById(id);
  const assist = !!ex.assist;
  const prev = prevSession(id, date);
  // 入力欄の初期値：前回の「次のセット」→ 今日の最後のセット → 前回の最後のセット
  const ref = (prev && prev.sets[list.length]) || last(list) || (prev && last(prev.sets));

  // PR：通常はそれまでの最高重量を超えたら、アシストはそれまでの最小アシストを下回ったら
  const before = S.sets.filter((s) => s.exerciseId === id && s.date < date && s.reps > 0).map((s) => s.weight);
  let best = before.length ? (assist ? Math.min(...before) : Math.max(...before)) : null;
  const better = (w) => (assist ? w < best : w > best);
  const rows = list.map((s, i) => {
    const isPR = best !== null && s.reps > 0 && better(s.weight);
    if (s.reps > 0 && (best === null || better(s.weight))) best = s.weight;
    return `<li><button class="set-btn" data-act="edit-set" data-id="${s.id}">
      <span class="set-no">${i + 1}</span>
      <span class="set-val"><b>${fmtNum(s.weight)}</b>kg × <b>${s.reps}</b>回${s.memo ? `<span class="set-memo">${esc(s.memo)}</span>` : ''}</span>
      ${isPR ? '<span class="pr">PR</span>' : ''}
    </button></li>`;
  }).join('');

  let prevHtml = '';
  if (prev) {
    const chips = prev.sets.map((s, i) => `<button type="button" class="pchip ${i === list.length ? 'next' : ''}" data-act="fill" data-ex="${id}" data-w="${s.weight}" data-r="${s.reps}">${fmtNum(s.weight)}×${s.reps}</button>`).join('');
    const remain = prev.sets.length - list.length;
    prevHtml = `<div class="prev">
      <div class="prev-head"><span>前回 ${fmtShort(prev.date)}（${ago(prev.date)}）</span>
        ${remain > 0 ? `<button type="button" class="link" data-act="copy-prev" data-ex="${id}">${list.length ? `残り${remain}セット` : `${remain}セット全部`}をコピー</button>` : ''}</div>
      <div class="pchips">${chips}</div>
      ${prev.sets.some((s) => s.memo) ? `<div class="prev-memo">📝 ${prev.sets.filter((s) => s.memo).map((s) => esc(s.memo)).join(' / ')}</div>` : ''}
    </div>`;
  }

  return `<section class="card ex-card">
    <div class="card-head">
      <div class="ex-title"><span class="ex-name">${esc(ex.name)}</span>${partChip(ex.part)}${assist ? '<span class="assist-badge">アシスト</span>' : ''}</div>
      ${list.length
        ? `<button class="icon-btn sm" data-act="show-graph" data-ex="${id}" aria-label="グラフを見る"><svg viewBox="0 0 24 24"><path d="M4 4v16h16"/><path d="M7.5 15l4-4.5 3 3L20 7"/></svg></button>`
        : `<button class="icon-btn sm" data-act="remove-pending" data-ex="${id}" aria-label="この種目を外す">×</button>`}
    </div>
    ${prevHtml}
    ${rows ? `<ol class="sets">${rows}</ol>` : ''}
    <form class="add-set" data-ex="${id}">
      <label class="unit-input"><input name="w" type="number" inputmode="decimal" step="any" min="0" value="${ref ? fmtNum(ref.weight) : ''}" placeholder="0" aria-label="${assist ? 'アシスト重量' : '重量'}"><span>${assist ? 'kg補助' : 'kg'}</span></label>
      <label class="unit-input"><input name="r" type="number" inputmode="numeric" step="1" min="1" value="${ref ? ref.reps : ''}" placeholder="0" aria-label="回数"><span>回</span></label>
      <button class="btn primary" type="submit">追加</button>
    </form>
  </section>`;
}

function openSheet(html) { $('#sheetBody').innerHTML = html; $('#sheet').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; $('#sheetBody').innerHTML = ''; }

function openPicker() {
  openSheet(`
    <div class="sheet-head"><h2>種目を選ぶ</h2><button class="btn sm" data-act="close-sheet">閉じる</button></div>
    <input type="search" id="exSearch" placeholder="種目を検索" autocomplete="off">
    <div id="pickList" class="pick-list"></div>
    <div class="section-title">新しい種目を作る</div>
    <form id="newExForm" class="inline-form">
      <input type="text" name="name" placeholder="種目名" required>
      <select name="part">${PARTS.map((p) => `<option>${p}</option>`).join('')}</select>
      <button class="btn primary" type="submit">作成</button>
    </form>`);
  renderPickList('');
}

function renderPickList(q) {
  const used = lastUsedMap();
  const query = q.trim().normalize('NFC').toLowerCase();
  const match = (e) => !query || e.name.toLowerCase().includes(query);
  const item = (e) => `<button class="pick-item" data-act="pick-ex" data-id="${e.id}">
    <span>${esc(e.name)}${e.assist ? ' <span class="assist-badge">アシスト</span>' : ''}</span>
    <span class="tiny muted">${used.has(e.id) ? ago(used.get(e.id)) : ''}</span></button>`;
  let h = '';
  if (!query) {
    const recent = S.exercises.filter((e) => used.has(e.id)).sort((a, b) => (used.get(b.id) > used.get(a.id) ? 1 : -1)).slice(0, 6);
    if (recent.length) h += `<div class="part-head">最近</div>` + recent.map(item).join('');
  }
  for (const part of PARTS) {
    const list = S.exercises.filter((e) => e.part === part && match(e));
    if (list.length) h += `<div class="part-head" style="color:${PART_COLORS[part]}">${part}</div>` + list.map(item).join('');
  }
  $('#pickList').innerHTML = h || '<p class="muted small">見つかりません。下で新しく作れます。</p>';
}

function openSetEditor(id) {
  const s = S.sets.find((x) => x.id === id);
  if (!s) return;
  const ex = exById(s.exerciseId);
  openSheet(`
    <div class="sheet-head"><h2>${esc(ex ? ex.name : '')}・${fmtShort(s.date)}</h2><button class="btn sm" data-act="close-sheet">閉じる</button></div>
    <form id="editSetForm" data-id="${s.id}">
      <div class="add-set two">
        <label class="unit-input"><input name="w" type="number" inputmode="decimal" step="any" min="0" value="${fmtNum(s.weight)}" aria-label="重量"><span>${ex && ex.assist ? 'kg補助' : 'kg'}</span></label>
        <label class="unit-input"><input name="r" type="number" inputmode="numeric" step="1" min="0" value="${s.reps}" aria-label="回数"><span>回</span></label>
      </div>
      <input type="text" name="memo" value="${esc(s.memo || '')}" placeholder="メモ（例：次は軽くする）" style="margin-top:8px">
      <div class="btn-row">
        <button type="button" class="btn danger" data-act="del-set" data-id="${s.id}">削除</button>
        <button type="submit" class="btn primary">保存</button>
      </div>
    </form>`);
}

function addPending(exId) {
  const list = ui.pending[ui.date] || (ui.pending[ui.date] = []);
  if (!list.includes(exId)) list.push(exId);
}

/* ---------- 履歴（カレンダー） ---------- */
function renderHistory() {
  if (!S.sets.length) return `<div class="empty"><div class="big">📅</div>まだ記録がありません</div>`;
  const pbd = partsByDate();
  const usedParts = PARTS.filter((p) => [...pbd.values()].some((ps) => ps.includes(p)));
  const filter = ui.calPart;
  const has = (k) => pbd.has(k) && (filter === 'ALL' || pbd.get(k).includes(filter));

  const [y, m] = ui.calMonth.split('-').map(Number);
  const startDow = new Date(y, m - 1, 1).getDay();
  const nDays = new Date(y, m, 0).getDate();
  const today = todayKey();
  const color = filter === 'ALL' ? 'var(--accent)' : PART_COLORS[filter];
  let cells = '';
  for (let i = 0; i < startDow; i++) cells += '<span></span>';
  for (let d = 1; d <= nDays; d++) {
    const k = `${ui.calMonth}-${pad(d)}`;
    const on = has(k);
    const dots = pbd.has(k) && filter === 'ALL' ? `<span class="dots">${pbd.get(k).slice(0, 4).map((p) => `<i style="background:${PART_COLORS[p]}"></i>`).join('')}</span>` : '';
    cells += `<button class="cal-day ${on ? 'on' : ''} ${k === today ? 'today' : ''}" style="--c:${color}" ${pbd.has(k) ? `data-act="goto-date" data-date="${k}"` : 'disabled'}>
      <span class="num">${d}</span>${dots}</button>`;
  }

  const monthDates = [...pbd.keys()].filter((k) => k.startsWith(ui.calMonth) && has(k)).sort().reverse();
  const byDate = groupByDate(S.sets.filter((s) => s.date.startsWith(ui.calMonth)));
  const list = monthDates.map((d) => {
    const sets = byDate.get(d).sort(byCreated);
    const names = [];
    for (const s of sets) {
      const n = (exById(s.exerciseId) || {}).name || '(削除された種目)';
      if (!names.includes(n)) names.push(n);
    }
    return `<button class="hist-item" data-act="goto-date" data-date="${d}">
      <div class="hist-top"><span class="hist-date">${fmtDate(d)}</span><span class="hist-parts">${pbd.get(d).map(partChip).join('')}</span></div>
      <div class="hist-ex">${names.map(esc).join(' / ')}</div>
      <div class="hist-meta">${sets.length}セット · ${fmtInt(volumeOf(sets))} kg</div>
    </button>`;
  }).join('');

  const firstMonth = [...pbd.keys()].sort()[0].slice(0, 7);
  return `
    <div class="filter-row">
      <button class="fchip ${filter === 'ALL' ? 'active' : ''}" data-act="cal-part" data-part="ALL">ALL</button>
      ${usedParts.map((p) => `<button class="fchip ${filter === p ? 'active' : ''}" style="--c:${PART_COLORS[p]}" data-act="cal-part" data-part="${p}">${p}</button>`).join('')}
    </div>
    <div class="card cal">
      <div class="cal-head">
        <button class="icon-btn sm" data-act="cal-prev" ${ui.calMonth <= firstMonth ? 'disabled' : ''} aria-label="前の月">‹</button>
        <span>${y}年${m}月 <small class="muted">${monthDates.length}日</small></span>
        <button class="icon-btn sm" data-act="cal-next" ${ui.calMonth >= today.slice(0, 7) ? 'disabled' : ''} aria-label="次の月">›</button>
      </div>
      <div class="cal-grid">${[...WD].map((w, i) => `<span class="cal-wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}${cells}</div>
    </div>
    ${list || '<p class="muted small center">この月の記録はありません</p>'}`;
}

function shiftMonth(n) {
  const [y, m] = ui.calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  ui.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  render();
}

/* ---------- グラフ ---------- */
function metricsFor(ex) {
  return ex.assist
    ? { min: 'アシスト（最小）', reps: '合計回数' }
    : { max: '最大重量', e1rm: '推定1RM', volume: 'ボリューム' };
}

function renderGraph() {
  const used = lastUsedMap();
  const exList = S.exercises.filter((e) => used.has(e.id)).sort((a, b) => (used.get(b.id) > used.get(a.id) ? 1 : -1));
  if (!exList.length) return `<div class="empty"><div class="big">📈</div>記録するとここにグラフが出ます</div>`;
  if (!exList.some((e) => e.id === ui.graphEx)) ui.graphEx = exList[0].id;
  const ex = exById(ui.graphEx);
  const metrics = metricsFor(ex);
  if (!metrics[ui.metric]) ui.metric = Object.keys(metrics)[0];

  const all = setsOfEx(ex.id).filter((s) => s.reps > 0);
  if (!all.length) return `<div class="empty">この種目の記録はまだありません</div>`;
  const byDate = groupByDate(all);
  let points = [...byDate.keys()].sort().map((d) => {
    const ss = byDate.get(d);
    const v = ui.metric === 'max' ? Math.max(...ss.map((s) => s.weight))
      : ui.metric === 'min' ? Math.min(...ss.map((s) => s.weight))
      : ui.metric === 'e1rm' ? Math.max(...ss.map((s) => e1rm(s.weight, s.reps)))
      : ui.metric === 'reps' ? ss.reduce((a, s) => a + s.reps, 0)
      : ss.reduce((a, s) => a + s.weight * s.reps, 0);
    return { date: d, v };
  });
  if (ui.range !== 'all') {
    const from = addDays(todayKey(), ui.range === '3m' ? -92 : -366);
    points = points.filter((p) => p.date >= from);
  }

  let stats;
  if (ex.assist) {
    const minSet = all.reduce((b, s) => (!b || s.weight < b.weight || (s.weight === b.weight && s.reps > b.reps) ? s : b), null);
    const firstD = [...byDate.keys()].sort()[0];
    const firstMin = Math.min(...byDate.get(firstD).map((s) => s.weight));
    stats = `
      <div class="kv"><span>最小アシスト</span><b>${fmtNum(minSet.weight)} kg × ${minSet.reps} <span class="muted small">(${fmtShort(minSet.date)})</span></b></div>
      <div class="kv"><span>はじめた頃から</span><b>${fmtNum(firstMin)} → ${fmtNum(minSet.weight)} kg${firstMin > minSet.weight ? ` <span class="good">（−${fmtNum(firstMin - minSet.weight)}kg）</span>` : ''}</b></div>
      <div class="kv"><span>実施回数</span><b>${byDate.size} 回</b></div>`;
  } else {
    const maxSet = all.reduce((b, s) => (!b || s.weight > b.weight ? s : b), null);
    const bestE = all.reduce((b, s) => (!b || e1rm(s.weight, s.reps) > e1rm(b.weight, b.reps) ? s : b), null);
    stats = `
      <div class="kv"><span>最高重量</span><b>${fmtNum(maxSet.weight)} kg × ${maxSet.reps} <span class="muted small">(${fmtShort(maxSet.date)})</span></b></div>
      <div class="kv"><span>推定1RM 最高</span><b>${fmtNum(e1rm(bestE.weight, bestE.reps))} kg <span class="muted small">(${fmtShort(bestE.date)})</span></b></div>
      <div class="kv"><span>実施回数</span><b>${byDate.size} 回</b></div>`;
  }
  const recent = [...byDate.keys()].sort().reverse().slice(0, 8);

  return `
    <div class="card">
      <select id="graphEx" aria-label="種目">${exList.map((e) => `<option value="${e.id}" ${e.id === ui.graphEx ? 'selected' : ''}>${esc(e.name)}${e.assist ? '（アシスト）' : ''}</option>`).join('')}</select>
      <div class="seg">${Object.entries(metrics).map(([k, v]) => `<button data-act="metric" data-v="${k}" class="${ui.metric === k ? 'active' : ''}">${v}</button>`).join('')}</div>
      <div class="seg">${Object.entries(RANGES).map(([k, v]) => `<button data-act="range" data-v="${k}" class="${ui.range === k ? 'active' : ''}">${v}</button>`).join('')}</div>
      ${ui.metric === 'min' ? '<p class="tiny muted center" style="margin:6px 0 0">↓ アシストが少ないほど強くなっています</p>' : ''}
      ${points.length ? lineChart(points, metrics[ui.metric]) : '<p class="muted small center" style="padding:40px 0">この期間の記録はありません</p>'}
    </div>
    <div class="card">${stats}</div>
    <div class="section-title">最近の記録</div>
    ${recent.map((d) => `<button class="hist-item" data-act="goto-date" data-date="${d}">
      <div class="hist-date">${fmtDate(d)}</div>
      <div class="hist-ex">${byDate.get(d).sort(byCreated).map((s) => `${fmtNum(s.weight)}×${s.reps}`).join(', ')}</div>
    </button>`).join('')}`;
}

function lineChart(points, label) {
  const W = 340, H = 190, L = 36, R = 10, T = 10, B = 24;
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
    grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="axis-label" x="${L - 5}" y="${y + 3}" text-anchor="end">${v >= 1000 ? fmtInt(v) : fmtNum(Math.round(v * 10) / 10)}</text>`;
  }
  const pts = points.map((p, i) => [X(xs[i]), Y(p.v)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = pts.length > 1 ? `${line} L${last(pts)[0].toFixed(1)} ${H - B} L${pts[0][0].toFixed(1)} ${H - B} Z` : '';
  const dots = pts.length <= 60 ? pts.map((p, i) => `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="2.5"><title>${fmtShort(points[i].date)}: ${fmtNum(points[i].v)}</title></circle>`).join('') : '';
  // 期間が年をまたぐときは年も付ける
  const multiYear = points[0].date.slice(0, 4) !== last(points).date.slice(0, 4);
  const xl = (k) => (multiYear ? `${k.slice(2, 4)}/` : '') + fmtShort(k);
  const lbl = `<text class="axis-label" x="${L}" y="${H - 7}">${xl(points[0].date)}</text>`
    + (points.length > 1 ? `<text class="axis-label" x="${W - R}" y="${H - 7}" text-anchor="end">${xl(last(points).date)}</text>` : '');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}の推移">
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
      <div class="small" style="margin-top:4px">最終バックアップ：${lb ? `${lb.getFullYear()}/${lb.getMonth() + 1}/${lb.getDate()}` : 'まだありません'}</div>
      <div class="btn-row">
        <button class="btn primary" data-act="export">書き出す</button>
        <button class="btn" data-act="import">読み込む</button>
      </div>
      <input type="file" id="importFile" accept=".json,application/json" hidden>
    </div>

    <div class="section-title">休憩タイマー</div>
    <div class="card row-between">
      <span class="small">セット追加後に自動スタート</span>
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
      </form>
      <p class="tiny muted" style="margin:8px 0 0">「アシスト」をオンにすると、重量をアシスト（補助）の重さとして扱います。少ないほどPRになり、負荷量には含めません。</p>`;
  for (const part of PARTS) {
    const list = S.exercises.filter((e) => e.part === part);
    if (!list.length) continue;
    h += `<div class="part-head" style="color:${PART_COLORS[part]}">${part}</div>`;
    for (const e of list) {
      h += `<div class="ex-row">
        <span class="name">${esc(e.name)}</span>
        <span class="count">${counts.get(e.id) ? counts.get(e.id) + 'セット' : ''}</span>
        <button class="toggle ${e.assist ? 'on' : ''}" data-act="toggle-assist" data-id="${e.id}" aria-pressed="${!!e.assist}">アシスト</button>
        <button class="icon-btn sm" data-act="rename-ex" data-id="${e.id}" aria-label="名前を変える"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
        <button class="icon-btn sm" data-act="delete-ex" data-id="${e.id}" aria-label="削除">×</button>
      </div>`;
    }
  }
  h += `</div><p class="muted tiny center">記録 ${S.sets.length} セット · 種目 ${S.exercises.length}</p>`;
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
  migrate();
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
  toastT = setTimeout(() => el.classList.remove('show'), 2200);
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
  // 前回のセットをタップ → 入力欄にその重量・回数を入れる
  fill: (t) => {
    const f = document.querySelector(`form.add-set[data-ex="${t.dataset.ex}"]`);
    if (!f) return;
    f.w.value = fmtNum(Number(t.dataset.w));
    f.r.value = t.dataset.r;
    t.parentElement.querySelectorAll('.pchip').forEach((c) => c.classList.toggle('next', c === t));
  },
  'copy-prev': async (t) => {
    const exId = t.dataset.ex;
    const prev = prevSession(exId, ui.date);
    if (!prev) return;
    const done = S.sets.filter((s) => s.exerciseId === exId && s.date === ui.date).length;
    const now = Date.now();
    prev.sets.slice(done).forEach((s, i) => {
      S.sets.push({ id: uid(), date: ui.date, exerciseId: exId, weight: s.weight, reps: s.reps, createdAt: now + i });
    });
    await save();
    render();
    toast('コピーしました。違うセットはタップで直せます');
  },
  'edit-set': (t) => openSetEditor(t.dataset.id),
  'del-set': async (t) => {
    if (!confirm('このセットを削除しますか？')) return;
    const s = S.sets.find((x) => x.id === t.dataset.id);
    if (s) addPending(s.exerciseId); // 最後の1セットを消してもカードは残す
    S.sets = S.sets.filter((x) => x.id !== t.dataset.id);
    await save();
    closeSheet();
    render();
  },
  'show-graph': (t) => { ui.graphEx = t.dataset.ex; switchTab('graph'); },
  'goto-date': (t) => { ui.date = t.dataset.date; switchTab('record'); },
  'part-history': (t) => { ui.calPart = t.dataset.part; ui.calMonth = todayKey().slice(0, 7); switchTab('history'); },
  'cal-part': (t) => { ui.calPart = t.dataset.part; render(); },
  'cal-prev': () => shiftMonth(-1),
  'cal-next': () => shiftMonth(1),
  metric: (t) => { ui.metric = t.dataset.v; render(); },
  range: (t) => { ui.range = t.dataset.v; render(); },
  export: exportData,
  import: () => $('#importFile').click(),
  'toggle-assist': async (t) => {
    const ex = exById(t.dataset.id);
    if (ex.assist) delete ex.assist; else ex.assist = true;
    await save();
    render();
  },
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

const parseWeight = (v) => parseFloat(String(v).replace(',', '.'));

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('.tabbar button');
  if (tabBtn) {
    // 下のタブから「記録」を開いたときは今日の日付にする
    if (tabBtn.dataset.tab === 'record' && ui.tab !== 'record') ui.date = todayKey();
    switchTab(tabBtn.dataset.tab);
    return;
  }
  if (e.target.id === 'sheet') { closeSheet(); return; }
  const t = e.target.closest('[data-act]');
  if (t && !t.disabled && actions[t.dataset.act]) { e.preventDefault(); actions[t.dataset.act](t, e); }
});

document.addEventListener('submit', async (e) => {
  const f = e.target;
  e.preventDefault();
  if (f.classList.contains('add-set')) {
    const weight = parseWeight(f.w.value);
    const reps = parseInt(f.r.value, 10);
    if (!(weight >= 0) || !(reps > 0)) { toast('重量と回数を入れてください'); return; }
    S.sets.push({ id: uid(), date: ui.date, exerciseId: f.dataset.ex, weight, reps, createdAt: Date.now() });
    await save();
    render();
    startTimer();
  } else if (f.id === 'editSetForm') {
    const s = S.sets.find((x) => x.id === f.dataset.id);
    const weight = parseWeight(f.w.value);
    const reps = parseInt(f.r.value, 10);
    if (!s || !(weight >= 0) || !(reps >= 0)) { toast('重量と回数を確認してください'); return; }
    s.weight = weight;
    s.reps = reps;
    const memo = f.elements.memo.value.trim();
    if (memo) s.memo = memo; else delete s.memo;
    await save();
    closeSheet();
    render();
  } else if (f.id === 'newExForm' || f.id === 'addExForm') {
    const name = f.elements.name.value.trim(); // f.name はフォーム自身の name 属性になるので elements 経由
    if (!name) return;
    if (S.exercises.some((x) => x.name === name)) { toast('同じ名前の種目があります'); return; }
    const ex = { id: uid(), name, part: f.elements.part.value, ...(ASSIST_NAME.test(name) ? { assist: true } : {}) };
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
  if (!saved || migrate()) await save();
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
