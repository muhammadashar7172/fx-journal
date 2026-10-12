function $(s, r = document) { return (r || document).querySelector(s); }
function $$(s, r = document) { return Array.from((r || document).querySelectorAll(s)); }

const tabs = $$(".tab");

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

apiMe().then(() => location.replace("index.html")).catch(() => {});

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#loginError");
  clearErr(err);
  const btn = e.target.querySelector(".f-submit");
  btn.classList.add("f-loading");
  try {
    const user = await apiLogin($("#loginUser").value, $("#loginPass").value);
    await claimLegacyData(user);
    location.href = "index.html";
  } catch (ex) {
    showErr(err, ex.message || "Login fail hua");
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
    const user = await apiRegister($("#regUser").value, p);
    await claimLegacyData(user);
    location.href = "index.html";
  } catch (ex) {
    showErr(err, ex.message || "Register fail hua");
    btn.classList.remove("f-loading");
  }
});
