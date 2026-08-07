# PhotoShare 28 — version compte de service Google Drive

Cette version utilise un **compte de service Google**, sans Refresh Token.

## Variables Render à garder

- `APP_URL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID`

Vous pouvez supprimer :
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_FOLDER_ID`

## Configuration

1. Partager le dossier Google Drive `PhotoShare 28` avec l'adresse e-mail du compte de service, rôle **Éditeur**.
2. Copier seulement l'ID du dossier dans `GOOGLE_DRIVE_ROOT_FOLDER_ID`.
3. Ouvrir le fichier JSON du compte de service dans le Bloc-notes.
4. Copier le contenu JSON complet dans `GOOGLE_SERVICE_ACCOUNT_JSON` dans Render.
5. Cliquer sur `Save, rebuild and deploy`.
6. Dans PhotoShare 28, cliquer sur `Tester Google Drive`.

## Résultat attendu

Lors de la création d'un événement, PhotoShare 28 crée automatiquement :

- `AAAA-MM-JJ - Nom de l'événement`
  - `Invites`
  - `Photobooth`
  - `Videos`

Les photos envoyées par les invités vont dans `Invites`.
L'API borne envoie dans `Photobooth`.

## Sécurité

Le JSON du compte de service contient une clé privée.
Ne jamais l'ajouter à GitHub.
Ne jamais le publier.
Le conserver uniquement dans les secrets Render.
