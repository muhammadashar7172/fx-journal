function $(s, r = document) { return (r || document).querySelector(s); }
function $$(s, r = document) { return Array.from((r || document).querySelectorAll(s)); }

let ME = null;
let USERS = [];
let COUNTS = { total: 0, pending: 0, approved: 0, blocked: 0, rejected: 0 };
let FILTER = "all";
let knownPending = new Set();
let firstLoad = true;

let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  t.classList.remove("show");
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-GB") + " " + dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderStats() {
  $("#cTotal").textContent = COUNTS.total;
  $("#cPending").textContent = COUNTS.pending;
  $("#cApproved").textContent = COUNTS.approved;
  $("#cBlocked").textContent = COUNTS.blocked;
  $("#cRejected").textContent = COUNTS.rejected;
  const badge = $("#bellBadge");
  badge.hidden = COUNTS.pending === 0;
  badge.textContent = COUNTS.pending;
}

function renderRows() {
  const rows = USERS.filter((u) => FILTER === "all" || u.status === FILTER);
  const tbody = $("#userRows");
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Is filter me koi user nahi</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map((u, i) => {
      const st = u.status;
      const isSelf = u.username === ME;
      const pending = st === "pending";
      const acts = [];
      acts.push('<button class="act act-cred" data-act="cred" data-u="' + esc(u.username) + '">Credentials</button>');
      if (pending) {
        acts.push('<button class="act act-approve" data-act="approve" data-u="' + esc(u.username) + '">Approve</button>');
        acts.push('<button class="act act-reject" data-act="reject" data-u="' + esc(u.username) + '">Reject</button>');
      } else if (st === "approved") {
        if (!isSelf) acts.push('<button class="act act-block" data-act="block" data-u="' + esc(u.username) + '">Block</button>');
      } else if (st === "blocked" || st === "rejected") {
        acts.push('<button class="act act-unblock" data-act="unblock" data-u="' + esc(u.username) + '">Approve</button>');
      }
      if (!isSelf) acts.push('<button class="act act-delete" data-act="delete" data-u="' + esc(u.username) + '">Delete</button>');

      return (
        '<tr class="' + (pending ? "row-pending" : "") + '">' +
        "<td>" + (i + 1) + "</td>" +
        '<td><span class="u-name">' + esc(u.fullName || u.username) + "</span>" +
        (u.fullName ? '<span class="u-sub">' + esc(u.username) + "</span>" : "") + "</td>" +
        '<td class="u-mail">' + esc(u.email || "—") + "</td>" +
        '<td class="u-mono">' + esc(u.username) + "</td>" +
        "<td>" + (u.role === "admin" ? '<span class="st st-admin">Admin</span>' : '<span class="u-mono">user</span>') + "</td>" +
        '<td><span class="st st-' + st + '">' + st + "</span></td>" +
        '<td class="u-mono">' + fmtDate(u.createdAt) + "</td>" +
        '<td><div class="acts">' + (acts.join("") || '<span class="u-sub">—</span>') + "</div></td>" +
        "</tr>"
      );
    })
    .join("");
}

async function load(announceNew) {
  try {
    const r = await apiAdminUsers();
    USERS = r.users || [];
    COUNTS = r.counts || COUNTS;
    ME = r.me || ME;
    renderStats();
    renderRows();
    $("#lastSync").textContent = "Sync " + new Date().toLocaleTimeString("en-GB");

    const pendingSet = new Set(USERS.filter((u) => u.status === "pending").map((u) => u.username));
    if (announceNew && !firstLoad) {
      let fresh = 0;
      pendingSet.forEach((p) => { if (!knownPending.has(p)) fresh++; });
      if (fresh > 0) {
        const u = USERS.find((x) => x.status === "pending" && !knownPending.has(x.username));
        toast("Naya registration: " + (u.fullName || u.username) + " — approval ka muntazir");
        const bell = $("#bell");
        bell.classList.remove("ring");
        void bell.offsetWidth;
        bell.classList.add("ring");
      }
    }
    knownPending = pendingSet;
    firstLoad = false;
  } catch (e) {
    if (e.http === 403) {
      $("#adminBody").hidden = true;
      $("#denied").hidden = false;
    } else {
      $("#userRows").innerHTML = '<tr><td colspan="8" class="empty-cell">Load fail: ' + esc(e.message) + "</td></tr>";
    }
  }
}

let confirmCb = null;

/* ---------- Credentials box ---------- */
let credUser = "";

function closeCred() {
  $("#credModal").hidden = true;
  credUser = "";
  $("#cdNewPass").value = "";
  $("#cdErr").hidden = true;
  $("#cdPass").textContent = "••••••••";
  $("#cdPass").dataset.real = "";
}

