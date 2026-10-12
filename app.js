const DAYS = 30;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const PAIRS = ["XAUUSD","EURUSD","GBPUSD","USDJPY","US30","NAS100","GBPJPY","AUDUSD","USDCAD","BTCUSD","ETHUSD","US500"];

let USER = null;
let state = { active: null, cycles: {} };
let pendingImage = null;
let saveTimer = null;
let pushTimer = null;

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
}

function iso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function parseISO(s) {
  return new Date(s + "T00:00:00");
}

function addDays(startISO, n) {
  const d = parseISO(startISO);
  d.setDate(d.getDate() + n);
  return iso(d);
}

function dates30(startISO) {
  return Array.from({ length: DAYS }, (_, i) => addDays(startISO, i));
}

function fmtDate(s) {
  const d = parseISO(s);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function fmtLong(s) {
  return parseISO(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function dayName(s) {
  return parseISO(s).toLocaleDateString("en-US", { weekday: "short" });
}

function money(n) {
  const v = Math.abs(n);
  return (n < 0 ? "-$" : "$") + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function blankTrade(date) {
  return { id: uid(), date, pair: "", side: "", rr: "", outcome: "", profit: "", loss: "", lot: "", login: "" };
}

function newCycle(startDate) {
  const trades = dates30(startDate).map(blankTrade);
  return { id: uid(), startDate, createdAt: Date.now(), trades };
}

function normalize(cycle) {
  dates30(cycle.startDate).forEach((d) => {
    if (!cycle.trades.some((t) => t.date === d)) cycle.trades.push(blankTrade(d));
  });
  cycle.trades = cycle.trades.filter((t) => dates30(cycle.startDate).includes(t.date));
}

function isFilled(t) {
  return !!(t.pair || t.outcome || t.profit || t.loss || t.lot || t.side || t.rr);
}

function filledCount(c) {
  return (c.trades || []).filter(isFilled).length;
}

function dedupeCycles(st) {
  if (!st || !st.cycles) return st;
  const byDate = {};
  Object.values(st.cycles).forEach((c) => {
    if (!c || !c.startDate) return;
    if (!byDate[c.startDate]) {
      byDate[c.startDate] = c;
      return;
    }
    const a = byDate[c.startDate];
    byDate[c.startDate] = filledCount(c) > filledCount(a) ? c : a;
  });
  const cycles = {};
  Object.values(byDate).forEach((c) => (cycles[c.id] = c));
  st.cycles = cycles;
  if (!st.cycles[st.active]) st.active = Object.keys(cycles)[0] || null;
  return st;
}

function loadState(user) {
  try {
    const raw = localStorage.getItem(dataKey(user));
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.cycles) {
        Object.values(s.cycles).forEach(normalize);
        return dedupeCycles(s);
      }
    }
  } catch (e) { console.warn("load failed", e); }
  const start = iso(new Date());
  const c = newCycle(start);
  return { active: c.id, cycles: { [c.id]: c } };
}

function persist() {
  if (!USER) return;
  try {
    localStorage.setItem(dataKey(USER), JSON.stringify(state));
  } catch (e) {
    flashSave("Storage full — export a backup", true);
    return;
  }
  flashSave("Saving...");
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushState, 700);
}

async function pushState() {
  try {
    await api("/api/data", { state }, "PUT");
    flashSave("Saved to server");
  } catch (e) {
    flashSave("Server par save nahi hua — local copy safe hai", true);
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 350);
}

function flashSave(text, warn) {
  const el = $("#saveState");
  el.textContent = text;
  el.style.color = warn ? "#ff8a8a" : "";
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2400);
}

function activeCycle() {
  let c = state.cycles[state.active];
  if (!c) {
    const first = Object.values(state.cycles)[0];
    state.active = first.id;
    c = first;
  }
  return c;
}

async function compress(file) {
  try {
    const bmp = await createImageBitmap(file);
    const max = 1600;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    return canvas.toDataURL("image/jpeg", 0.78);
  } catch (e) {
    return await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(file);
    });
  }
}

function renderCyclePicker() {
  const sel = $("#cycleSelect");
  const list = Object.values(state.cycles).sort((a, b) => b.startDate.localeCompare(a.startDate));
  sel.innerHTML = list
    .map((c) => `<option value="${c.id}" ${c.id === state.active ? "selected" : ""}>${esc(fmtLong(c.startDate))}</option>`)
    .join("");
}

