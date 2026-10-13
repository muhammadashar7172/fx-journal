const path = require("path");
const os = require("os");
const fs = require("fs");

try {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) return;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    });
  }
} catch (e) {}
const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;
const SECRET = process.env.JWT_SECRET || "tl_" + require("crypto").randomBytes(24).toString("hex");
const ENC_KEY = crypto.createHash("sha256").update(String(process.env.PASSWORD_ENC_KEY || SECRET) + "|fx-journal-pw").digest();
const DB_NAME = "trading_journal";
const USER_RE = /^[a-z0-9_.-]{3,20}$/i;

function encPass(pw) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const data = Buffer.concat([c.update(String(pw), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
}

function decPass(s) {
  const b = Buffer.from(String(s), "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

const app = express();
if (process.env.VERCEL) app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "40mb" }));
app.use(cookieParser());

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  if (process.env.VERCEL) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ")
  );
  next();
});

function serverErr(res, e) {
  console.error("[err]", new Date().toISOString(), (e && e.stack) || e);
  if (res.headersSent) return;
  res.status(500).json({ error: "Server error — dobara try karein" });
}

const rlStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rlStore) if (v.reset < now) rlStore.delete(k);
}, 60000).unref();

function rateLimit(max, windowMs, keyFn) {
  return (req, res, next) => {
    try {
      const k = keyFn(req);
      const now = Date.now();
      let b = rlStore.get(k);
      if (!b || b.reset < now) {
        b = { n: 0, reset: now + windowMs };
        rlStore.set(k, b);
      }
      b.n++;
      if (b.n > max) {
        const secs = Math.ceil((b.reset - now) / 1000);
        return res.status(429).json({ error: "Bohat zyada attempts — " + secs + " second baad dobara try karein" });
      }
      next();
    } catch (e) {
      next();
    }
  };
}
const ipOf = (req) => String(req.ip || (req.connection && req.connection.remoteAddress) || "?");
const rlLogin = rateLimit(10, 10 * 60 * 1000, (req) => "lg|" + ipOf(req) + "|" + String((req.body && req.body.username) || "").toLowerCase());
const rlRegister = rateLimit(5, 60 * 60 * 1000, (req) => "rg|" + ipOf(req));
const rlStatus = rateLimit(30, 10 * 60 * 1000, (req) => "cs|" + ipOf(req));

let dbPromise = null;
function ensureDb() {
  if (!dbPromise) {
    dbPromise = connectDB().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

app.use("/api", async (req, res, next) => {
  try {
    await ensureDb();
    next();
  } catch (e) {
    res.status(503).json({ error: "Database unavailable: " + e.message });
  }
});

const User = mongoose.model("User", new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  fullName: { type: String, default: "" },
  email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
  contact: { type: String, default: "" },
  passwordHash: { type: String, required: true },
  passwordEnc: { type: String, default: null },
  role: { type: String, default: "user" },
  status: { type: String, default: "pending" },
  createdAt: { type: Date, default: Date.now },
}));

const Doc = mongoose.model("Doc", new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  state: { type: mongoose.Schema.Types.Mixed, default: null },
  updatedAt: { type: Date, default: Date.now },
}));

const imgSchema = new mongoose.Schema({
  username: { type: String, required: true },
  key: { type: String, required: true },
  data: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
});
imgSchema.index({ username: 1, key: 1 }, { unique: true });
const Img = mongoose.model("Img", imgSchema);

function sign(user) {
  return jwt.sign({ username: user }, SECRET, { expiresIn: "30d" });
}

function setCookie(res, user) {
  res.cookie("tl_token", sign(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: !!process.env.VERCEL,
    maxAge: 30 * 24 * 3600 * 1000,
    path: "/",
  });
}

function auth(req, res, next) {
  const token = req.cookies && req.cookies.tl_token;
  if (!token) return res.status(401).json({ error: "Not logged in" });
  try {
    const payload = jwt.verify(token, SECRET, { algorithms: ["HS256"] });
    req.user = String(payload.username);
    next();
  } catch (e) {
    res.status(401).json({ error: "Session expired — dobara login karein" });
  }
}