async function openCred(username) {
  credUser = username;
  $("#cdSub").textContent = "@" + username;
  $("#cdName").textContent = "Loading...";
  $("#cdUser").textContent = "—";
  $("#cdEmail").textContent = "—";
  $("#cdContact").textContent = "—";
  $("#cdPass").textContent = "Loading...";
  $("#cdNewPass").value = "";
  $("#cdErr").hidden = true;
  $("#credModal").hidden = false;
  try {
    const c = await apiAdminCred(username);
    $("#cdName").textContent = c.fullName || "—";
    $("#cdUser").textContent = c.username;
    $("#cdEmail").textContent = c.email || "—";
    $("#cdContact").textContent = c.contact || "—";
    if (c.password) {
      $("#cdPass").textContent = "••••••••";
      $("#cdPass").dataset.real = c.password;
    } else {
      $("#cdPass").textContent = "not saved — login karte hi save hoga";
      $("#cdPass").dataset.real = "";
    }
  } catch (e) {
    $("#cdName").textContent = "Fail: " + e.message;
  }
}

$("#cdClose").addEventListener("click", closeCred);
$("#credModal").addEventListener("click", (e) => { if (e.target.id === "credModal") closeCred(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#credModal").hidden) closeCred(); });

$("#cdEye").addEventListener("click", () => {
  const el = $("#cdPass");
  const real = el.dataset.real || "";
  if (!real) return;
  const hidden = el.textContent === "••••••••" || el.textContent === "";
  el.textContent = hidden ? real : "••••••••";
});

$("#cdSave").addEventListener("click", async () => {
  const err = $("#cdErr");
  err.hidden = true;
  const pass = $("#cdNewPass").value;
  if (!credUser) return;
  if (pass.length < 4) {
    err.textContent = "Password kam se kam 4 characters ka ho";
    err.hidden = false;
    return;
  }
  const btn = $("#cdSave");
  btn.classList.add("f-loading");
  try {
    await apiAdminSetPassword(credUser, pass);
    toast("Password change ho gaya: @" + credUser);
    $("#cdNewPass").value = "";
    $("#cdPass").textContent = "••••••••";
    $("#cdPass").dataset.real = pass;
    const row = USERS.find((u) => u.username === credUser);
    if (row) row.passwordChanged = true;
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.classList.remove("f-loading");
  }
});

function confirmAction(title, sub, body, cb) {
  $("#cfTitle").textContent = title;
  $("#cfSub").textContent = sub;
  $("#cfBody").innerHTML = body;
  $("#confirmModal").hidden = false;
  confirmCb = cb;
}
$("#cfCancel").addEventListener("click", () => { $("#confirmModal").hidden = true; confirmCb = null; });
$("#cfOk").addEventListener("click", async () => {
  const cb = confirmCb;
  $("#confirmModal").hidden = true;
  confirmCb = null;
  if (cb) await cb();
});
$("#confirmModal").addEventListener("click", (e) => { if (e.target.id === "confirmModal") { $("#confirmModal").hidden = true; confirmCb = null; } });

$("#userRows").addEventListener("click", async (e) => {
  const btn = e.target.closest(".act");
  if (!btn) return;
  const action = btn.dataset.act;
  const username = btn.dataset.u;

  if (action === "cred") {
    openCred(username);
    return;
  }

  if (action === "delete") {
    confirmAction(
      "Delete User",
      username,
      'Ye user <b>' + esc(username) + "</b> MongoDB se permanently delete ho jayega — account, journal data aur saari before/after images. Ye wapas nahi aayegi.",
      async () => {
        try {
          await apiAdminAction(username, "delete");
          toast("User delete ho gaya: " + username);
          load(true);
        } catch (ex) { toast("Fail: " + ex.message); }
      }
    );
    return;
  }
  try {
    await apiAdminAction(username, action);
    const label = { approve: "Approved", reject: "Rejected", block: "Blocked", unblock: "Approved" }[action] || action;
    toast(username + " → " + label);
    load(true);
  } catch (ex) {
    toast("Fail: " + ex.message);
  }
});

$$("#filters .chip").forEach((c) =>
  c.addEventListener("click", () => {
    FILTER = c.dataset.filter;
    $$("#filters .chip").forEach((x) => x.classList.toggle("active", x === c));
    renderRows();
  })
);

$("#bell").addEventListener("click", () => {
  FILTER = "pending";
  $$("#filters .chip").forEach((x) => x.classList.toggle("active", x.dataset.filter === "pending"));
  renderRows();
});

$("#btnLogout").addEventListener("click", async () => {
  await apiLogout();
  location.href = "login.html";
});

(async function boot() {
  let me;
  try {
    me = await apiMe();
  } catch (e) {
    location.replace("login.html");
    return;
  }
  if (me.role !== "admin") {
    $("#denied").hidden = false;
    return;
  }
  ME = me.username;
  $("#userName").textContent = "@" + me.username;
  $("#userAvatar").textContent = (me.fullName || me.username || "A").charAt(0).toUpperCase();
  $("#adminBody").hidden = false;
  await load(false);
  setInterval(() => load(true), 15000);
})();
