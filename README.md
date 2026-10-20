# cupcake.gg

Site de statistiques League of Legends qui réunit les fonctions principales d'op.gg, DeepLoL et League of Graphs : profil, historique détaillé, partie en direct, tier list, classement, multi-recherche et encyclopédie. Thème sombre et thème clair noir et blanc.

## Démarrer

1. Installe [Node.js](https://nodejs.org) version 18 ou plus récente.
2. Ouvre un terminal dans ce dossier.
3. Lance :

   ```
   npm start
   ```

4. Ouvre http://localhost:3000 dans ton navigateur.

Aucune installation de dépendances n'est nécessaire (`npm install` est inutile).

Sous Windows, double-clique sur `demarrer.bat` : il lance le serveur et ouvre le navigateur. Si PowerShell refuse `npm start` (« l'exécution de scripts est désactivée »), lance `node server.js` à la place.

## Clé API Riot

La clé se trouve dans le fichier `.env` :

```
RIOT_API_KEY=RGAPI-...
```

- Une clé de **développement expire après 24 heures**. Quand le site affiche « Clé API Riot refusée », génère une nouvelle clé sur https://developer.riotgames.com, colle-la dans `.env`, puis relance `npm start`.
- La clé reste sur le serveur local : le navigateur ne la reçoit jamais.
- Ne publie jamais le fichier `.env` (il est déjà exclu par `.gitignore`).
- Une clé de développement est réservée à un usage personnel. Pour mettre le site en ligne, demande une clé « Personal » ou « Production » à Riot.

## Fonctionnalités

| Page | Contenu |
| --- | --- |
| Recherche | Une seule barre pour les joueurs (Nom#TAG) et les champions, au clavier. `Ctrl K` ou `/` l'ouvre depuis n'importe quelle page |
| Accueil | Recherche, meilleurs champions du patch par rôle, rotation gratuite, favoris, recherches récentes, état du serveur |
| Profil | Rangs Solo/Duo et Flex avec emblèmes, nombre de parties jouées cette saison (toutes files, depuis le patch 26.1), résumé des parties, champions récents, joueurs croisés souvent, bouton « Mettre à jour » |
| Historique | Filtres par file, chargement par 10, score de performance sur 10 avec MVP et ACE, objets, sorts, runes, les 10 joueurs |
| Détail d'une partie | Tableau complet des deux équipes et objectifs, comparaison des dégâts, de l'or, du farm et de la vision, chronologie avec écart d'or, ordre d'achat et ordre des compétences |
| Champions (profil) | Statistiques par champion triables : parties, victoires, KDA, CS/min, dégâts/min, or/min, vision |
| Maîtrise | Tous les champions avec niveau et points |
| Partie en direct | Composition, bannissements, rangs et taux de victoire des 10 joueurs, chronomètre |
| Tier list | Taux de victoire, de sélection et de bannissement par rôle, tiers S à D, par patch |
| Fiche champion | Build du patch actuel : objets de départ, bottes et 3 premiers objets dans l'ordre avec leur winrate, builds alternatifs, options d'objets par rang d'achat, variantes de runes (une page par clé de voûte jouée, avec winrate), sorts, ordre des compétences, matchups. Onglet « Meilleurs joueurs » : dernières parties Challenger, GM et pros avec leur build. Aussi compétences, statistiques, skins (sans les chromas) et histoire |
| Classement | Challenger, Grand Maître et Maître, Solo/Duo et Flex, par région |
| Multi-recherche | Colle le chat du salon pour analyser jusqu'à 10 joueurs |
| Encyclopédie | Objets (avec recettes), runes, sorts d'invocateur |

### Tier list et builds : comment ils sont calculés

Riot ne fournit pas de statistiques globales par champion. cupcake.gg construit donc son propre échantillon : le bouton « Analyser 150 parties » lit les parties classées Solo/Duo du patch actuel jouées par les Challenger, Grand Maître et pros suivis de la région choisie, avec leur chronologie (ordre d'achat, compétences). Les résultats sont enregistrés dans `data/` et s'enrichissent à chaque analyse. Chaque partie coûte 2 requêtes : avec une clé de développement, 150 parties prennent environ 9 minutes. Plus l'échantillon est grand, plus les winrates sont fiables.

**Pros suivis.** Riot ne dit pas quel compte appartient à quel pro. Ajoute leurs Riot ID dans le panneau « Pros suivis » de la tier list : leurs parties sont lues en premier et marquées d'un badge d'équipe dans les builds.

**Emblèmes de rang.** Les emblèmes officiels sont inclus dans `public/ranks/` : aucun téléchargement n'est nécessaire.

## Limites de débit

Une clé de développement autorise 20 requêtes par seconde et 100 requêtes toutes les 2 minutes. Le serveur met les requêtes en file d'attente et garde un cache, donc un profil déjà consulté se recharge sans requête. Quand la limite est atteinte, les chargements attendent quelques secondes au lieu d'échouer.

Ordre de grandeur : un profil coûte environ 16 requêtes, un salon complet en multi-recherche environ 50.

## Réglages (`.env`)

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `RIOT_API_KEY` | Clé Riot | aucune |
| `DEFAULT_PLATFORM` | Région au premier lancement (`euw1`, `eun1`, `na1`, `kr`…) | `euw1` |
| `PORT` | Port du site | `3000` |
| `HOST` | `0.0.0.0` pour ouvrir le site aux autres appareils du réseau local | `127.0.0.1` |
| `DDRAGON_LANG` | Langue des données du jeu (`fr_FR`, `en_US`…) | `fr_FR` |
| `SEASON_START` | Début de la saison pour le compteur de parties | `2026-01-08` |
| `AUTO_META_HOURS` | Analyse automatique des builds toutes les N heures (0 = désactivée) | `6` |
| `AUTO_META_GAMES` | Parties ajoutées à chaque analyse automatique | `100` |
| `AUTO_META_PLATFORMS` | Régions analysées automatiquement (`euw1,kr`…) | région par défaut |
| `AUTO_META_MODES` | Modes analysés : `sr,aram,chaos,arena` | `sr` |
| `RIOT_RATE_LIMITS` | Limites de ta clé, format `requêtes:secondes` | `20:1,100:120` |

## Structure

```
server.js            serveur Node (API Riot, cache, limiteur, tier list)
public/index.html    page unique
public/style.css     thèmes sombre et clair
public/js/           application (routeur, vues)
public/fonts/        polices Chakra Petch et Figtree (licence OFL)
data/                cache Data Dragon et échantillons de tier list (créé au lancement)
```

## Mentions

cupcake.gg n'est pas approuvé par Riot Games et ne reflète pas les opinions de Riot Games ni de quiconque officiellement impliqué dans la production ou la gestion des propriétés de Riot Games. Riot Games et toutes les propriétés associées sont des marques commerciales ou des marques déposées de Riot Games, Inc.


## Héberger gratuitement : Render + Cloudflare R2

Render gratuit efface le disque à chaque redémarrage. Avec R2, le serveur sauvegarde `data/` sur Cloudflare (10 Go gratuits) et le restaure au démarrage.

Variables à définir sur Render : `RIOT_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (et facultatif `R2_PREFIX`, défaut `cupcake/`).

## Maquette sur Render gratuit (sans stockage externe)

1. En local, lance `node server.js` puis « Analyser 150 parties » (ou 400) dans la tier list.
2. Copie `data/meta2-euw1.json` (et `data/pros.json` si tu suis des pros) dans le dossier `seed/`.
3. Envoie le projet sur GitHub (le dossier `seed/` est inclus, `data/` et `.env` non).
4. Sur Render, les données de `seed/` sont chargées à chaque démarrage : la tier list et les builds sont visibles tout de suite.
