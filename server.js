require("dotenv").config();

const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const crypto = require("crypto");

const store = require("./lib/store");
const drive = require("./services/drive");

const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 25 * 1024 * 1024, files: 30 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) return cb(null, true);
    cb(new Error("Seules les images et vidéos sont acceptées."));
  }
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadDir));

app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60 * 1000
  }
}));

function adminOnly(req, res, next) {
  if (req.session.admin) return next();
  res.redirect("/admin/login");
}

function safeUnlink(filePath) {
  try { fs.unlinkSync(filePath); } catch {}
}

app.get("/", (req, res) => {
  res.render("home", { title: "PhotoShare 28" });
});

app.get("/admin/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/admin/login", (req, res) => {
  const email = process.env.ADMIN_EMAIL || "admin@locationphotobooth28.fr";
  const password = process.env.ADMIN_PASSWORD || "change-moi";
  if (req.body.email === email && req.body.password === password) {
    req.session.admin = true;
    return res.redirect("/admin");
  }
  res.status(401).render("login", { error: "Identifiants incorrects." });
});

app.post("/admin/logout", adminOnly, (req, res) => {
  req.session.destroy(() => res.redirect("/admin/login"));
});


app.post("/admin/drive/test", adminOnly, async (req, res) => {
  try {
    const result = await drive.testConnection();
    if (!result.ok) {
      return res.redirect(`/admin?driveTest=error&message=${encodeURIComponent(result.message)}`);
    }
    res.redirect(`/admin?driveTest=ok&folder=${encodeURIComponent(result.folderName)}`);
  } catch (err) {
    console.error("Drive test failed:", err);
    res.redirect(`/admin?driveTest=error&message=${encodeURIComponent(err.message)}`);
  }
});

app.get("/admin", adminOnly, (req, res) => {
  const events = store.readEvents();
  const photoCount = events.reduce((sum, e) => sum + (e.photos?.length || 0), 0);
  res.render("dashboard", {
    events,
    photoCount,
    driveConfigured: drive.isConfigured(),
    driveTest: req.query.driveTest || null,
    driveFolder: req.query.folder || null,
    driveMessage: req.query.message || null
  });
});

app.get("/admin/events/new", adminOnly, (req, res) => {
  res.render("new-event", { error: null });
});

app.post("/admin/events", adminOnly, async (req, res) => {
  const { name, date, type } = req.body;
  if (!name || !date) {
    return res.status(400).render("new-event", { error: "Le nom et la date sont obligatoires." });
  }

  let event = store.createEvent({ name, date, type });

  if (drive.isConfigured()) {
    try {
      event.drive = await drive.createEventFolders(event);
      store.updateEvent(event);
    } catch (err) {
      console.error("Drive folder creation failed:", err.message);
    }
  }

  res.redirect(`/admin/events/${event.code}`);
});

app.get("/admin/events/:code", adminOnly, async (req, res) => {
  const event = store.getEventByCode(req.params.code);
  if (!event) return res.status(404).send("Événement introuvable");
  const guestUrl = `${APP_URL}/e/${event.code}`;
  const qrDataUrl = await QRCode.toDataURL(guestUrl, { width: 500, margin: 2 });
  res.render("event-admin", { event, guestUrl, qrDataUrl, driveConfigured: drive.isConfigured() });
});

app.get("/e/:code", (req, res) => {
  const event = store.getEventByCode(req.params.code);
  if (!event || !event.active) return res.status(404).send("Cette galerie n'est pas disponible.");
  res.render("gallery", { event, uploaded: req.query.ok === "1", error: null });
});

app.post("/e/:code/upload", upload.array("photos", 30), async (req, res) => {
  const event = store.getEventByCode(req.params.code);
  if (!event || !event.active) {
    (req.files || []).forEach(f => safeUnlink(f.path));
    return res.status(404).send("Galerie introuvable");
  }

  try {
    for (const file of (req.files || [])) {
      const isVideo = file.mimetype.startsWith("video/");
      let record = {
        id: crypto.randomUUID(),
        originalName: file.originalname,
        mimeType: file.mimetype,
        source: "invite",
        uploadedAt: new Date().toISOString()
      };

      if (drive.isConfigured() && event.drive) {
        const folderId = isVideo ? event.drive.videosFolderId : event.drive.guestsFolderId;
        const uploaded = await drive.uploadFile({
          localPath: file.path,
          filename: file.originalname,
          mimeType: file.mimetype,
          folderId
        });
        record.storage = "drive";
        record.driveFileId = uploaded.id;
        record.webViewLink = uploaded.webViewLink || null;
        safeUnlink(file.path);
      } else {
        record.storage = "local";
        record.localName = file.filename;
      }

      store.addPhoto(event.code, record);
    }
    res.redirect(`/e/${event.code}?ok=1`);
  } catch (err) {
    console.error(err);
    res.status(500).render("gallery", {
      event: store.getEventByCode(req.params.code),
      uploaded: false,
      error: "Une erreur est survenue pendant l'envoi."
    });
  }
});

app.post("/api/events/:code/upload", upload.single("photo"), async (req, res) => {
  const event = store.getEventByCode(req.params.code);
  if (!event) {
    if (req.file) safeUnlink(req.file.path);
    return res.status(404).json({ ok: false, error: "event_not_found" });
  }

  const apiKey = req.get("X-API-Key");
  if (!apiKey || apiKey !== event.apiKey) {
    if (req.file) safeUnlink(req.file.path);
    return res.status(401).json({ ok: false, error: "invalid_api_key" });
  }

  if (!req.file) return res.status(400).json({ ok: false, error: "missing_photo" });

  try {
    let record = {
      id: crypto.randomUUID(),
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      source: req.body.source || "borne",
      uploadedAt: new Date().toISOString()
    };

    if (drive.isConfigured() && event.drive) {
      const uploaded = await drive.uploadFile({
        localPath: req.file.path,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        folderId: event.drive.boothFolderId
      });
      record.storage = "drive";
      record.driveFileId = uploaded.id;
      record.webViewLink = uploaded.webViewLink || null;
      safeUnlink(req.file.path);
    } else {
      record.storage = "local";
      record.localName = req.file.filename;
    }

    store.addPhoto(event.code, record);
    res.json({ ok: true, photo: record });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "upload_failed" });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).send(err.message || "Erreur");
});

app.listen(PORT, () => {
  console.log(`PhotoShare 28 lancé sur le port ${PORT}`);
});
