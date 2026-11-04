/* ---------- Global Opening Prep 연동 + 서버 저장 (사용자) ----------
   같은 Firebase(global-opening-prep), 같은 주소(karrotinab.github.io)라서 Global Opening Prep에 로그인돼 있으면 여기서도 그대로 로그인됨.
   - ?pog={POG id} 로 열면: 서버에 저장된 계산 작업(calc/{pogId})을 불러오고, 없으면 Global POG 페이지(pogs/{id}/fixtures)로 새로 만든다.
   - 저장: calc/{pogId} = { pogId, storeCode, storeName, fxIds[], collectedAt, state(JSON: edits·mdTypes·propTypes·done), mdParts, prodParts, updatedAt, updatedBy }
           calc/{pogId}/parts/{md_0…|pr_0…} = { json } (매대·상품 원본을 1MB 제한 안에서 나눠 저장)
           calcSettings/shared = { json } (설정값: 깊이·상한·추가 종류. 모두 같이 씀)
   - POG 페이지가 추가·삭제되면(fxIds가 다르면) 위쪽에 알림 → [새로 불러오기] / [나중에]
   - 볼 수 있는 계정: 관리자·글로벌사업부 (보안 규칙도 같음). 그 밖의 계정·로그아웃 상태면 예전처럼 이 컴퓨터에만 저장 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, getDocs, setDoc, deleteDoc, collection, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const fb = initializeApp({
  apiKey: 'AIzaSyDOvpyvRuCnq9YnLnFRqVdc8bryL4q-SFs',
  authDomain: 'global-opening-prep.firebaseapp.com',
  projectId: 'global-opening-prep',
  storageBucket: 'global-opening-prep.firebasestorage.app',
  messagingSenderId: '981145496504',
  appId: '1:981145496504:web:cc191935d21fdbed28fd4d',
});
const auth = getAuth(fb), db = getFirestore(fb);
const GLOBAL_URL = 'https://karrotinab.github.io/pog-global/';
const C = { ok: false, user: null, pogId: null, storeCode: null, fxIds: null, prodSig: '', saving: false, timer: null, loading: false, latest: null };
const W = window;

/* ---------- 작은 도구 ---------- */
const $ = id => document.getElementById(id);
const me = () => (C.user?.email || '').toLowerCase();
function bar(html, cls = '') {
  let b = $('cloud-bar');
  if (!b) { b = document.createElement('div'); b.id = 'cloud-bar'; document.body.append(b); }
  b.className = cls; b.innerHTML = html; b.style.display = html ? '' : 'none';
  return b;
}
function chunks(arr, max = 700000) { // JSON 글자 수로 나눔 (Firestore 문서 1MB 제한)
  const out = []; let cur = [], size = 2;
  for (const x of arr) { const s = JSON.stringify(x).length + 1; if (cur.length && size + s > max) { out.push(cur); cur = []; size = 2; } cur.push(x); size += s; }
  if (cur.length) out.push(cur);
  return out;
}
const fxIdsOf = fixtures => fixtures.filter(f => f.kind !== 'free' && f.mdidx).map(f => f.id).sort();
const setStatus = t => { const s = $('save-status'); if (s) s.textContent = t; };

/* ---------- Global POG 페이지 → 계산기 데이터 (Global POG의 'POG 계산기용 파일'과 같은 모양) ---------- */
function buildPayload(pog, fixtures) {
  const by = new Map();
  for (const f of [...fixtures].sort((a, b) => a.order - b.order)) {
    if (f.kind === 'free' || !f.mdidx) continue;
    if (!by.has(f.mdidx)) by.set(f.mdidx, []);
    by.get(f.mdidx).push(f);
  }
  const mds = [...by.entries()].map(([mdidx, parts]) => {
    const f0 = parts[0], src = parts.find(p => p.src)?.src;
    const seenI = new Set(), seenP = new Set(), items = [], props = [];
    for (const p of parts) {
      for (const it of p.items || []) if (!seenI.has(String(it.id))) {
        seenI.add(String(it.id));
        const gp = String(it.group || '').split('_'), dims = gp.length >= 4 && gp.slice(-3).every(x => /^\d+(\.\d+)?$/.test(x)) ? { w: +gp.at(-3), h: +gp.at(-2), d: +gp.at(-1) } : null;
        items.push({ objidx: String(it.id), code: it.code, name: it.name, price: it.price || 0, group: dims ? gp.slice(0, -3).join('_') : it.group || '', dims, image: it.img || '', x: it.x, y: it.y, w: it.w, h: it.h, z: it.z || 0 });
      }
      (p.props || []).forEach((pr, i) => {
        const key = pr.id != null && pr.id !== '' ? String(pr.id) : `${p.id}#${i}`; if (seenP.has(key)) return;
        seenP.add(key);
        props.push({ objidx: pr.id != null ? String(pr.id) : '', kind: pr.opt !== undefined && pr.opt !== '' ? (pr.opt === 'Y' ? '파이프' : '선반') : (/파이프/.test(pr.kind || '') ? '파이프' : '선반'), x: pr.x, y: pr.y, w: pr.w, h: pr.h });
      });
    }
    return { mdidx, team: f0.teamName || '', mdname: f0.mdName || '', note: '', mdtype: src?.mdtype || '', listItem: String(items.length), url: '',
      detail: { title: f0.mdName || '', mdidx, mdtype: src?.mdtype || '', mdcnt: src?.mdcnt || 1, bays: src?.bays || [], bodies: src?.bodies || [], items, props, memos: src?.memos || [] } };
  });
  return { type: 'POG_FL_DATA', version: 1, source: 'global-pog', collectedAt: new Date().toISOString(),
    store: { code: pog.storeCode || '', name: pog.branchName || pog.storeName || '', saup: pog.saup || '00' }, mds, products: {} };
}