app.post("/api/register", rlRegister, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const contact = String(req.body.contact || "").trim().replace(/[^\d+\-() ]/g, "").slice(0, 20);
    if (name.length < 2 || name.length > 60) return res.status(400).json({ error: "Naam 2-60 characters ka ho" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "Email sahi format me daalein" });
    if (password.length < 6) return res.status(400).json({ error: "Password kam se kam 6 characters ka ho" });

    const existsEmail = await User.findOne({ email });
    if (existsEmail) return res.status(409).json({ error: "Yeh email pehle se registered hai — Login karein" });

    let base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_.-]/g, "") || "user";
    if (base.length < 3) base = "user" + base;
    if (base.length > 20) base = base.slice(0, 20);
    let username = base;
    for (let i = 2; await User.findOne({ username }); i++) {
      username = (base.slice(0, 15) + "_" + i).slice(0, 20);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({
      username,
      fullName: name,
      email,
      contact,
      passwordHash,
      passwordEnc: encPass(password),
      role: "user",
      status: "pending",
    });
    await Doc.updateOne({ username }, { $setOnInsert: { username, state: null } });
    res.json({ username, email, status: "pending" });
  } catch (e) {
    if (e && e.code === 11000) return res.status(409).json({ error: "Yeh email ya username pehle se maujood hai" });
    serverErr(res, e);
  }
});

const STATUS_MSG = {
  pending: "Aapka account abhi admin approval ka muntazir hai",
  blocked: "Aapka account admin ne block kar diya hai",
  rejected: "Aapka account approve nahi hua — admin se rabta karein",
};

const DUMMY_HASH = bcrypt.hashSync("rr-nexus-timing-guard", 10);

app.post("/api/login", rlLogin, async (req, res) => {
  try {
    const id = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!id || !password) return res.status(400).json({ error: "Email/username aur password dono bharein" });
    const user = await User.findOne({ $or: [{ email: id }, { username: id }] });
    const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok) return res.status(401).json({ error: "Email/username ya password ghalat hai" });
    try { await User.updateOne({ username: user.username }, { $set: { passwordEnc: encPass(password) } }); } catch (e) {}
    const status = user.status || "approved";
    if (status !== "approved") {
      return res.status(403).json({ error: STATUS_MSG[status] || "Login allow nahi hai", status, username: user.username });
    }
    setCookie(res, user.username);
    res.json({ username: user.username, fullName: user.fullName || "", role: user.role || "user", status });
  } catch (e) {
    serverErr(res, e);
  }
});

app.post("/api/check-status", rlStatus, async (req, res) => {
  try {
    const id = String(req.body.username || "").trim().toLowerCase();
    if (!id) return res.json({ status: "unknown" });
    const user = await User.findOne({ $or: [{ email: id }, { username: id }] }, { username: 1, status: 1 });
    if (!user) return res.json({ status: "unknown" });
    res.json({ status: user.status || "approved" });
  } catch (e) {
    serverErr(res, e);
  }
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("tl_token", { path: "/" });
  res.json({ ok: true });
});

app.get("/api/me", auth, async (req, res) => {
  try {
    const u = await User.findOne({ username: req.user }, { username: 1, fullName: 1, email: 1, role: 1, status: 1 });
    if (!u) return res.status(401).json({ error: "User nahi mila — dobara login karein" });
    const status = u.status || "approved";
    if (status !== "approved") {
      res.clearCookie("tl_token", { path: "/" });
      return res.status(403).json({ error: STATUS_MSG[status] || "Login allow nahi hai", status });
    }
    res.json({ username: u.username, fullName: u.fullName || "", email: u.email || "", role: u.role || "user", status });
  } catch (e) {
    serverErr(res, e);
  }
});

