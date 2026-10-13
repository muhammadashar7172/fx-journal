const DATA_PREFIX = "tl_data_v1_";
const LEGACY_KEY = "tradeledger_v1";
const IMG_LS = "tl_img_";

async function api(path, body, method) {
  const res = await fetch(path, {
    method: method || "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    const err = new Error((data && data.error) || "Request failed (" + res.status + ")");
    err.http = res.status;
    err.data = data || {};
    throw err;
  }
  return data;
}

function cleanUser(u) {
  return String(u || "").trim().toLowerCase();
}

async function apiMe() {
  return api("/api/me", undefined, "GET");
}

async function apiRegister(name, email, password, contact) {
  name = String(name || "").trim();
  email = cleanUser(email);
  contact = String(contact || "").trim().replace(/[^\d+\-() ]/g, "").slice(0, 20);
  if (name.length < 2) throw new Error("Apna poora naam daalein");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error("Email sahi format me daalein");
  if (String(password).length < 6) throw new Error("Password kam se kam 6 characters ka ho");
  return api("/api/register", { name, email, password, contact });
}

async function apiLogin(u, p) {
  u = String(u || "").trim();
  if (!u || !p) throw new Error("Email/username aur password dono bharein");
  return api("/api/login", { username: u, password: p });
}

async function apiCheckStatus(u) {
  return api("/api/check-status", { username: String(u || "").trim() });
}

async function apiAdminUsers() {
  return api("/api/admin/users", undefined, "GET");
}

async function apiAdminAction(username, action) {
  return api("/api/admin/users/action", { username, action });
}

async function apiAdminSetRole(username, role) {
  return api("/api/admin/users/action", { username, action: "setrole", role });
}

async function apiAdminCred(username) {
  return api("/api/admin/user-cred?username=" + encodeURIComponent(username), undefined, "GET");
}

async function apiAdminSetPassword(username, password) {
  return api("/api/admin/user-password", { username, password });
}

async function apiLogout() {
  try { await api("/api/logout", {}); } catch (e) {}
}

function dataKey(user) {
  return DATA_PREFIX + user;
}

let dbPromise = null;

function withTimeout(p, ms) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("storage timeout")), ms || 4000);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open("tradeledger_images", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("images"); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbPut(key, value) {
  const d = await withTimeout(db());
  return withTimeout(new Promise((res, rej) => {
    const tx = d.transaction("images", "readwrite");
    tx.objectStore("images").put(value, key);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  }));
}

async function idbGet(key) {
  const d = await withTimeout(db());
  return withTimeout(new Promise((res, rej) => {
    const tx = d.transaction("images", "readonly");
    const r = tx.objectStore("images").get(key);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  }));
}

async function idbDel(key) {
  const d = await withTimeout(db());
  return withTimeout(new Promise((res, rej) => {
    const tx = d.transaction("images", "readwrite");
    tx.objectStore("images").delete(key);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  }));
}

async function idbAll() {
  const d = await withTimeout(db());
  return withTimeout(new Promise((res, rej) => {
    const tx = d.transaction("images", "readonly");
    const kReq = tx.objectStore("images").getAllKeys();
    const vReq = tx.objectStore("images").getAll();
    let keys = [], vals = [];
    kReq.onsuccess = () => { keys = kReq.result; };
    vReq.onsuccess = () => { vals = vReq.result; };
    tx.oncomplete = () => res(keys.map((k, i) => [k, vals[i]]));
    tx.onerror = () => rej(tx.error);
  }));
}

async function localImgPut(key, value) {
  try { await idbPut(key, value); } catch (e) {
    try { localStorage.setItem(IMG_LS + key, value); } catch (e2) { throw new Error("Storage full"); }
  }
}

async function localImgGet(key) {
  try {
    const v = await idbGet(key);
    if (v) return v;
  } catch (e) {}
  try { return localStorage.getItem(IMG_LS + key); } catch (e) { return null; }
}

async function localImgDel(key) {
  try { await idbDel(key); } catch (e) {}
  try { localStorage.removeItem(IMG_LS + key); } catch (e) {}
}

async function localAllImages() {
  const map = new Map();
  try {
    for (const [k, v] of await idbAll()) map.set(String(k), v);
  } catch (e) {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(IMG_LS)) map.set(k.slice(IMG_LS.length), localStorage.getItem(k));
    }
  } catch (e) {}
  return Array.from(map.entries());
}

async function imgPut(key, data) {
  try {
    await api("/api/images/save", { key, data });
    await localImgDel(key);
    return true;
  } catch (e) {
    await localImgPut(key, data);
    return false;
  }
}

async function imgGetMany(keys) {
  if (!keys.length) return {};
  try {
    const r = await api("/api/images/get", { keys });
    return r.images || {};
  } catch (e) {
    const out = {};
    for (const k of keys) {
      const v = await localImgGet(k);
      if (v) out[k] = v;
    }
    return out;
  }
}

async function imgGet(key) {
  const map = await imgGetMany([key]);
  return map[key] || null;
}

async function imgDel(key) {
  try { await api("/api/images/delete", { key }); } catch (e) {}
  await localImgDel(key);
}

async function imgDeleteTrades(ids, prefix) {
  if (!ids || !ids.length) return;
  try {
    await api("/api/images/delete-trade", { ids });
    return;
  } catch (e) {}
  const p = prefix || "";
  for (const id of ids) {
    await localImgDel(p + id + "|before");
    await localImgDel(p + id + "|after");
  }
}

async function allImages() {
  try {
    const r = await api("/api/images/all", undefined, "GET");
    return Object.entries(r.images || {});
  } catch (e) {
    return await localAllImages();
  }
}

function rekey(key, user) {
  const k = String(key);
  const i = k.indexOf("|");
  return user + "|" + (i === -1 ? k : k.slice(i + 1));
}

async function claimLegacyData(user) {
  try {
    const cur = await api("/api/data", undefined, "GET");
    let local = null;
    try { local = localStorage.getItem(dataKey(user)) || localStorage.getItem(LEGACY_KEY); } catch (e) {}
    if (!cur.state && local) {
      await api("/api/data", { state: JSON.parse(local) }, "PUT");
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch (e) {}

  try {
    const locals = await localAllImages();
    if (locals.length) {
      const server = await api("/api/images/all", undefined, "GET");
      const have = server.images || {};
      for (const [k, v] of locals) {
        const key = rekey(k, user);
        if (!have[key]) await api("/api/images/save", { key, data: v });
        await localImgDel(k);
      }
    }
  } catch (e) {}
}

if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      document.documentElement.dataset.sw = "registered";
      try {
        await navigator.serviceWorker.ready;
        document.documentElement.dataset.sw = "active";
      } catch (e) {}
      reg.addEventListener("updatefound", () => {});
    } catch (e) {
      document.documentElement.dataset.sw = "error";
    }
  });
}