function renderHead(cycle) {
  const dates = dates30(cycle.startDate);
  $("#cycleTitle").textContent = "30 Day List — " + fmtLong(cycle.startDate);
  $("#cycleRange").textContent = fmtLong(dates[0]) + "  →  " + fmtLong(dates[dates.length - 1]);
}

function nums(t) {
  return {
    profit: parseFloat(t.profit) || 0,
    loss: parseFloat(t.loss) || 0,
    lot: parseFloat(t.lot) || 0,
  };
}

function renderStats(cycle) {
  let profit = 0, loss = 0, wins = 0, losses = 0, trades = 0, lotSum = 0, lotCount = 0;
  const activeDays = new Set();

  cycle.trades.forEach((t) => {
    const n = nums(t);
    const logged = t.pair || t.outcome || t.side || t.rr || t.profit || t.loss || t.lot;
    if (logged) { trades++; activeDays.add(t.date); }
    profit += n.profit;
    loss += n.loss;
    if (n.lot > 0) { lotSum += n.lot; lotCount++; }
    if (t.outcome === "Win") wins++;
    if (t.outcome === "Loss") losses++;
  });

  const net = profit - loss;
  const decided = wins + losses;
  const rate = decided ? Math.round((wins / decided) * 100) : 0;
  const netEl = $("#statNet");
  netEl.textContent = money(net);
  netEl.className = "stat-value " + (net > 0 ? "up" : net < 0 ? "down" : "");

  $("#statProfit").textContent = money(profit);
  $("#statLoss").textContent = money(loss);
  $("#statWins").textContent = wins + " wins";
  $("#statLosses").textContent = losses + " losses";
  $("#statWinRate").textContent = rate + "%";
  $("#statTrades").textContent = trades + " trades logged";
  $("#statLot").textContent = lotCount ? (lotSum / lotCount).toFixed(2) : "0.00";
  $("#statDays").textContent = activeDays.size + " days active";

  const start = parseISO(cycle.startDate);
  const today = parseISO(iso(new Date()));
  let dayNo = Math.floor((today - start) / 86400000) + 1;
  if (dayNo < 1) dayNo = 0;
  if (dayNo > DAYS) dayNo = DAYS;
  $("#statProgress").textContent = "Day " + dayNo + " / " + DAYS;
}

function outcomeClass(o) {
  return o === "Win" ? "row-win" : o === "Loss" ? "row-loss" : o === "Break Even" ? "row-be" : "";
}

function rowHTML(t, date, index, total, isToday) {
  const opts = ["", "Win", "Loss", "Break Even", "Pending"]
    .map((o) => `<option value="${o}" ${t.outcome === o ? "selected" : ""}>${o || "Select"}</option>`)
    .join("");
  const sides = ["", "Buy", "Sell"]
    .map((s) => `<option value="${s}" ${t.side === s ? "selected" : ""}>${s || "— —"}</option>`)
    .join("");

  const lotVal = t.lot === "" ? "" : esc(t.lot);

  return `
  <tr class="${outcomeClass(t.outcome)} ${isToday ? "is-today" : ""}" data-row="${t.id}" data-date="${date}">
    <td class="cell-num">${index + 1}</td>
    <td class="cell-date">${fmtDate(date)}<small>${parseISO(date).getFullYear()}</small></td>
    <td>
      <div class="cell-day">
        <span class="day-name">${dayName(date)}</span>
        <span class="day-badge">D${index + 1}</span>
        ${total === 1 ? `<button class="add-trade" data-act="add" data-date="${date}" title="Add trade for this day">+</button>` : ""}
      </div>
    </td>
    <td>
      <input class="field" list="pairList" data-k="pair" data-id="${t.id}" value="${esc(t.pair)}" placeholder="XAUUSD" />
    </td>
    <td>
      <select class="field" data-k="side" data-id="${t.id}">${sides}</select>
    </td>
    <td>
      <input class="field mono" data-k="rr" data-id="${t.id}" value="${esc(t.rr)}" placeholder="1 : 2" />
    </td>
    <td>
      <select class="field" data-k="outcome" data-id="${t.id}" data-live="1">${opts}</select>
    </td>
    <td>
      <input class="field mono ${t.profit ? "money-up" : ""}" type="number" step="0.01" data-k="profit" data-id="${t.id}" value="${esc(t.profit)}" placeholder="0.00" />
    </td>
    <td>
      <input class="field mono ${t.loss ? "money-down" : ""}" type="number" step="0.01" data-k="loss" data-id="${t.id}" value="${esc(t.loss)}" placeholder="0.00" />
    </td>
    <td>
      <div class="lot-box">
        <input class="field" type="number" step="0.01" min="0" data-k="lot" data-id="${t.id}" value="${lotVal}" placeholder="0.00" />
      </div>
    </td>
    <td>${imgBtnHTML(t, "before")}</td>
    <td>${imgBtnHTML(t, "after")}</td>
    <td>${total > 1 ? `<button class="row-del" data-act="del" data-id="${t.id}" title="Delete trade">&times;</button>` : ""}</td>
  </tr>`;
}

