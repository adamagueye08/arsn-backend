# ARSN — Backend (API + base de données)

Backend Node.js / TypeScript / PostgreSQL pour la gestion des demandes d'autorisation de l'ARSN.
Aucune dépendance à un service payant (Lovable, Supabase...) : tout tourne en local ou sur le serveur de ton choix.

## Stack technique

- **Node.js 20+** / **TypeScript**
- **Express** — serveur HTTP / API REST
- **PostgreSQL** — base de données
- **Prisma** — ORM + migrations (le schéma complet est dans `prisma/schema.prisma`)
- **JWT** — authentification par jeton, avec rôles
- **bcryptjs** — hachage des mots de passe

## Rôles gérés

`DEMANDEUR`, `SUPER_ADMIN`, `ADMIN_FONCTIONNEL`, `AGENT_INSTRUCTEUR`, `CHEF_SERVICE`, `DIRECTEUR`, `SIGNATAIRE`
(voir `prisma/schema.prisma`, enum `Role`).

## 1. Installer PostgreSQL en local

**Option simple (recommandée) : Docker**

```bash
docker compose up -d
```

Ça démarre un PostgreSQL local sur le port 5432 (identifiants déjà dans `.env.example`).

**Sans Docker** : installe PostgreSQL directement (`postgresql.org/download`), puis crée une base `arsn_db` et un utilisateur `arsn`.

## 2. Configurer le projet

```bash
npm install
cp .env.example .env
# Ouvre .env et vérifie DATABASE_URL, puis change JWT_SECRET par une chaîne aléatoire longue
```

## 3. Créer les tables (migration)

```bash
npm run prisma:migrate
```

Ça crée toutes les tables décrites dans `prisma/schema.prisma` (utilisateurs, demandes, types
d'autorisation, workflow, pièces justificatives, notifications, audit...).

## 4. Charger les données de départ

```bash
npm run seed
```

Ça crée :
- un compte **Super Administrateur** (`admin@arsn.sn` / mot de passe affiché dans la console — à changer immédiatement)
- les 4 types d'autorisation de base (Importation, Exportation, Détention et utilisation, Transport) avec un workflow à 3 étapes

## 5. Lancer le serveur en développement

```bash
npm run dev
```

L'API est disponible sur `http://localhost:4000/api`. Test rapide :

```bash
curl http://localhost:4000/api/health
```

## Principales routes

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/auth/register` | Créer un compte demandeur |
| POST | `/api/auth/login` | Connexion (tous rôles) |
| GET | `/api/auth/me` | Profil de l'utilisateur connecté |
| POST | `/api/demandes` | Créer une demande (brouillon) |
| PUT | `/api/demandes/:id` | Modifier un brouillon |
| POST | `/api/demandes/:id/pieces` | Joindre des pièces justificatives |
| POST | `/api/demandes/:id/submit` | Soumettre la demande |
| GET | `/api/demandes` | Lister mes demandes (ou toutes, si agent) |
| GET | `/api/demandes/:id` | Détail d'une demande |
| POST | `/api/demandes/:id/complement` | Répondre à une demande de complément |
| POST | `/api/demandes/:id/renouveler` | Demander un renouvellement |
| POST | `/api/demandes/:id/messages` | Message dans le fil de la demande |
| GET | `/api/demandes/echeances/proches` | Autorisations arrivant à expiration |
| GET | `/api/admin/demandes` | Toutes les demandes (agents) + recherche |
| POST | `/api/admin/demandes/:id/valider` | Valider un dossier |
| POST | `/api/admin/demandes/:id/rejeter` | Rejeter un dossier |
| POST | `/api/admin/demandes/:id/retourner` | Demander un complément au demandeur |
| POST | `/api/admin/demandes/:id/affecter` | Affecter/réaffecter un instructeur |
| GET | `/api/admin/dashboard` | Statistiques du tableau de bord |
| GET | `/api/admin/users` | Liste des utilisateurs |
| PATCH | `/api/admin/users/:id` | Modifier rôle / activer-désactiver |
| GET | `/api/admin/audit` | Journal d'audit (Super Admin uniquement) |
| GET/POST | `/api/admin/types-autorisation` | Paramétrage des types d'autorisation |

## Ce qui reste à brancher (prévu dans le modèle de données, pas encore implémenté)

Ces éléments ont leur table/champ prêt dans le schéma Prisma, mais nécessitent un choix de
prestataire externe de ta part avant implémentation :

- **Génération de PDF signé + QR code** (`AutorisationDelivree`) — libs déjà installées (`pdfkit`, `qrcode`), reste à écrire le service de génération.
- **Envoi d'e-mails / SMS** (`Notification`) — brancher un fournisseur (Resend, SMTP institutionnel, Twilio, ou opérateur local) via les clés dans `.env`.
- **Rappels automatiques d'échéance** — un job planifié (cron) qui interroge `/demandes/echeances/proches` pour chaque demandeur et déclenche une notification.
- **Sauvegarde et restauration de la base** — à mettre en place au niveau de l'hébergeur PostgreSQL (`pg_dump` planifié).

## Pousser ce projet sur GitHub

```bash
git init
git add .
git commit -m "Initial commit - backend ARSN"
git branch -M main
git remote add origin https://github.com/<ton-compte>/arsn-backend.git
git push -u origin main
```

⚠️ Vérifie bien que `.env` n'est **jamais** commité (il est déjà dans `.gitignore`) — il contient
des secrets (mot de passe base de données, clé JWT).

## Prochaines étapes suggérées

1. Définir précisément `formulaireSchema` et `piecesRequises` pour chaque type d'autorisation avec l'ARSN (actuellement vides, créés par le seed).
2. Brancher ce backend au frontend existant (`arsn-senegal` sur GitHub) via son URL d'API (`VITE_API_URL` ou équivalent côté frontend).
3. Choisir un hébergement pour la production (ex : un VPS avec Docker, ou un service PaaS acceptant Node + PostgreSQL).
4. Mettre en place les sauvegardes automatiques et un nom de domaine propre pour l'API (ex : `api.arsn.sn`).
