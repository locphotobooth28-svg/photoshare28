const fs = require("fs");
const { google } = require("googleapis");

function isConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN &&
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID
  );
}

function driveClient() {
  if (!isConfigured()) throw new Error("Google Drive OAuth n'est pas entièrement configuré.");
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: "v3", auth: oauth2Client });
}

async function testConnection() {
  if (!isConfigured()) return { ok: false, message: "Variables Google Drive OAuth manquantes." };
  const drive = driveClient();
  const folderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const res = await drive.files.get({ fileId: folderId, fields: "id,name,mimeType" });
  if (res.data.mimeType !== "application/vnd.google-apps.folder") {
    return { ok: false, message: "L'ID indiqué ne correspond pas à un dossier Google Drive." };
  }
  return { ok: true, folderId: res.data.id, folderName: res.data.name };
}

async function createFolder(name, parentId) {
  const drive = driveClient();
  const res = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id,name"
  });
  return res.data;
}

async function createEventFolders(event) {
  if (!isConfigured()) return null;
  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const eventFolder = await createFolder(`${event.date || "sans-date"} - ${event.name}`, root);
  const guests = await createFolder("Invites", eventFolder.id);
  const booth = await createFolder("Photobooth", eventFolder.id);
  const videos = await createFolder("Videos", eventFolder.id);
  const documents = await createFolder("Documents", eventFolder.id);
  return {
    eventFolderId: eventFolder.id,
    guestsFolderId: guests.id,
    boothFolderId: booth.id,
    videosFolderId: videos.id,
    documentsFolderId: documents.id
  };
}

async function uploadFile({ localPath, filename, mimeType, folderId }) {
  const drive = driveClient();
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: fs.createReadStream(localPath) },
    fields: "id,name,mimeType,size,webViewLink,thumbnailLink"
  });
  return res.data;
}

async function getFileStream(fileId) {
  const drive = driveClient();
  const response = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
  return response.data;
}


async function uploadBuffer({ buffer, filename, mimeType, folderId }) {
  const { Readable } = require("stream");
  const drive = driveClient();
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: "id,name,mimeType,size"
  });
  return res.data;
}

async function getFileBuffer(fileId) {
  const drive = driveClient();
  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(response.data);
}

async function findFileByName(name, parentId) {
  const drive = driveClient();
  const escaped = name.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `name='${escaped}' and '${parentId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType,modifiedTime)",
    pageSize: 10
  });
  return res.data.files?.[0] || null;
}

async function upsertJsonFile({ name, object, folderId }) {
  const drive = driveClient();
  const existing = await findFileByName(name, folderId);
  const body = Buffer.from(JSON.stringify(object, null, 2), "utf8");
  const { Readable } = require("stream");

  if (existing) {
    const res = await drive.files.update({
      fileId: existing.id,
      media: {
        mimeType: "application/json",
        body: Readable.from(body)
      },
      fields: "id,name,modifiedTime"
    });
    return res.data;
  }

  const res = await drive.files.create({
    requestBody: { name, parents: [folderId] },
    media: {
      mimeType: "application/json",
      body: Readable.from(body)
    },
    fields: "id,name,modifiedTime"
  });
  return res.data;
}

async function backupEvents(events) {
  if (!isConfigured()) return null;
  return upsertJsonFile({
    name: "_LOCATION_PHOTOBOOTH_28_EVENTS_BACKUP.json",
    object: {
      version: 1,
      updatedAt: new Date().toISOString(),
      events
    },
    folderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID
  });
}

async function restoreEvents() {
  if (!isConfigured()) return null;
  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const existing = await findFileByName("_LOCATION_PHOTOBOOTH_28_EVENTS_BACKUP.json", root);
  if (!existing) return null;
  const buffer = await getFileBuffer(existing.id);
  const parsed = JSON.parse(buffer.toString("utf8"));
  return Array.isArray(parsed.events) ? parsed.events : null;
}

module.exports = {
  isConfigured,
  testConnection,
  createEventFolders,
  uploadFile,
  uploadBuffer,
  getFileStream,
  getFileBuffer,
  backupEvents,
  restoreEvents
};