function imgBtnHTML(t, slot) {
  const key = USER + "|" + t.id + "|" + slot;
  const label = slot === "before" ? "BEFORE" : "AFTER";
  return `
  <button class="img-btn" data-act="pick" data-key="${key}" data-slot="${slot}" data-id="${t.id}" title="Upload ${label.toLowerCase()} screenshot">
    <span>+ ${label}</span>
    <span class="rm" data-act="rm" data-key="${key}">&times;</span>
  </button>`;
}

async function hydrateImages() {
  const btns = $$(".img-btn");
  const keys = btns.map((b) => b.dataset.key);
  let map = {};
  try { map = await imgGetMany(keys); } catch (e) {}
  for (const btn of btns) {
    const src = map[btn.dataset.key];
    if (!src) continue;
    if (!document.body.contains(btn)) continue;
    btn.innerHTML = `<img src="${src}" alt="" /><span class="rm" data-act="rm" data-key="${btn.dataset.key}">&times;</span>`;
    btn.classList.add("has-img");
  }
}

function renderTable() {
  const cycle = activeCycle();
  const dates = dates30(cycle.startDate);
  const today = iso(new Date());
  const groups = {};
  cycle.trades.forEach((t) => (groups[t.date] = groups[t.date] || []).push(t));

  let html = "";
  dates.forEach((d, i) => {
    const list = groups[d] || [];
    if (!list.length) list.push(blankTrade(d));
    list.forEach((t, idx) => (html += rowHTML(t, d, i, list.length, d === today)));
  });
  $("#journalBody").innerHTML = html;
  hydrateImages();
}

function renderAll() {
  const cycle = activeCycle();
  renderCyclePicker();
  renderHead(cycle);
  renderStats(cycle);
  renderTable();
}

function findTrade(id) {
  for (const c of Object.values(state.cycles)) {
    const t = c.trades.find((x) => x.id === id);
    if (t) return t;
  }
  return null;
}

function updateRowLook(id) {
  const t = findTrade(id);
  const tr = $(`tr[data-row="${id}"]`);
  if (!t || !tr) return;
  tr.className = tr.className.replace(/row-(win|loss|be)/g, "").trim() + " " + outcomeClass(t.outcome);
  if (iso(new Date()) === t.date) tr.classList.add("is-today");
  const p = tr.querySelector('[data-k="profit"]');
  const l = tr.querySelector('[data-k="loss"]');
  p.classList.toggle("money-up", !!p.value);
  l.classList.toggle("money-down", !!l.value);
}

