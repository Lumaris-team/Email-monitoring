# Email-monitoring-worker

Ce dépôt contient un Cloudflare Worker pour recevoir et stocker les emails reçus via Email Routing.

Structure:
- `src/` : code source du worker
- `wrangler.toml` : configuration pour Cloudflare Wrangler
- `src/schema.sql` : schéma D1 (table `emails`)

Fonctionnalités principales:
- Supporte réception d'emails (POST) depuis Email Routing
- Support des sous-domaines (chaque sous-domaine mappe à une base D1)
- Stocke un maximum d'informations d'un email dans une table D1

Déploiement (exemple):
1. Remplir `wrangler.toml` (remplacer `account_id`, `zone_id` et le binding D1)
2. Installer dépendances: `npm install`
3. Déployer: `npm run deploy`

Notes:
- Le projet est conçu pour être compatible avec l'architecture du repo `Client-worker` de l'organisation.
- Adaptations spécifiques: une table D1 `emails` pour sauvegarder toutes les informations reçues.
