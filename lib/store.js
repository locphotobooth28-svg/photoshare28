const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const DATA_FILE = path.join(__dirname, "..", "data", "events.json");

function ensureStore() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}

function writeEvents(events) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(events, null, 2), "utf8");
}

function calculateExpiry(date) {
  const d = date ? new Date(`${date}T23:59:59`) : new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString();
}

function readEvents() {
  ensureStore();
  const events = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  let changed = false;
  for (const event of events) {
    if (!event.organizerToken) {
      event.organizerToken = crypto.randomBytes(24).toString("hex");
      changed = true;
    }
    if (!event.expiresAt) {
      event.expiresAt = calculateExpiry(event.date);
      changed = true;
    }
    if (!Array.isArray(event.photos)) {
      event.photos = [];
      changed = true;
    }
    if (!Array.isArray(event.inventory)) {
      event.inventory = [];
      changed = true;
    }
    if (typeof event.depositReceived !== "boolean") {
      event.depositReceived = false;
      changed = true;
    }
    if (typeof event.invoicePaid !== "boolean") {
      event.invoicePaid = false;
      changed = true;
    }
    if (!Object.prototype.hasOwnProperty.call(event, "invoice")) {
      event.invoice = null;
      changed = true;
    }
    if (!Object.prototype.hasOwnProperty.call(event, "contract")) {
      event.contract = null;
      changed = true;
    }
    if (!Object.prototype.hasOwnProperty.call(event, "contractSignature")) {
      event.contractSignature = null;
      changed = true;
    }
  }
  if (changed) writeEvents(events);
  return events;
}

function slugify(text) {
  return String(text || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function createEvent({ name, date, type }) {
  const events = readEvents();
  const base = slugify(name) || "evenement";
  let code = `${base}-${String(date || "").replaceAll("-", "")}`;
  let suffix = 2, original = code;
  while (events.some(e => e.code === code)) code = `${original}-${suffix++}`;

  const event = {
    id: crypto.randomUUID(),
    name, date, type: type || "Événement", code,
    apiKey: crypto.randomBytes(24).toString("hex"),
    organizerToken: crypto.randomBytes(24).toString("hex"),
    createdAt: new Date().toISOString(),
    expiresAt: calculateExpiry(date),
    active: true,
    drive: null,
    photos: [],
    inventory: [],
    depositReceived: false,
    invoicePaid: false,
    invoice: null,
    contract: null,
    contractSignature: null
  };
  events.unshift(event);
  writeEvents(events);
  return event;
}

function getEventByCode(code) { return readEvents().find(e => e.code === code); }

function updateEvent(updated) {
  const events = readEvents();
  const index = events.findIndex(e => e.id === updated.id);
  if (index === -1) throw new Error("Événement introuvable");
  events[index] = updated;
  writeEvents(events);
  return updated;
}

function addPhoto(code, photo) {
  const event = getEventByCode(code);
  if (!event) throw new Error("Événement introuvable");
  event.photos.unshift(photo);
  return updateEvent(event);
}

function isExpired(event) {
  return new Date() > new Date(event.expiresAt);
}

function getDataFilePath() { ensureStore(); return DATA_FILE; }

module.exports = { readEvents, createEvent, getEventByCode, updateEvent, addPhoto, isExpired, getDataFilePath };