async function adminOnly(req, res, next) {
  try {
    const u = await User.findOne({ username: req.user }, { role: 1 });
    if (!u || u.role !== "admin") return res.status(403).json({ error: "Admin access chahiye" });
    next();
  } catch (e) {
    serverErr(res, e);
  }
}

app.get("/api/admin/users", auth, adminOnly, async (req, res) => {
  const users = await User.find({}, { username: 1, fullName: 1, email: 1, role: 1, status: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  users.forEach((u) => { u.status = u.status || "approved"; u.role = u.role || "user"; });
  const counts = { total: users.length, pending: 0, approved: 0, blocked: 0, rejected: 0 };
  users.forEach((u) => { counts[u.status] = (counts[u.status] || 0) + 1; });
  res.json({ users, counts, me: req.user });
});

const ADMIN_ACTIONS = { approve: "approved", reject: "rejected", block: "blocked", unblock: "approved" };

app.post("/api/admin/users/action", auth, adminOnly, async (req, res) => {
  try {
    const target = String((req.body && req.body.username) || "");
    const action = String((req.body && req.body.action) || "");
    if (!target) return res.status(400).json({ error: "Username chahiye" });
    if (!ADMIN_ACTIONS[action] && action !== "delete" && action !== "setrole") return res.status(400).json({ error: "Invalid action" });
    if (target === req.user) return res.status(400).json({ error: "Apne account par yeh action nahi kar sakte" });

    const user = await User.findOne({ username: target });
    if (!user) return res.status(404).json({ error: "User nahi mila" });

    if (action === "setrole") {
      const role = String((req.body && req.body.role) || "");
      if (role !== "admin" && role !== "user") return res.status(400).json({ error: "Role sirf 'user' ya 'admin' ho sakta hai" });
      if ((user.role || "user") === role) return res.json({ ok: true, action, username: target, role, status: user.status || "approved" });
      if (role === "user") {
        const otherAdmins = await User.countDocuments({ role: "admin", username: { $ne: target } });
        if (otherAdmins === 0) return res.status(400).json({ error: "Aakhri admin ko demote nahi kar sakte" });
      }
      user.role = role;
      if (role === "admin" && (user.status || "approved") !== "approved") user.status = "approved";
      await user.save();
      return res.json({ ok: true, action, username: target, role: user.role, status: user.status || "approved" });
    }

    if (action === "delete") {
      await User.deleteOne({ username: target });
      await Doc.deleteOne({ username: target });
      await Img.deleteMany({ username: target });
      return res.json({ ok: true, action, username: target });
    }

    user.status = ADMIN_ACTIONS[action];
    await user.save();
    res.json({ ok: true, action, username: target, status: user.status });
  } catch (e) {
    serverErr(res, e);
  }
});

app.get("/api/admin/user-cred", auth, adminOnly, async (req, res) => {
  try {
    const username = String(req.query.username || "");
    const u = await User.findOne({ username }, { username: 1, fullName: 1, email: 1, contact: 1, passwordEnc: 1 });
    if (!u) return res.status(404).json({ error: "User nahi mila" });
    let password = null;
    if (u.passwordEnc) {
      try { password = decPass(u.passwordEnc); } catch (e) { password = null; }
    }
    res.json({ username: u.username, fullName: u.fullName || "", email: u.email || "", contact: u.contact || "", password });
  } catch (e) {
    serverErr(res, e);
  }
});

app.post("/api/admin/user-password", auth, adminOnly, async (req, res) => {
  try {
    const username = String(req.body.username || "");
    const password = String(req.body.password || "");
    if (!username) return res.status(400).json({ error: "Username chahiye" });
    if (password.length < 6) return res.status(400).json({ error: "Password kam se kam 6 characters ka ho" });
    if (password.length > 72) return res.status(400).json({ error: "Password 72 characters se chhota rakhein" });
    const u = await User.findOne({ username });
    if (!u) return res.status(404).json({ error: "User nahi mila" });
    u.passwordHash = await bcrypt.hash(password, 10);
    u.passwordEnc = encPass(password);
    await u.save();
    res.json({ ok: true, username });
  } catch (e) {
    serverErr(res, e);
  }
});

app.get("/api/account/recovery", auth, async (req, res) => {
  const user = await User.findOne({ username: req.user });
  if (!user || !user.passwordEnc) {
    return res.status(404).json({ error: "Password save nahi hua — pehle ek baar login karein" });
  }
  try {
    res.json({ username: user.username, password: decPass(user.passwordEnc) });
  } catch (e) {
    res.status(500).json({ error: "Password decrypt nahi ho saka" });
  }
});

app.get("/api/data", auth, async (req, res) => {
  const doc = await Doc.findOne({ username: req.user });
  res.json({ state: doc ? doc.state : null });
});

async function saveData(req, res) {
  const state = req.body && req.body.state;
  if (!state || typeof state !== "object") return res.status(400).json({ error: "Invalid data" });
  await Doc.updateOne(
    { username: req.user },
    { $set: { state, updatedAt: new Date() } },
    { upsert: true }
  );
  res.json({ ok: true, savedAt: Date.now() });
}

app.put("/api/data", auth, saveData);
app.post("/api/data", auth, saveData);

app.post("/api/images/get", auth, async (req, res) => {
  const keys = Array.isArray(req.body.keys) ? req.body.keys.map(String).slice(0, 400) : [];
  if (!keys.length) return res.json({ images: {} });
  const rows = await Img.find({ username: req.user, key: { $in: keys } }).lean();
  const images = {};
  rows.forEach((r) => (images[r.key] = r.data));
  res.json({ images });
});

app.get("/api/images/all", auth, async (req, res) => {
  const rows = await Img.find({ username: req.user }).lean();
  const images = {};
  rows.forEach((r) => (images[r.key] = r.data));
  res.json({ images });
});

app.post("/api/images/save", auth, async (req, res) => {
  const key = String(req.body.key || "");
  const data = String(req.body.data || "");
  if (!key || !data) return res.status(400).json({ error: "Invalid image" });
  if (data.length > 25 * 1024 * 1024) return res.status(413).json({ error: "Image too large" });
  await Img.updateOne(
    { username: req.user, key },
    { $set: { data, updatedAt: new Date() } },
    { upsert: true }
  );
  res.json({ ok: true });
});

app.post("/api/images/delete", auth, async (req, res) => {
  const key = String(req.body.key || "");
  if (!key) return res.status(400).json({ error: "Invalid key" });
  await Img.deleteOne({ username: req.user, key });
  res.json({ ok: true });
});

app.post("/api/images/delete-trade", auth, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String).slice(0, 500) : [];
  if (!ids.length) return res.json({ ok: true, deleted: 0 });
  const keys = ids.flatMap((id) => [req.user + "|" + id + "|before", req.user + "|" + id + "|after"]);
  const r = await Img.deleteMany({ username: req.user, key: { $in: keys } });
  res.json({ ok: true, deleted: r.deletedCount });
});

