# LOCATION PHOTOBOOTH 28 — Galerie événement V4

## Deux accès

### Invités
- ajout photos et vidéos ;
- consultation galerie ;
- clic photo => plein écran ;
- aucun bouton de téléchargement.

### Organisateur
- accès complet ;
- téléchargement photo par photo ;
- ZIP complet ;
- facture PDF ;
- inventaire matériel ;
- statut caution ;
- statut règlement facture ;
- lien invité ;
- QR Code invité ;
- téléchargement du QR Code PNG ;
- partage du lien invité par WhatsApp.

## Identité Location Photobooth 28
Les pages invité et organisateur affichent :
- LOCATION PHOTOBOOTH 28 ;
- www.locationphotobooth28.fr ;
- lien Facebook : https://www.facebook.com/location.photobooth.28/

## Durée
Accès invité et organisateur : 30 jours après l'événement.

## Google Drive
OAuth 2.0 :
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REFRESH_TOKEN
- GOOGLE_DRIVE_ROOT_FOLDER_ID

## Important
Les captures d'écran ne peuvent pas être empêchées de façon fiable dans un navigateur web.

Les métadonnées événements/inventaires/statuts utilisent encore `data/events.json`.
Avant une utilisation commerciale à grande échelle, passer ces données sur un stockage persistant.


## V4.1 — Matériel à cocher
L'administrateur choisit le matériel et les options via des cases à cocher. L'organisateur ne voit que les éléments sélectionnés.


## V5 — nouveautés

- dépôt d'un contrat PDF par l'administrateur ;
- consultation du contrat dans l'espace organisateur ;
- signature simple au doigt ou à la souris ;
- nom du signataire + date/heure ;
- génération d'un nouveau PDF contenant le contrat original + une page de validation/signature ;
- contrat signé sauvegardé dans Google Drive ;
- sauvegarde automatique des métadonnées événements dans Google Drive ;
- restauration automatique des événements depuis Google Drive au démarrage.

### Important sur la signature
Le mécanisme fourni est une **signature/validation électronique simple interne**.
Il ne constitue pas une signature électronique qualifiée eIDAS et ne remplace pas un prestataire de signature certifié si un niveau de preuve juridique supérieur est nécessaire.
