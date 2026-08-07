require("dotenv").config();

const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const crypto = require("crypto");
const archiver = require("archiver");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const store = require("./lib/store");
const drive = require("./services/drive");

const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
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

const documentUpload = multer({
  dest: uploadDir,
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") return cb(null, true);
    cb(new Error("La facture doit être un fichier PDF."));
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
  cookie: { httpOnly: true, sameSite: "lax", secure: "auto", maxAge: 12 * 60 * 60 * 1000 }
}));

function adminOnly(req, res, next) {
  if (req.session.admin) return next();
  res.redirect("/admin/login");
}
function safeUnlink(filePath) { try { fs.unlinkSync(filePath); } catch {} }
function getBaseUrl(req) { return (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, ""); }

const COMPANY = {
  name: "LOCATION PHOTOBOOTH 28",
  site: "https://www.locationphotobooth28.fr",
  siteLabel: "www.locationphotobooth28.fr",
  facebook: "https://www.facebook.com/location.photobooth.28/"
};

function eventAvailable(event) { return event && event.active && !store.isExpired(event); }
function getPhoto(event, id) { return (event.photos || []).find(p => p.id === id); }

async function backupStoreSafe() {
  try {
    if (!drive.isConfigured()) return;
    await drive.backupEvents(store.readEvents());
  } catch (err) {
    console.error("Drive metadata backup failed:", err.message);
  }
}

function dataUrlToPngBuffer(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/png;base64,(.+)$/);
  if (!match) throw new Error("Signature PNG invalide.");
  return Buffer.from(match[1], "base64");
}

async function makeSignedContractPdf({ originalPdf, signaturePng, signerName, signedAt }) {
  const pdfDoc = await PDFDocument.load(originalPdf);
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const signature = await pdfDoc.embedPng(signaturePng);

  page.drawText("VALIDATION DU CONTRAT", {
    x: 55, y: 760, size: 20, font: bold, color: rgb(0.12, 0.12, 0.12)
  });
  page.drawText("LOCATION PHOTOBOOTH 28", {
    x: 55, y: 730, size: 12, font: bold
  });
  page.drawText(`Signataire : ${signerName}`, {
    x: 55, y: 675, size: 12, font
  });
  page.drawText(`Date de validation : ${new Date(signedAt).toLocaleString("fr-FR")}`, {
    x: 55, y: 650, size: 12, font
  });
  page.drawText("Le signataire a coché la case d'acceptation et apposé la signature ci-dessous.", {
    x: 55, y: 620, size: 10, font
  });

  const maxW = 360;
  const scale = Math.min(maxW / signature.width, 1);
  page.drawImage(signature, {
    x: 55,
    y: 390,
    width: signature.width * scale,
    height: signature.height * scale
  });

  page.drawText("Signature :", { x: 55, y: 585, size: 11, font: bold });
  page.drawText("Validation électronique simple - non qualifiée eIDAS.", {
    x: 55, y: 80, size: 9, font, color: rgb(0.35, 0.35, 0.35)
  });

  return Buffer.from(await pdfDoc.save());
}


app.get("/", (req, res) => res.render("home", { title: "PhotoShare 28" }));

app.get("/admin/login", (req, res) => res.render("login", { error: null }));
app.post("/admin/login", (req, res) => {
  const email = process.env.ADMIN_EMAIL || "admin@locationphotobooth28.fr";
  const password = process.env.ADMIN_PASSWORD || "change-moi";
  if (req.body.email === email && req.body.password === password) {
    req.session.admin = true;
    return res.redirect("/admin");
  }
  res.status(401).render("login", { error: "Identifiants incorrects." });
});
app.post("/admin/logout", adminOnly, (req, res) => req.session.destroy(() => res.redirect("/admin/login")));

app.post("/admin/drive/test", adminOnly, async (req, res) => {
  try {
    const result = await drive.testConnection();
    if (!result.ok) return res.redirect(`/admin?driveTest=error&message=${encodeURIComponent(result.message)}`);
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
    events, photoCount,
    driveConfigured: drive.isConfigured(),
    driveTest: req.query.driveTest || null,
    driveFolder: req.query.folder || null,
    driveMessage: req.query.message || null
  });
});

app.get("/admin/events/new", adminOnly, (req, res) => res.render("new-event", { error: null }));