app.get("/api/db/summary", auth, adminOnly, async (req, res) => {
  try {
    const [uCount, dCount, iCount] = await Promise.all([
      User.countDocuments(),
      Doc.countDocuments(),
      Img.countDocuments(),
    ]);
    const users = await User.find({}, { username: 1, createdAt: 1, _id: 0 }).sort({ createdAt: 1 }).limit(100).lean();
    const myDoc = await Doc.findOne({ username: req.user }).lean();
    const myImgs = await Img.find({ username: req.user }, { key: 1, updatedAt: 1, _id: 0 }).limit(300).lean();
    const conn = mongoose.connection;
    res.json({
      db: conn.db ? conn.db.databaseName : "-",
      host: conn.host || "-",
      port: conn.port || "-",
      counts: { users: uCount, docs: dCount, imgs: iCount },
      users,
      me: req.user,
      state: myDoc ? myDoc.state : null,
      images: myImgs,
      savedAt: myDoc ? myDoc.updatedAt : null,
    });
  } catch (e) {
    serverErr(res, e);
  }
});

app.use(async (req, res, next) => {
  const p = req.path;
  const blocked = ["/server.js", "/package.json", "/package-lock.json", "/.env", "/.git", "/vercel.json", "/.gitignore", "/api/index.js", "/start.bat"];
  if (p.startsWith("/node_modules") || p.startsWith("/mongo-data") || p.startsWith("/.git") || p.startsWith("/api/") || p.endsWith(".log") || p.endsWith(".bat") || blocked.includes(p)) return res.status(404).end();
  next();
});

