# PhotoShare 28 — MVP

Première version déployable de la galerie collaborative de Location Photobooth 28.

## Fonctionnalités incluses

- Connexion administrateur
- Tableau de bord
- Création d'événements
- QR Code automatique
- Page mobile pour les invités
- Upload photos et vidéos
- Galerie en mode stockage local
- Endpoint API protégé par clé pour les bornes
- Support Google Drive déjà préparé (OAuth + dossiers + uploads)

## Lancer en local

1. Installer Node.js 20+
2. Copier `.env.example` vers `.env`
3. Modifier au minimum :
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `SESSION_SECRET`
4. Exécuter :

```bash
npm install
npm start
```

Puis ouvrir `http://localhost:3000/admin/login`.

## Déploiement Render

Build command :

```bash
npm install
```

Start command :

```bash
npm start
```

Variables d'environnement obligatoires :

- `APP_URL` = l'URL publique Render, par exemple `https://photoshare28.onrender.com`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`

## Important — stockage Render

Le stockage local de cette V1 sert uniquement au test. Sur un hébergement Render sans disque persistant, les fichiers et le JSON local peuvent disparaître lors d'un redéploiement ou redémarrage.

La prochaine étape consiste donc à activer Google Drive pour les médias et une base de données persistante pour les métadonnées.

## Google Drive

Variables prévues :

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID`

Quand elles sont renseignées, PhotoShare 28 crée automatiquement :
- un dossier événement,
- `Invites`,
- `Photobooth`,
- `Videos`.

## API borne

Une fois un événement créé, sa page admin affiche :

- l'URL API
- la clé `X-API-Key`

Exemple :

```bash
curl -X POST \
  -H "X-API-Key: VOTRE_CLE" \
  -F "source=Nina" \
  -F "photo=@photo.jpg" \
  https://votre-domaine.fr/api/events/code-evenement/upload
```

## Prochaine étape recommandée

1. Déployer cette V1 sur Render.
2. Créer `Lydie & Johan`.
3. Tester le QR Code depuis un téléphone.
4. Tester un upload.
5. Brancher Google Drive.
6. Remplacer le stockage JSON par PostgreSQL.
7. Connecter les photobooths.