app.post("/admin/events", adminOnly, async (req, res) => {
  const { name, date, type } = req.body;
  if (!name || !date) return res.status(400).render("new-event", { error: "Le nom et la date sont obligatoires." });

  let event = store.createEvent({ name, date, type });
  if (drive.isConfigured()) {
    try {
      event.drive = await drive.createEventFolders(event);
      store.updateEvent(event);
    } catch (err) {
      console.error("Drive folder creation failed:", err.message);
    }
  }
  await backupStoreSafe();
  res.redirect(`/admin/events/${event.code}`);
});

app.get("/admin/events/:code", adminOnly, async (req, res) => {
  const event = store.getEventByCode(req.params.code);
  if (!event) return res.status(404).send("Événement introuvable");
  const baseUrl = getBaseUrl(req);
  const guestUrl = `${baseUrl}/e/${event.code}`;
  const organizerUrl = `${baseUrl}/o/${event.code}/${event.organizerToken}`;
  const qrDataUrl = await QRCode.toDataURL(guestUrl, { width: 500, margin: 2 });
  res.render("event-admin", {
    event, guestUrl, organizerUrl, qrDataUrl,
    driveConfigured: drive.isConfigured(),
    expired: store.isExpired(event),
    company: COMPANY
  });
});


/* DOSSIER ORGANISATEUR - ADMIN */
app.post("/admin/events/:code/client-status", adminOnly, async (req, res) => {
  const event = store.getEventByCode(req.params.code);
  if (!event) return res.status(404).send("Événement introuvable.");

  event.depositReceived = req.body.depositReceived === "on";
  event.invoicePaid = req.body.invoicePaid === "on";

  const inventoryValues = req.body.inventory;
  event.inventory = Array.isArray(inventoryValues)
    ? inventoryValues
    : inventoryValues
      ? [inventoryValues]
      : [];

  store.updateEvent(event);
  await backupStoreSafe();
  res.redirect(`/admin/events/${event.code}?saved=1`);
});


app.post("/admin/events/:code/contract", adminOnly, documentUpload.single("contract"), async (req, res) => {
  const event = store.getEventByCode(req.params.code);

  if (!event) {
    if (req.file) safeUnlink(req.file.path);
    return res.status(404).send("Événement introuvable.");
  }

  if (!req.file) return res.status(400).send("Contrat PDF manquant.");

  try {
    let contract = {
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      uploadedAt: new Date().toISOString()
    };

    if (drive.isConfigured() && event.drive) {
      const folderId = event.drive.documentsFolderId;
      const uploaded = await drive.uploadFile({
        localPath: req.file.path,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        folderId
      });
      contract.storage = "drive";
      contract.driveFileId = uploaded.id;
      safeUnlink(req.file.path);
    } else {
      contract.storage = "local";
      contract.localName = req.file.filename;
    }

    event.contract = contract;
    event.contractSignature = null;
    store.updateEvent(event);
    await backupStoreSafe();
    res.redirect(`/admin/events/${event.code}?contract=1`);
  } catch (err) {
    console.error("Contract upload error:", err);
    if (req.file) safeUnlink(req.file.path);
    res.status(500).send("Impossible d'enregistrer le contrat.");
  }
});

app.post("/admin/events/:code/invoice", adminOnly, documentUpload.single("invoice"), async (req, res) => {
  const event = store.getEventByCode(req.params.code);

  if (!event) {
    if (req.file) safeUnlink(req.file.path);
    return res.status(404).send("Événement introuvable.");
  }

  if (!req.file) return res.status(400).send("Facture PDF manquante.");

  try {
    let invoice = {
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      uploadedAt: new Date().toISOString()
    };

    if (drive.isConfigured() && event.drive) {
      let documentsFolderId = event.drive.documentsFolderId;

      if (!documentsFolderId) {
        const freshFolders = await drive.createEventFolders({
          ...event,
          name: `${event.name} - documents`
        });
        documentsFolderId = freshFolders.documentsFolderId;
      }

      const uploaded = await drive.uploadFile({
        localPath: req.file.path,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        folderId: documentsFolderId
      });

      invoice.storage = "drive";
      invoice.driveFileId = uploaded.id;
      safeUnlink(req.file.path);
    } else {
      invoice.storage = "local";
      invoice.localName = req.file.filename;
    }

    event.invoice = invoice;
    store.updateEvent(event);
    await backupStoreSafe();
    res.redirect(`/admin/events/${event.code}?invoice=1`);
  } catch (err) {
    console.error("Invoice upload error:", err);
    if (req.file) safeUnlink(req.file.path);
    res.status(500).send("Impossible d'enregistrer la facture.");
  }
});