function bindTable() {
  const body = $("#journalBody");

  body.addEventListener("input", (e) => {
    const el = e.target.closest("[data-k]");
    if (!el) return;
    const t = findTrade(el.dataset.id);
    if (!t) return;
    t[el.dataset.k] = el.value;
    save();
    renderStats(activeCycle());
  });

  body.addEventListener("change", (e) => {
    const el = e.target.closest("[data-k]");
    if (!el) return;
    const t = findTrade(el.dataset.id);
    if (!t) return;
    t[el.dataset.k] = el.value;
    save();
    renderStats(activeCycle());
    if (el.dataset.k === "outcome") updateRowLook(t.id);
  });

  body.addEventListener("click", async (e) => {
    const rm = e.target.closest('[data-act="rm"]');
    if (rm) {
      e.stopPropagation();
      try { await imgDel(rm.dataset.key); } catch (err) {}
      const btn = rm.closest(".img-btn");
      btn.classList.remove("has-img");
      btn.innerHTML = `<span>+ ${btn.dataset.slot === "before" ? "BEFORE" : "AFTER"}</span><span class="rm" data-act="rm" data-key="${btn.dataset.key}">&times;</span>`;
      toast("Image removed");
      return;
    }

    const pick = e.target.closest('[data-act="pick"]');
    if (pick) {
      const src = await imgGet(pick.dataset.key).catch(() => null);
      if (src) {
        openLightbox(pick.dataset.key, (pick.dataset.slot === "before" ? "Before" : "After") + " — " + fmtDate(pick.closest("tr").dataset.date));
      } else {
        pendingImage = { key: pick.dataset.key, btn: pick };
        $("#imgPicker").click();
      }
      return;
    }

    const add = e.target.closest('[data-act="add"]');
    if (add) {
      const cycle = activeCycle();
      const date = add.dataset.date;
      const lastIdx = cycle.trades.map((t) => t.date).lastIndexOf(date);
      cycle.trades.splice(lastIdx + 1, 0, blankTrade(date));
      persist();
      renderTable();
      renderStats(cycle);
      return;
    }

    const del = e.target.closest('[data-act="del"]');
    if (del) {
      const cycle = activeCycle();
      const id = del.dataset.id;
      cycle.trades = cycle.trades.filter((t) => t.id !== id);
      imgDel(USER + "|" + id + "|before").catch(() => {});
      imgDel(USER + "|" + id + "|after").catch(() => {});
      normalize(cycle);
      persist();
      renderTable();
      renderStats(cycle);
      toast("Trade removed");
    }
  });
}

let lightboxKey = null;

function openLightbox(key, title) {
  lightboxKey = key;
  $("#lbTitle").textContent = title;
  $("#lbImage").src = "";
  $("#lightbox").hidden = false;
  imgGet(key).then((src) => { if (src) $("#lbImage").src = src; }).catch(() => {});
}

function closeLightbox() {
  $("#lightbox").hidden = true;
  lightboxKey = null;
}

function closeHistory() {
  $("#historyModal").hidden = true;
}

async function clearCycle(refreshHistory) {
  const cycle = activeCycle();
  const ok = confirm("Is cycle ka sara data history se clear karein?\n(Jab tak aap khud clear na karein, data delete nahi hoga)");
  if (!ok) return;
  await imgDeleteTrades(cycle.trades.map((t) => t.id), USER + "|");
  cycle.trades = dates30(cycle.startDate).map(blankTrade);
  persist();
  clearTimeout(pushTimer);
  await pushState();
  renderAll();
  toast("Cycle data history se clear ho gaya");
  if (refreshHistory) await openHistory();
}