/* ---------- 서버에 쓰기 ---------- */
async function writeParts(prefix, list, oldCount) {
  const parts = chunks(list); const b = writeBatch(db);
  parts.forEach((c, i) => b.set(doc(db, 'calc', C.pogId, 'parts', `${prefix}_${i}`), { json: JSON.stringify(c) }));
  for (let i = parts.length; i < (oldCount || 0); i++) b.delete(doc(db, 'calc', C.pogId, 'parts', `${prefix}_${i}`));
  await b.commit();
  return parts.length;
}
const stateJson = P => JSON.stringify({ edits: P.edits || {}, mdTypes: P.mdTypes || {}, propTypes: P.propTypes || {}, done: P.done || {} });
async function saveAll(P, fxIds, old) { // 매대·상품 원본까지 통째로 (처음 만들 때·새로 불러올 때)
  const mdParts = await writeParts('md', P.mds, old?.mdParts);
  const prods = Object.values(P.products || {});
  const prodParts = await writeParts('pr', prods, old?.prodParts);
  C.prodSig = prodSig(P);
  await setDoc(doc(db, 'calc', C.pogId), { pogId: C.pogId, storeCode: P.store.code || '', storeName: P.store.name || '', fxIds, collectedAt: P.collectedAt || '',
    state: stateJson(P), mdParts, prodParts, updatedAt: serverTimestamp(), updatedBy: me() });
  C.meta = { mdParts, prodParts };
}
const prodSig = P => { const ks = Object.keys(P.products || {}); return ks.length + '|' + ks.filter(k => P.products[k] && !P.products[k].error).length; };
// 계산기 화면이 저장할 때마다 (saveNow → 여기). 1초 모아서 고친 값만 저장 (상품 정보가 새로 채워졌으면 그것도)
W.cloudSave = function () {
  const P = W.P;
  if (!C.ok || !C.pogId || C.loading || !P || String(P.store.code || '') !== String(C.storeCode || '')) return;
  clearTimeout(C.timer);
  C.timer = setTimeout(async () => {
    try {
      setStatus('서버에 저장 중…');
      const patch = { state: stateJson(P), updatedAt: serverTimestamp(), updatedBy: me() };
      if (prodSig(P) !== C.prodSig) { patch.prodParts = await writeParts('pr', Object.values(P.products || {}), C.meta?.prodParts); C.meta = { ...(C.meta || {}), prodParts: patch.prodParts }; C.prodSig = prodSig(P); }
      await setDoc(doc(db, 'calc', C.pogId), patch, { merge: true });
      setStatus('☁ 서버 저장 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) { setStatus('⚠️ 서버 저장 실패'); console.warn(e); W.toast?.('서버에 저장하지 못했어요: ' + (e.code || e.message)); }
  }, 1000);
};
// 설정값(깊이·상한·추가 종류)은 모두 같이 씀
W.cloudSaveSettings = function () {
  if (!C.ok) return;
  setDoc(doc(db, 'calcSettings', 'shared'), { json: JSON.stringify(W.SET), updatedAt: serverTimestamp(), updatedBy: me() }).catch(e => console.warn(e));
};

/* ---------- 불러오기 ---------- */
async function readParts(prefix, n) {
  const out = [];
  const docs = await Promise.all(Array.from({ length: n || 0 }, (_, i) => getDoc(doc(db, 'calc', C.pogId, 'parts', `${prefix}_${i}`))));
  docs.forEach(d => { if (d.exists()) out.push(...JSON.parse(d.data().json || '[]')); });
  return out;
}
async function loadFixtures(pogId) {
  const [p, fs] = await Promise.all([getDoc(doc(db, 'pogs', pogId)), getDocs(collection(db, 'pogs', pogId, 'fixtures'))]);
  if (!p.exists()) throw new Error('POG를 찾지 못했어요');
  return { pog: { id: p.id, ...p.data() }, fixtures: fs.docs.map(d => ({ id: d.id, ...d.data() })) };
}
function useP(P) { // 계산기 화면에 넣기 (afterLoad가 localStorage에도 저장함)
  C.loading = true;
  W.P = P; W.cur = 0;
  try { W.afterLoad(); } finally { C.loading = false; }
}
async function openCloud(pogId) {
  C.pogId = pogId; C.latest = null; bar('');
  try { localStorage.setItem('pogfl:cloudLast', pogId); } catch (e) {}
  const u = new URL(location.href); if (u.searchParams.get('pog') !== pogId) { u.searchParams.set('pog', pogId); history.replaceState(null, '', u); }
  setStatus('서버에서 불러오는 중…');
  try {
    const snap = await getDoc(doc(db, 'calc', pogId));
    if (snap.exists()) {
      const m = snap.data(); C.meta = { mdParts: m.mdParts, prodParts: m.prodParts }; C.storeCode = m.storeCode; C.fxIds = m.fxIds || [];
      const [mds, prods] = await Promise.all([readParts('md', m.mdParts), readParts('pr', m.prodParts)]);
      const st = JSON.parse(m.state || '{}'), products = {};
      prods.forEach(p => { if (p && p.code) products[p.code] = p; });
      const P = { store: { code: m.storeCode, name: m.storeName }, collectedAt: m.collectedAt, mds, products, edits: st.edits || {}, mdTypes: st.mdTypes || {}, propTypes: st.propTypes || {}, done: st.done || {} };
      C.prodSig = prodSig(P);
      useP(P);
      setStatus('☁ 서버에서 불러옴');
      W.toast?.(`${m.storeName || m.storeCode} — 서버에 저장된 작업을 불러왔어요`);
      // 뒤에서 Global POG 페이지가 바뀌었는지 확인 (페이지 추가·삭제만)
      loadFixtures(pogId).then(({ pog, fixtures }) => {
        const now = fxIdsOf(fixtures), was = new Set(C.fxIds), isNow = new Set(now);
        const add = now.filter(x => !was.has(x)).length, del = C.fxIds.filter(x => !isNow.has(x)).length;
        if (!add && !del) return;
        C.latest = { pog, fixtures };
        const b = bar(`🔔 Global POG 페이지가 바뀌었어요 (${[add ? '추가 ' + add + '장' : '', del ? '삭제 ' + del + '장' : ''].filter(Boolean).join(' · ')}) <button id="cb-load">새로 불러오기</button><button id="cb-later" class="ghost">나중에</button>`, 'warn');
        b.querySelector('#cb-load').onclick = () => reload();
        b.querySelector('#cb-later').onclick = () => bar('');
      }).catch(e => console.warn(e));
    } else {
      const { pog, fixtures } = await loadFixtures(pogId);
      await firstLoad(pog, fixtures);
    }
  } catch (e) {
    setStatus('⚠️ 서버에서 못 불러옴');
    alert('서버에서 불러오지 못했어요: ' + (e.code || e.message) + (e.code === 'permission-denied' ? '\n\n관리자·글로벌사업부 계정만 쓸 수 있어요. (보안 규칙이 게시됐는지도 확인해 주세요)' : ''));
  }
}
async function firstLoad(pog, fixtures) {
  const payload = buildPayload(pog, fixtures);
  if (!payload.mds.length) { alert('이 POG에는 계산기로 가져올 매대가 없어요.'); return; }
  C.storeCode = payload.store.code; C.fxIds = fxIdsOf(fixtures);
  C.loading = true; try { W.ingest(payload, '📥 '); } finally { C.loading = false; }
  await saveAll(W.P, C.fxIds, C.meta);
  setStatus('☁ 서버에 저장됨');
}
async function reload() {
  if (!C.latest) return;
  bar('<span>새로 불러오는 중…</span>', 'warn');
  try {
    const { pog, fixtures } = C.latest;
    const payload = buildPayload(pog, fixtures);
    C.fxIds = fxIdsOf(fixtures);
    C.loading = true; try { W.ingest(payload, '📥 새 POG · '); } finally { C.loading = false; } // 고친 값(수량·종류·완료)은 같은 매대·상품이면 그대로
    await saveAll(W.P, C.fxIds, C.meta);
    bar(''); C.latest = null;
  } catch (e) { bar(''); alert('새로 불러오지 못했어요: ' + (e.code || e.message)); }
}

/* ---------- 매장 고르기 (가져오기 창에 'Global POG 매장' 목록) ---------- */
async function listPogs() {
  const box = $('cloud-list'); if (!box) return;
  box.innerHTML = '<div class="muted">불러오는 중…</div>';
  try {
    const [ps, cs] = await Promise.all([getDocs(collection(db, 'pogs')), getDocs(collection(db, 'calc'))]);
    const saved = new Map(cs.docs.map(d => [d.id, d.data()]));
    const rows = ps.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    box.innerHTML = rows.length ? rows.map(p => {
      const c = saved.get(p.id), at = c?.updatedAt?.toDate?.();
      return `<div class="saved-row"><div class="nm"><b>${W.esc(p.branchName || p.storeName || p.storeCode || '')}</b> <span class="muted">${W.esc(p.storeCode || '')}${p.status === 'final' ? ' · 최종' : ' · 작성 중'}${c ? ' · ☁ 저장됨 ' + (at ? at.toLocaleDateString('ko-KR') : '') : ''}</span></div><button class="sbtn${c ? '' : ' gray'}" data-cloud="${p.id}">${c ? '열기' : '새로 만들기'}</button></div>`;
    }).join('') : '<div class="muted">Global POG에 POG가 없어요.</div>';
  } catch (e) { box.innerHTML = '<div class="muted">목록을 불러오지 못했어요: ' + W.esc(e.code || e.message) + '</div>'; }
}
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-cloud]'); if (!b) return;
  W.closeModal?.('m-setup'); openCloud(b.getAttribute('data-cloud'));
});
// 가져오기 창을 열 때마다 목록 새로
const _openSetup = W.openSetup;
W.openSetup = function (locked) {
  _openSetup(locked);
  if (!C.ok) return;
  let sec = $('cloud-sec');
  if (!sec) {
    sec = document.createElement('div'); sec.id = 'cloud-sec'; sec.className = 'cloud-sec';
    sec.innerHTML = '<div class="shdr">☁ Global POG 매장 (서버에 저장 · 다른 사람도 같이 봐요)</div><div id="cloud-list"></div>';
    const mb = document.querySelector('#m-setup .mb'); mb.insertBefore(sec, mb.firstChild);
  }
  listPogs();
};
if ($('btn-setup')) $('btn-setup').onclick = () => W.openSetup(!W.P);