/* INVITES */
app.get("/e/:code", (req, res) => {
  const event = store.getEventByCode(req.params.code);
  if (!event || !event.active) return res.status(404).send("Cette galerie n'est pas disponible.");
  if (store.isExpired(event)) return res.status(410).render("expired", { event, company: COMPANY });
  res.render("gallery", { event, uploaded: req.query.ok === "1", error: null, company: COMPANY });
});

app.post("/e/:code/upload", upload.array("photos", 30), async (req, res) => {
  const event = store.getEventByCode(req.params.code);
  if (!eventAvailable(event)) {
    (req.files || []).forEach(f => safeUnlink(f.path));
    return res.status(410).send("Cette galerie n'est plus disponible.");
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
          localPath: file.path, filename: file.originalname,
          mimeType: file.mimetype, folderId
        });
        record.storage = "drive";
        record.driveFileId = uploaded.id;
        safeUnlink(file.path);
      } else {
        record.storage = "local";
        record.localName = file.filename;
      }
      store.addPhoto(event.code, record);
    }
    await backupStoreSafe();
    res.redirect(`/e/${event.code}?ok=1`);
  } catch (err) {
    console.error(err);
    res.status(500).render("gallery", {
      event: store.getEventByCode(req.params.code),
      uploaded: false,
      error: "Une erreur est survenue pendant l'envoi.",
      company: COMPANY
    });
  }
});

