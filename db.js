async function run() {
  let data;
  try {
    const r = await fetch("/api/db/summary", { credentials: "same-origin" });
    if (!r.ok) throw new Error("status " + r.status);
    data = await r.json();
  } catch (e) {
    document.getElementById("connInfo").textContent = "session expired";
    document.getElementById("cards").innerHTML = '<div class="panel" style="grid-column:1/-1">Not logged in ya admin access chahiye — <a class="back" href="login.html">Login</a></div>';
    return;
  }

  document.getElementById("connInfo").textContent = data.db + " @ " + data.host + (data.port && data.port !== "-" ? ":" + data.port : "");

  document.getElementById("cards").innerHTML = [
    ["Users", data.counts.users],
    ["Journal Docs", data.counts.docs],
    ["Images", data.counts.imgs],
    ["Last Saved", data.savedAt ? new Date(data.savedAt).toLocaleString("en-GB") : "—"],
  ]
    .map(
      ([l, v]) =>
        '<div class="panel" style="margin:0">' +
        '<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8797a9;font-weight:700">' + l + "</div>" +
        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:22px;font-weight:800;margin-top:8px">' + v + "</div>" +
        "</div>"
    )
    .join("");

  document.getElementById("usersBox").innerHTML = data.users.length
    ? '<table class="dbtable"><tr><th>#</th><th>Username</th><th>Password</th><th>Created</th></tr>' +
      data.users
        .map(
          (u, i) =>
            "<tr><td>" + (i + 1) + "</td><td>" + u.username + (u.username === data.me ? " <span class='tag'>you</span>" : "") + "</td>" +
            "<td>" + (u.username === data.me ? "<button class='pwbtn'>Show Password</button>" : "<span style='color:#5f7085'>—</span>") + "</td>" +
            "<td>" + (u.createdAt ? new Date(u.createdAt).toLocaleString("en-GB") : "-") + "</td></tr>"
        )
        .join("") +
      "</table>"
    : "<div class='empty'>Koi user nahi — pehle Register karein</div>";

  const st = data.state;
  if (!st || !st.cycles) {
    document.getElementById("myBox").innerHTML = "<div class='empty'>Abhi tak koi journal data save nahi hua</div>";
  } else {
    let rows = "";
    let total = 0;
    Object.values(st.cycles).forEach((c) => {
      (c.trades || []).forEach((t) => {
        if (!(t.pair || t.outcome || t.profit || t.loss || t.lot)) return;
        total++;
        rows += "<tr><td>" + (t.date || "-") + "</td><td>" + (t.pair || "-") + "</td><td>" + (t.side || "-") + "</td><td>" + (t.outcome || "-") + "</td><td>" + (t.profit || "0") + "</td><td>" + (t.loss || "0") + "</td><td>" + (t.lot || "-") + "</td></tr>";
      });
    });
    document.getElementById("myBox").innerHTML =
      '<div style="margin-bottom:10px"><span class="tag">' + Object.keys(st.cycles).length + ' cycles</span><span class="tag">' + total + " trades</span></div>" +
      (rows ? '<table class="dbtable"><tr><th>Date</th><th>Pair</th><th>Side</th><th>Outcome</th><th>Profit</th><th>Loss</th><th>Lot</th></tr>' + rows + "</table>" : "<div class='empty'>Entries khali hain</div>");
  }

  document.getElementById("imgBox").innerHTML = data.images.length
    ? '<table class="dbtable"><tr><th>Key</th><th>Saved At</th></tr>' +
      data.images
        .map((i) => "<tr><td>" + i.key + "</td><td>" + (i.updatedAt ? new Date(i.updatedAt).toLocaleString("en-GB") : "-") + "</td></tr>")
        .join("") +
      "</table>"
    : "<div class='empty'>Koi image upload nahi hui</div>";
}

document.getElementById("usersBox").addEventListener("click", async (e) => {
  const btn = e.target.closest(".pwbtn");
  if (!btn) return;
  try {
    const r = await fetch("/api/account/recovery", { credentials: "same-origin" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { btn.textContent = d.error || "fail"; btn.disabled = true; return; }
    const span = document.createElement("span");
    span.className = "tag";
    span.style.cssText = "background:rgba(34,197,94,.15);color:#4ade80;border-color:rgba(34,197,94,.35)";
    span.textContent = d.password;
    btn.replaceWith(span);
  } catch (ex) { btn.textContent = "error"; btn.disabled = true; }
});

if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {}));
}

run();
