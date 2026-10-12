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

const PORT = process.env.PORT || 8080;
const SECRET = process.env.JWT_SECRET || "tl_" + require("crypto").randomBytes(24).toString("hex");
const DB_NAME = "trading_journal";
const USER_RE = /^[a-z0-9_.-]{3,20}$/i;

const app = express();
app.use(express.json({ limit: "40mb" }));
app.use(cookieParser());

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
  passwordHash: { type: String, required: true },
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
    maxAge: 30 * 24 * 3600 * 1000,
    path: "/",
  });
}

function auth(req, res, next) {
  const token = req.cookies && req.cookies.tl_token;
  if (!token) return res.status(401).json({ error: "Not logged in" });
  try {
    const payload = jwt.verify(token, SECRET);
    req.user = String(payload.username);
    next();
  } catch (e) {
    res.status(401).json({ error: "Session expired — dobara login karein" });
  }
}

app.post("/api/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!USER_RE.test(username)) return res.status(400).json({ error: "Username 3-20 characters rakhein (a-z, 0-9, . _ -)" });
    if (password.length < 4) return res.status(400).json({ error: "Password kam se kam 4 characters ka ho" });
    const exists = await User.findOne({ username });
    if (exists) return res.status(409).json({ error: "Yeh username pehle se registered hai — Login karein" });
    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({ username, passwordHash });
    await Doc.updateOne({ username }, { $setOnInsert: { username, state: null } });
    setCookie(res, username);
    res.json({ username });
  } catch (e) {
    if (e && e.code === 11000) return res.status(409).json({ error: "Yeh username pehle se registered hai — Login karein" });
    res.status(500).json({ error: "Server error: " + e.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: "Username ya password ghalat hai" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Username ya password ghalat hai" });
    setCookie(res, user.username);
    res.json({ username: user.username });
  } catch (e) {
    res.status(500).json({ error: "Server error: " + e.message });
  }
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("tl_token", { path: "/" });
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) => {
  res.json({ username: req.user });
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

app.get("/api/db/summary", auth, async (req, res) => {
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
    res.status(500).json({ error: e.message });
  }
});

app.use(async (req, res, next) => {
  const p = req.path;
  const blocked = ["/server.js", "/package.json", "/package-lock.json", "/.env", "/.git", "/vercel.json", "/.gitignore", "/api/index.js"];
  if (p.startsWith("/node_modules") || p.startsWith("/mongo-data") || p.startsWith("/.git") || blocked.includes(p)) return res.status(404).end();
  next();
});

app.use(express.static(__dirname, { dotfiles: "deny", index: "index.html" }));

async function connectDB() {
  const isCloud = !!process.env.VERCEL;
  const uri = process.env.MONGODB_URI;
  if (!uri && isCloud) throw new Error("MONGODB_URI set karein (Vercel par MongoDB Atlas zaroori hai)");
  const target = uri || "mongodb://127.0.0.1:27017/" + DB_NAME;
  try {
    await mongoose.connect(target, { serverSelectionTimeoutMS: 4000, bufferCommands: false });
    console.log("[db] connected:", target.replace(/\/\/.*@/, "//***@"));
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
}

if (require.main === module) {
  ensureDb()
    .then(() => {
      app.listen(PORT, () => {
        console.log("---------------------------------------------");
        console.log(" Trading Journal running: http://localhost:" + PORT);
        console.log(" DB: set MONGODB_URI env var to use MongoDB Atlas");
        console.log("---------------------------------------------");
      });
    })
    .catch((e) => {
      console.error("[db] failed to start:", e.message);
      process.exit(1);
    });
}

module.exports = app;
