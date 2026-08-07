const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_FILE = path.join(__dirname, "..", "data", "events.json");

function ensureStore() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}

function readEvents() {
  ensureStore();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeEvents(events) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(events, null, 2), "utf8");
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
  if (!date) code = `${base}-${Date.now()}`;
  let suffix = 2;
  const original = code;
  while (events.some(e => e.code === code)) code = `${original}-${suffix++}`;

  const event = {
    id: crypto.randomUUID(),
    name,
    date,
    type: type || "Événement",
    code,
    apiKey: crypto.randomBytes(24).toString("hex"),
    createdAt: new Date().toISOString(),
    active: true,
    drive: null,
    photos: []
  };

  events.unshift(event);
  writeEvents(events);
  return event;
}

function getEventByCode(code) {
  return readEvents().find(e => e.code === code);
}

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

module.exports = {
  readEvents,
  createEvent,
  getEventByCode,
  updateEvent,
  addPhoto
};