app.use(express.static(__dirname, { dotfiles: "deny", index: "index.html" }));

app.use((err, req, res, next) => {
  console.error("[err]", new Date().toISOString(), (err && err.stack) || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Server error — dobara try karein" });
});

async function connectDB() {
  const isCloud = !!process.env.VERCEL;
  const uri = process.env.MONGODB_URI;
  if (!uri && isCloud) throw new Error("MONGODB_URI set karein (Vercel par MongoDB Atlas zaroori hai)");
  const target = uri || "mongodb://127.0.0.1:27017/" + DB_NAME;
  try {
    await mongoose.connect(target, { serverSelectionTimeoutMS: 4000, bufferCommands: false });
    console.log("[db] connected:", target.replace(/\/\/.*@/, "//***@"));
    await bootstrapUsers();
    return;
  } catch (e) {
    if (isCloud || uri) throw e;
    console.log("[db] " + target + " unavailable (" + e.message.split("\n")[0] + ")");
  }

  console.log("[db] starting local persistent MongoDB (mongodb-memory-server)...");
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const dataPath = path.join(__dirname, "mongo-data");
  fs.mkdirSync(dataPath, { recursive: true });
  const mem = await MongoMemoryServer.create({
    instance: { port: 27017, ip: "127.0.0.1", dbPath: dataPath },
  });
  await mongoose.connect(mem.getUri(DB_NAME), { serverSelectionTimeoutMS: 8000, bufferCommands: false });
  console.log("[db] local MongoDB ready at", mem.getUri(DB_NAME), "-> data:", dataPath);
  await bootstrapUsers();
}

const ADMIN_USER = process.env.ADMIN_USER || "adminashar";
const ADMIN_PASS = process.env.ADMIN_PASS || "1111";

async function bootstrapUsers() {
  await User.updateMany({ status: { $exists: false } }, { $set: { status: "approved" } });
  await User.updateMany({ role: { $exists: false } }, { $set: { role: "user" } });
  const admin = await User.findOne({ username: ADMIN_USER });
  if (!admin) {
    await User.create({
      username: ADMIN_USER,
      fullName: "MR ASHAR",
      email: ADMIN_USER + "@fxjournal.app",
      passwordHash: await bcrypt.hash(ADMIN_PASS, 10),
      passwordEnc: encPass(ADMIN_PASS),
      role: "admin",
      status: "approved",
    });
    console.log("[auth] admin account ready: " + ADMIN_USER);
  } else {
    let changed = false;
    if (admin.role !== "admin") { admin.role = "admin"; changed = true; }
    if (admin.status !== "approved") { admin.status = "approved"; changed = true; }
    if (!admin.passwordEnc) { admin.passwordEnc = encPass(ADMIN_PASS); changed = true; }
    if (changed) await admin.save();
  }
}

if (require.main === module) {
  ensureDb()
    .then(() => {
      app.listen(PORT, () => {
        console.log("---------------------------------------------");
        console.log(" Trading Journal running: http://localhost:" + PORT);
        console.log(" DB: set MONGODB_URI env var to use MongoDB Atlas");
        if (!process.env.ADMIN_PASS) console.warn("[auth] WARNING: default admin password chal raha hai — .env me ADMIN_PASS set karein");
        console.log("---------------------------------------------");
      });
    })
    .catch((e) => {
      console.error("[db] failed to start:", e.message);
      process.exit(1);
    });
}

module.exports = app;