async function openHistory() {
  const modal = $("#historyModal");
  modal.hidden = false;
  $("#hStats").innerHTML = '<div class="h-stat"><span>Loading</span><b>...</b></div>';

  const cycle = activeCycle();
  const dates = dates30(cycle.startDate);
  $("#hTitle").textContent = "30-Day History — " + fmtLong(cycle.startDate);
  $("#hRange").textContent = fmtLong(dates[0]) + "  →  " + fmtLong(dates[dates.length - 1]);

  const groups = {};
  cycle.trades.forEach((t) => (groups[t.date] = groups[t.date] || []).push(t));

  let trades = 0, wins = 0, losses = 0, profit = 0, loss = 0, lotSum = 0, lotN = 0;
  const dayNets = {};
  dates.forEach((d) => {
    let dnet = 0;
    (groups[d] || []).forEach((t) => {
      const p = parseFloat(t.profit) || 0;
      const l = parseFloat(t.loss) || 0;
      const lot = parseFloat(t.lot) || 0;
      if (isFilled(t)) {
        trades++;
        if (t.outcome === "Win") wins++;
        if (t.outcome === "Loss") losses++;
      }
      if (lot > 0) { lotSum += lot; lotN++; }
      profit += p;
      loss += l;
      dnet += p - l;
    });
    dayNets[d] = dnet;
  });

  const net = profit - loss;
  const decided = wins + losses;
  const rate = decided ? Math.round((wins / decided) * 100) : 0;
  const activeDays = dates.filter((d) => (groups[d] || []).some(isFilled)).length;

  $("#hStats").innerHTML = [
    ["Net P/L", money(net), net > 0 ? "up" : net < 0 ? "down" : ""],
    ["Wins / Losses", wins + " / " + losses, ""],
    ["Win Rate", rate + "%", ""],
    ["Trades / Days", trades + " / " + activeDays, ""],
    ["Avg Lot", lotN ? (lotSum / lotN).toFixed(2) : "0.00", "gold"],
  ].map(([l, v, c]) => `<div class="h-stat"><span>${l}</span><b class="${c}">${v}</b></div>`).join("");

  const withPl = dates.filter((d) => dayNets[d] !== 0);
  const maxAbs = Math.max(1, ...withPl.map((d) => Math.abs(dayNets[d])));
  $("#hBars").innerHTML = withPl.length
    ? withPl.map((d) => {
        const v = dayNets[d];
        const w = Math.max(5, Math.round((Math.abs(v) / maxAbs) * 100));
        const c = v > 0 ? "up" : "down";
        return `<div class="h-bar"><span class="lbl">${fmtDate(d)}</span><span class="track"><span class="fill ${c}" style="width:${w}%"></span></span><span class="val ${c}">${money(v)}</span></div>`;
      }).join("")
    : '<div class="h-bar"><span class="lbl">—</span><span class="track"></span><span class="val">Abhi koi P/L nahi</span></div>';

  let imgMap = {};
  const keys = [];
  dates.forEach((d) => (groups[d] || []).forEach((t) => keys.push(USER + "|" + t.id + "|before", USER + "|" + t.id + "|after")));
  try { imgMap = await imgGetMany(keys); } catch (e) {}

  let html = '<table class="h-table"><tr><th>Day</th><th>Date</th><th>Trades</th><th>Outcome</th><th style="text-align:right">P/L</th><th>Lot</th><th>Images</th></tr>';
  dates.forEach((d, i) => {
    const list = (groups[d] || []).filter(isFilled);
    if (!list.length) {
      html += `<tr class="dim"><td class="h-day">D${i + 1}</td><td class="h-date">${fmtDate(d)}<small>${dayName(d)}</small></td><td colspan="5">No trade</td></tr>`;
      return;
    }
    const pairs = list.map((t) => t.pair).filter(Boolean);
    const outcomes = list.map((t) => t.outcome).filter(Boolean);
    const pl = list.reduce((s, t) => s + (parseFloat(t.profit) || 0) - (parseFloat(t.loss) || 0), 0);
    const lots = list.map((t) => parseFloat(t.lot)).filter((v) => v > 0);
    const imgCount = list.reduce((s, t) => s + (imgMap[USER + "|" + t.id + "|before"] ? 1 : 0) + (imgMap[USER + "|" + t.id + "|after"] ? 1 : 0), 0);
    html += `<tr>
      <td class="h-day">D${i + 1}</td>
      <td class="h-date">${fmtDate(d)}<small>${dayName(d)}</small></td>
      <td>${pairs.length ? pairs.map((p) => `<span class="h-pair">${esc(p)}</span>`).join("") : '<span class="h-pair">trade</span>'}<span style="color:#5f7085;font-size:11px"> (${list.length})</span></td>
      <td>${outcomes.map((o) => `<span class="h-out ${String(o).replace(/\s/g, "")}">${esc(o)}</span>`).join(" ") || '<span class="h-out Pending">pending</span>'}</td>
      <td class="h-pl ${pl > 0 ? "up" : pl < 0 ? "down" : ""}">${money(pl)}</td>
      <td style="font-family:'JetBrains Mono',monospace">${lots.length ? lots.map((l) => l.toFixed(2)).join(", ") : "—"}</td>
      <td class="h-img">${imgCount ? "📷 " + imgCount : "—"}</td>
    </tr>`;
  });
  html += "</table>";
  $("#hList").innerHTML = html;
}

