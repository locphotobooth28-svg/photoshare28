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
  if (!isConfigured()) {
    throw new Error("Google Drive OAuth n'est pas entièrement configuré.");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });

  return google.drive({
    version: "v3",
    auth: oauth2Client
  });
}

async function testConnection() {
  if (!isConfigured()) {
    return {
      ok: false,
      message: "Variables Google Drive OAuth manquantes."
    };
  }

  const drive = driveClient();
  const folderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

  const res = await drive.files.get({
    fileId: folderId,
    fields: "id,name,mimeType"
  });

  if (res.data.mimeType !== "application/vnd.google-apps.folder") {
    return {
      ok: false,
      message: "L'ID indiqué ne correspond pas à un dossier Google Drive."
    };
  }

  return {
    ok: true,
    folderId: res.data.id,
    folderName: res.data.name
  };
}

async function createFolder(name, parentId) {
  const drive = driveClient();

  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId]
    },
    fields: "id,name"
  });

  return res.data;
}

async function createEventFolders(event) {
  if (!isConfigured()) return null;

  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

  const eventFolder = await createFolder(
    `${event.date || "sans-date"} - ${event.name}`,
    root
  );

  const guests = await createFolder(
    "Invites",
    eventFolder.id
  );

  const booth = await createFolder(
    "Photobooth",
    eventFolder.id
  );

  const videos = await createFolder(
    "Videos",
    eventFolder.id
  );

  return {
    eventFolderId: eventFolder.id,
    guestsFolderId: guests.id,
    boothFolderId: booth.id,
    videosFolderId: videos.id
  };
}

async function uploadFile({
  localPath,
  filename,
  mimeType,
  folderId
}) {
  const drive = driveClient();

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId]
    },
    media: {
      mimeType,
      body: fs.createReadStream(localPath)
    },
    fields: "id,name,mimeType,webViewLink,thumbnailLink"
  });

  return res.data;
}

module.exports = {
  isConfigured,
  testConnection,
  createEventFolders,
  uploadFile
};