app.get("/e/:code/media/:photoId", async (req, res) => {
  const event = store.getEventByCode(req.params.code);
  if (!eventAvailable(event)) return res.status(410).send("Galerie expirée.");
  const photo = getPhoto(event, req.params.photoId);
  if (!photo) return res.status(404).send("Photo introuvable.");
  try {
    res.setHeader("Content-Type", photo.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", "inline");
    if (photo.storage === "drive" && photo.driveFileId) {
      const stream = await drive.getFileStream(photo.driveFileId);
      return stream.on("error", () => res.destroy()).pipe(res);
    }
    if (photo.storage === "local" && photo.localName) return res.sendFile(path.join(uploadDir, photo.localName));
    res.status(404).end();
  } catch (err) {
    console.error("Guest media error:", err);
    res.status(500).end();
  }
});

/* ORGANISATEUR */
app.get("/o/:code/:token", async (req, res) => {
  const event = store.getEventByCode(req.params.code);
  if (!event || event.organizerToken !== req.params.token || !event.active) {
    return res.status(404).send("Accès organisateur invalide.");
  }
  if (store.isExpired(event)) return res.status(410).render("expired", { event, company: COMPANY });

  const guestUrl = `${getBaseUrl(req)}/e/${event.code}`;
  const qrDataUrl = await QRCode.toDataURL(guestUrl, { width: 500, margin: 2 });
  res.render("organizer", { event, guestUrl, qrDataUrl, company: COMPANY, signedNow: req.query.signed === "1" });
});

app.get("/o/:code/:token/download/:photoId", async (req, res) => {
  const event = store.getEventByCode(req.params.code);
  if (!eventAvailable(event) || event.organizerToken !== req.params.token) return res.status(404).send("Accès refusé.");
  const photo = getPhoto(event, req.params.photoId);
  if (!photo) return res.status(404).send("Fichier introuvable.");
  try {
    res.setHeader("Content-Type", photo.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(photo.originalName || "photo")}`);
    if (photo.storage === "drive" && photo.driveFileId) {
      const stream = await drive.getFileStream(photo.driveFileId);
      return stream.on("error", () => res.destroy()).pipe(res);
    }
    if (photo.storage === "local" && photo.localName) return res.download(path.join(uploadDir, photo.localName), photo.originalName || "photo");
    res.status(404).end();
  } catch (err) {
    console.error("Organizer download error:", err);
    res.status(500).send("Téléchargement impossible.");
  }
});

app.get("/o/:code/:token/download-all", async (req, res) => {
  const event = store.getEventByCode(req.params.code);
  if (!eventAvailable(event) || event.organizerToken !== req.params.token) return res.status(404).send("Accès refusé.");
  const files = (event.photos || []).filter(p => (p.storage === "drive" && p.driveFileId) || (p.storage === "local" && p.localName));
  if (!files.length) return res.status(404).send("Aucun fichier à télécharger.");

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(event.name + "-photos.zip")}`);

  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.pipe(res);
  archive.on("error", err => {
    console.error("ZIP error:", err);
    if (!res.headersSent) res.status(500);
    res.end();
  });

  for (const photo of files) {
    try {
      const filename = photo.originalName || `${photo.id}.bin`;
      if (photo.storage === "drive") {
        const stream = await drive.getFileStream(photo.driveFileId);
        archive.append(stream, { name: filename });
      } else {
        archive.file(path.join(uploadDir, photo.localName), { name: filename });
      }
    } catch (err) {
      console.error("ZIP skip:", photo.originalName, err.message);
    }
  }
  archive.finalize();
});



app.get("/o/:code/:token/qr.png", async (req, res) => {
  const event = store.getEventByCode(req.params.code);

  if (!eventAvailable(event) || event.organizerToken !== req.params.token) {
    return res.status(404).send("Accès refusé.");
  }

  try {
    const guestUrl = `${getBaseUrl(req)}/e/${event.code}`;
    const png = await QRCode.toBuffer(guestUrl, {
      type: "png",
      width: 1200,
      margin: 3,
      errorCorrectionLevel: "H"
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent("QR-Code-" + event.name + ".png")}`
    );
    res.send(png);
  } catch (err) {
    console.error("QR download error:", err);
    res.status(500).send("Impossible de générer le QR Code.");
  }
});


app.get("/o/:code/:token/contract", async (req, res) => {
  const event = store.getEventByCode(req.params.code);
  if (!eventAvailable(event) || event.organizerToken !== req.params.token) {
    return res.status(404).send("Accès refusé.");
  }
  if (!event.contract) return res.status(404).send("Aucun contrat disponible.");

  try {
    const contract = event.contract;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(contract.originalName || "contrat.pdf")}`);

    if (contract.storage === "drive" && contract.driveFileId) {
      const stream = await drive.getFileStream(contract.driveFileId);
      return stream.on("error", () => res.destroy()).pipe(res);
    }

    if (contract.storage === "local" && contract.localName) {
      return res.sendFile(path.join(uploadDir, contract.localName));
    }

    res.status(404).end();
  } catch (err) {
    console.error("Contract view error:", err);
    res.status(500).send("Impossible d'ouvrir le contrat.");
  }
});

app.get("/o/:code/:token/contract-signed", async (req, res) => {
  const event = store.getEventByCode(req.params.code);
  if (!eventAvailable(event) || event.organizerToken !== req.params.token) {
    return res.status(404).send("Accès refusé.");
  }
  const signed = event.contractSignature?.signedPdf;
  if (!signed) return res.status(404).send("Contrat signé indisponible.");

  try {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(signed.originalName || "contrat-signe.pdf")}`);

    if (signed.storage === "drive" && signed.driveFileId) {
      const stream = await drive.getFileStream(signed.driveFileId);
      return stream.on("error", () => res.destroy()).pipe(res);
    }

    if (signed.storage === "local" && signed.localName) {
      return res.download(path.join(uploadDir, signed.localName), signed.originalName || "contrat-signe.pdf");
    }

    res.status(404).end();
  } catch (err) {
    console.error("Signed contract download error:", err);
    res.status(500).send("Téléchargement impossible.");
  }
});

app.post("/o/:code/:token/sign-contract", async (req, res) => {
  const event = store.getEventByCode(req.params.code);

  if (!eventAvailable(event) || event.organizerToken !== req.params.token) {
    return res.status(404).send("Accès refusé.");
  }
  if (!event.contract) return res.status(400).send("Aucun contrat à signer.");
  if (event.contractSignature?.signedAt) {
    return res.status(409).send("Ce contrat a déjà été validé.");
  }

  const signerName = String(req.body.signerName || "").trim();
  const accepted = req.body.acceptTerms === "on";
  const signatureData = req.body.signatureData;

  if (!signerName || !accepted || !signatureData) {
    return res.status(400).send("Nom, acceptation et signature sont obligatoires.");
  }

  try {
    let originalPdf;
    if (event.contract.storage === "drive") {
      originalPdf = await drive.getFileBuffer(event.contract.driveFileId);
    } else {
      originalPdf = fs.readFileSync(path.join(uploadDir, event.contract.localName));
    }

    const signaturePng = dataUrlToPngBuffer(signatureData);
    const signedAt = new Date().toISOString();
    const signedPdfBuffer = await makeSignedContractPdf({
      originalPdf,
      signaturePng,
      signerName,
      signedAt
    });

    const signedFilename = `Contrat-signe-${event.code}.pdf`;
    const signatureFilename = `Signature-${event.code}.png`;

    let signedPdf, signatureFile;

    if (drive.isConfigured() && event.drive) {
      const folderId = event.drive.documentsFolderId;
      const signedUpload = await drive.uploadBuffer({
        buffer: signedPdfBuffer,
        filename: signedFilename,
        mimeType: "application/pdf",
        folderId
      });
      const sigUpload = await drive.uploadBuffer({
        buffer: signaturePng,
        filename: signatureFilename,
        mimeType: "image/png",
        folderId
      });

      signedPdf = {
        storage: "drive",
        driveFileId: signedUpload.id,
        originalName: signedFilename
      };
      signatureFile = {
        storage: "drive",
        driveFileId: sigUpload.id,
        originalName: signatureFilename
      };
    } else {
      const signedLocal = crypto.randomUUID() + ".pdf";
      const signatureLocal = crypto.randomUUID() + ".png";
      fs.writeFileSync(path.join(uploadDir, signedLocal), signedPdfBuffer);
      fs.writeFileSync(path.join(uploadDir, signatureLocal), signaturePng);

      signedPdf = { storage: "local", localName: signedLocal, originalName: signedFilename };
      signatureFile = { storage: "local", localName: signatureLocal, originalName: signatureFilename };
    }

    event.contractSignature = {
      signerName,
      signedAt,
      accepted: true,
      signedPdf,
      signatureFile
    };

    store.updateEvent(event);
    await backupStoreSafe();

    res.redirect(`/o/${event.code}/${event.organizerToken}?signed=1`);
  } catch (err) {
    console.error("Contract signature error:", err);
    res.status(500).send("Impossible de valider le contrat.");
  }
});

app.get("/o/:code/:token/invoice", async (req, res) => {
  const event = store.getEventByCode(req.params.code);

  if (!eventAvailable(event) || event.organizerToken !== req.params.token) {
    return res.status(404).send("Accès refusé.");
  }

  if (!event.invoice) return res.status(404).send("Aucune facture disponible.");

  const invoice = event.invoice;

  try {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(invoice.originalName || "facture.pdf")}`
    );

    if (invoice.storage === "drive" && invoice.driveFileId) {
      const stream = await drive.getFileStream(invoice.driveFileId);
      return stream.on("error", () => res.destroy()).pipe(res);
    }

    if (invoice.storage === "local" && invoice.localName) {
      return res.download(
        path.join(uploadDir, invoice.localName),
        invoice.originalName || "facture.pdf"
      );
    }

    res.status(404).end();
  } catch (err) {
    console.error("Invoice download error:", err);
    res.status(500).send("Téléchargement impossible.");
  }
});

