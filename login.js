function $(s, r = document) { return (r || document).querySelector(s); }
function $$(s, r = document) { return Array.from((r || document).querySelectorAll(s)); }

const tabs = $$(".tab");
let savedId = "";
let savedPass = "";

function showErr(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}

function clearErr(el) {
  el.hidden = true;
  el.textContent = "";
}

function switchTab(name) {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $("#loginForm").hidden = name !== "login";
  $("#regForm").hidden = name !== "register";
  clearErr($("#loginError"));
  clearErr($("#regError"));
}

tabs.forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

$$(".eye").forEach((b) =>
  b.addEventListener("click", () => {
    const inp = $("#" + b.dataset.eye);
    inp.type = inp.type === "password" ? "text" : "password";
  })
);

apiMe().then((me) => {
  if (me.role === "admin") location.replace("admin.html");
  else location.replace("index.html");
}).catch(() => {});

const STATUS_UI = {
  pending: { icon: "&#9203;", title: "Pending Approval", note: "Admin approve karte hi yahan wapas login kar sakte hain." },
  blocked: { icon: "&#128683;", title: "Account Blocked", note: "Details ke liye admin se rabta karein." },
  rejected: { icon: "&#10060;", title: "Account Rejected", note: "Naya account banane se pehle admin se baat karein." },
};

let toastTimer = null;
function premiumToast(title, msg, icon) {
  const t = $("#ptToast");
  $("#ptTitle").textContent = title;
  $("#ptMsg").textContent = msg;
  $("#ptIcon").innerHTML = icon || "&#9203;";
  t.hidden = false;
  t.classList.remove("show", "hide");
  void t.offsetWidth;
  t.classList.add("show");
  const bar = $("#ptBar");
  bar.style.animation = "none";
  void bar.offsetWidth;
  bar.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove("show");
    t.classList.add("hide");
    setTimeout(() => { t.hidden = true; }, 550);
  }, 5200);
}

function showStatus(status, id) {
  const view = $("#statusView");
  const ui = STATUS_UI[status] || STATUS_UI.pending;
  view.className = "status-view " + status;
  $("#stIcon").innerHTML = ui.icon;
  $("#stTitle").textContent = ui.title;
  $("#stMsg").textContent = status === "pending"
    ? "Aapka account admin approval ka muntazir hai. Aap approval se pehle login nahi kar sakte."
    : (status === "blocked"
      ? "Aapka account admin ne block kar diya hai — login band hai."
      : "Aapka account approve nahi hua hai.");
  $("#stAccount").textContent = id || "";
  $("#stNote").textContent = ui.note;
  $("#loginForm").hidden = true;
  $("#regForm").hidden = true;
  $$(".tab").forEach((t) => (t.hidden = true));
  $(".auth-tabs").hidden = true;
  view.hidden = false;
}

function backToForms() {
  $("#statusView").hidden = true;
  $(".auth-tabs").hidden = false;
  $$(".tab").forEach((t) => (t.hidden = false));
  switchTab("login");
}

$("#stBack").addEventListener("click", backToForms);

$("#stRefresh").addEventListener("click", async () => {
  const btn = $("#stRefresh");
  btn.classList.add("f-loading");
  try {
    const r = await apiCheckStatus(savedId || $("#stAccount").textContent);
    if (r.status === "approved") {
      const user = await apiLogin(savedId, savedPass);
      await claimLegacyData(user.username);
      location.href = user.role === "admin" ? "admin.html" : "index.html";
      return;
    }
    if (r.status !== "unknown") showStatus(r.status, savedId);
    else showErr($("#loginError"), "Account nahi mila");
  } catch (ex) {
    if (ex.http === 403 && ex.data && ex.data.status) showStatus(ex.data.status, savedId);
  } finally {
    btn.classList.remove("f-loading");
  }
});

let premTimer = null;
function showPremToast() {
  const t = $("#premToast");
  t.classList.remove("pt-out");
  t.hidden = false;
  void t.offsetWidth;
  const bar = t.querySelector(".pt-bar i");
  if (bar) {
    bar.style.animation = "none";
    void bar.offsetWidth;
    bar.style.animation = "";
  }
  clearTimeout(premTimer);
  premTimer = setTimeout(hidePremToast, 7000);
}
function hidePremToast() {
  const t = $("#premToast");
  if (t.hidden) return;
  clearTimeout(premTimer);
  t.classList.add("pt-out");
  setTimeout(() => { t.hidden = true; t.classList.remove("pt-out"); }, 380);
}
$("#ptClose").addEventListener("click", hidePremToast);

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#loginError");
  clearErr(err);
  const btn = e.target.querySelector(".f-submit");
  btn.classList.add("f-loading");
  savedId = $("#loginUser").value.trim();
  savedPass = $("#loginPass").value;
  try {
    const user = await apiLogin(savedId, savedPass);
    await claimLegacyData(user.username);
    location.href = user.role === "admin" ? "admin.html" : "index.html";
  } catch (ex) {
    if (ex.http === 403 && ex.data && ex.data.status) {
      showStatus(ex.data.status, savedId);
      if (ex.data.status === "pending") {
        premiumToast("Wait For Approval", "Aapka account admin approval ka muntazir hai — thoda intezar karein.", "&#9203;");
      } else {
        premiumToast(ex.data.status === "blocked" ? "Account Blocked" : "Account Rejected", ex.message, ex.data.status === "blocked" ? "&#128683;" : "&#10060;");
      }
    } else {
      showErr(err, ex.message || "Login fail hua");
    }
    btn.classList.remove("f-loading");
  }
});

$("#regForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#regError");
  clearErr(err);
  const btn = e.target.querySelector(".f-submit");
  btn.classList.add("f-loading");
  try {
    const p = $("#regPass").value;
    if (p !== $("#regPass2").value) throw new Error("Passwords match nahi kar rahe");
    const r = await apiRegister($("#regName").value, $("#regEmail").value, p);
    savedId = r.email || $("#regEmail").value.trim();
    savedPass = p;
    showPremToast();
    showStatus("pending", savedId);
    premiumToast("Wait For Approval", "Account ban gaya — admin approve karega, tab tak login nahi milegi.", "&#9203;");
  } catch (ex) {
    showErr(err, ex.message || "Register fail hua");
  } finally {
    btn.classList.remove("f-loading");
  }
});