/* ---------- 시작 ---------- */
onAuthStateChanged(auth, async user => {
  C.user = user; C.ok = false;
  if (!user) { bar(`Global Opening Prep에 로그인하면 작업이 서버에 저장되고 다른 사람과 같이 볼 수 있어요. <a href="${GLOBAL_URL}" target="_blank">로그인하러 가기</a>`, 'info'); return; }
  let level = 'none';
  try { const r = await getDoc(doc(db, 'roles', me())); level = r.exists() ? r.data().level : 'none'; } catch (e) { }
  if (!['admin', 'global', 'editor'].includes(level)) { bar('이 계정은 계산기 서버 저장을 쓸 수 없어요 (관리자·글로벌사업부만). 이 컴퓨터에만 저장돼요.', 'info'); return; }
  C.ok = true; bar('');
  // 같이 쓰는 설정값
  try {
    const s = await getDoc(doc(db, 'calcSettings', 'shared'));
    if (s.exists()) {
      const v = JSON.parse(s.data().json || '{}');
      if (v && v.depth) { Object.assign(W.SET, v, { depth: Object.assign({}, W.SET.depth, v.depth) }); try { localStorage.setItem('pogfl:settings', JSON.stringify(W.SET)); } catch (e) { } W.rebuildTypes?.(); if (W.P) W.renderAll?.(); }
    }
  } catch (e) { console.warn(e); }
  const want = new URL(location.href).searchParams.get('pog') || (() => { try { return localStorage.getItem('pogfl:cloudLast'); } catch (e) { return null; } })();
  if (want) openCloud(want);
  else W.openSetup(!W.P);
});