function bindChrome() {
  $("#userName").textContent = "@" + USER;
  $("#userAvatar").textContent = USER.charAt(0).toUpperCase();
  $("#btnLogout").addEventListener("click", async () => {
    clearTimeout(pushTimer);
    try { await pushState(); } catch (e) {}
    await apiLogout();
    location.href = "login.html";
  });

  const datalist = document.createElement("datalist");
  datalist.id = "pairList";
  datalist.innerHTML = PAIRS.map((p) => `<option value="${p}">`).join("");
  document.body.appendChild(datalist);

  $("#cycleSelect").addEventListener("change", (e) => {
    state.active = e.target.value;
    persist();
    renderAll();
  });

  $("#btnNewCycle").addEventListener("click", () => {
    const def = iso(new Date());
    const input = prompt("Cycle start date (YYYY-MM-DD):", def);
    if (input === null) return;
    const start = /^\d{4}-\d{2}-\d{2}$/.test(input.trim()) && !isNaN(parseISO(input.trim())) ? input.trim() : def;
    const existing = Object.values(state.cycles).find((c) => c.startDate === start);
    if (existing) {
      state.active = existing.id;
      persist();
      renderAll();
      toast("Is date ki cycle pehle se hai — wahi khul gayi");
      return;
    }
    const c = newCycle(start);
    state.cycles[c.id] = c;
    state.active = c.id;
    persist();
    renderAll();
    toast("New 30-day cycle started");
  });

  $("#imgPicker").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || !pendingImage) return;
    const { key, btn } = pendingImage;
    pendingImage = null;
    toast("Uploading image...");
    try {
      const data = await compress(file);
      const remote = await imgPut(key, data);
      if (document.body.contains(btn)) {
        btn.innerHTML = `<img src="${data}" alt="" /><span class="rm" data-act="rm" data-key="${key}">&times;</span>`;
        btn.classList.add("has-img");
      }
      if (lightboxKey === key && !$("#lightbox").hidden) $("#lbImage").src = data;
      toast(remote ? "Image saved to MongoDB" : "Image saved locally (server unreachable)");
    } catch (err) {
      toast("Upload failed: " + (err && err.message));
    }
  });

  $("#btnPrint").addEventListener("click", () => window.print());

  $("#btnHistory").addEventListener("click", () => openHistory());
  $("#hClose").addEventListener("click", closeHistory);
  $("#historyModal").addEventListener("click", (e) => { if (e.target.id === "historyModal") closeHistory(); });

  $("#btnClear").addEventListener("click", () => clearCycle(false));
  $("#hClear").addEventListener("click", () => clearCycle(true));

  $("#lbClose").addEventListener("click", closeLightbox);
  $("#lbReplace").addEventListener("click", () => {
    if (!lightboxKey) return;
    pendingImage = { key: lightboxKey, btn: $(`.img-btn[data-key="${lightboxKey}"]`) };
    $("#imgPicker").click();
  });
  $("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeLightbox(); closeHistory(); } });

  $("#lbDelete").addEventListener("click", async () => {
    if (!lightboxKey) return;
    try { await imgDel(lightboxKey); } catch (e) {}
    const btn = $(`.img-btn[data-key="${lightboxKey}"]`);
    if (btn) {
      btn.classList.remove("has-img");
      btn.innerHTML = `<span>+ ${btn.dataset.slot === "before" ? "BEFORE" : "AFTER"}</span><span class="rm" data-act="rm" data-key="${btn.dataset.key}">&times;</span>`;
    }
    closeLightbox();
    toast("Image deleted");
  });

  window.addEventListener("beforeunload", () => {
    clearTimeout(saveTimer);
    clearTimeout(pushTimer);
    if (!USER) return;
    try { localStorage.setItem(dataKey(USER), JSON.stringify(state)); } catch (e) {}
    try {
      const blob = new Blob([JSON.stringify({ state })], { type: "application/json" });
      navigator.sendBeacon("/api/data", blob);
    } catch (e) {}
  });
}

async function boot() {
  try {
  const me = await apiMe();
  USER = me.username;
  if (me.role === "admin") {
    const b = $("#btnAdmin");
    if (b) b.hidden = false;
  }
  } catch (e) {
    location.replace("login.html");
    return;
  }

  let serverState = null;
  try {
    serverState = (await api("/api/data", undefined, "GET")).state;
  } catch (e) {}

  if (serverState && serverState.cycles) {
    state = serverState;
    Object.values(state.cycles).forEach(normalize);
    dedupeCycles(state);
    try { localStorage.setItem(dataKey(USER), JSON.stringify(state)); } catch (e) {}
  } else {
    state = loadState(USER);
    try { await api("/api/data", { state }, "PUT"); } catch (e) {}
  }

  bindChrome();
  bindTable();
  renderAll();

  if (new URLSearchParams(location.search).has("history")) openHistory().catch(() => {});

  claimLegacyData(USER).then(() => hydrateImages()).catch(() => {});
}

boot();