/* API BORNE */
app.post("/api/events/:code/upload", upload.single("photo"), async (req, res) => {
  const event = store.getEventByCode(req.params.code);
  if (!eventAvailable(event)) {
    if (req.file) safeUnlink(req.file.path);
    return res.status(404).json({ ok: false, error: "event_unavailable" });
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
      safeUnlink(req.file.path);
    } else {
      record.storage = "local";
      record.localName = req.file.filename;
    }
    store.addPhoto(event.code, record);
    await backupStoreSafe();
    res.json({ ok: true, photo: record });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "upload_failed" });
  }
});

app.get("/health", (req, res) => res.json({ ok: true, version: "0.3.0" }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).send(err.message || "Erreur");
});


async function startServer() {
  try {
    if (drive.isConfigured()) {
      const restored = await drive.restoreEvents();
      if (restored && restored.length) {
        fs.writeFileSync(store.getDataFilePath(), JSON.stringify(restored, null, 2), "utf8");
        console.log(`Sauvegarde Drive restaurée : ${restored.length} événement(s).`);
      }
    }
  } catch (err) {
    console.error("Restore Drive backup failed:", err.message);
  }

  app.listen(PORT, () => console.log(`LOCATION PHOTOBOOTH 28 V5 lancé sur le port ${PORT}`));
}

startServer();

