# Field Hunt

A nature-hunting game for adults and kids. Find the wildlife and plants around you, photograph them, and collect them as cards.

## What's in this folder
| File | What it is | Where it goes |
|---|---|---|
| index.html | The app | GitHub |
| sw.js | Lets the app open offline | GitHub |
| manifest.webmanifest | Home Screen name and colours | GitHub |
| config.js | Your Supabase keys (blank until you set up accounts) | GitHub |
| icon-192.png, icon-512.png, apple-touch-icon.png, maskable-512.png | App icons | GitHub |
| setup.sql | Creates the account tables and photo storage | Paste into Supabase |
| verify-find.ts | The AI photo checker | Paste into a Supabase Edge Function |
| SETUP-ACCOUNTS.md | Step-by-step guide to switch on accounts and photo checking | Read it |
| README.md | This file | GitHub (optional) |

## Updating the app on GitHub
1. On your repository page, click **Add file → Upload files**.
2. Drag in every file from this folder, **except config.js if you've already put your keys in it** (uploading the blank one would wipe them).
3. Click **Commit changes**.
4. Wait for the green tick in the **Actions** tab.
5. On your iPhone, close Field Hunt fully and reopen it. Do this twice if the new version doesn't show.

## Installing on iPhone
Open your GitHub Pages link in **Safari**, tap **Share → Add to Home Screen → Add**, then open Field Hunt and allow location.

## How to play
- **Hunt:** Tap **Near me** or type any park or place in the world. Tick what to hunt for (reptiles, amphibians, fish, mammals, birds, plants, trees), choose a distance in km or miles, and tap **Start the hunt**.
- **Field cards:** Each species is a card rated Common, Uncommon, Rare, Epic or Legendary, based on how rarely it's been recorded nearby. Rarer cards are worth more XP.
- **Collect:** Tap a card, then **I found it! Take a photo**. Bonus XP for your first find of the day and for exploring a new area.
- **Saw it, but no photo:** Too fast to photograph? Tap a card, then **Saw it, but no photo**. Your phone's GPS position is checked against iNaturalist and GBIF records within 10 km. A confirmed sighting earns half points. Add a photo later to upgrade it to full points. Sightings show on the map as yellow rings.
- **Identify something:** Don't know what it is? Tap **Identify something**, then snap or choose a photo, or describe it. The species AI suggests the likeliest matches for where you are, with reference photos. Tap **This is it** to add it to your cards and collect it. (Needs an account.)
- **Add a species:** Know something lives there that isn't listed? Tap **+ Add a species you know is here**.
- **Map:** Satellite map of recorded sightings, coloured by group. Your finds show as yellow dots. **Show on map** on any card shows just that species.
- **Journal:** Your stats, 16 badges, and all your photos.
- **Ranks:** Weekly and all-time leaderboards (needs accounts switched on).
- **Me:** Create an account or sign in, and switch between km and miles.

## Where the species come from
- **iNaturalist:** community sightings confirmed by other naturalists.
- **GBIF:** museum collections, wildlife surveys, eBird and national species atlases.

## Accounts and photo checking
Without setup, everyone plays as a guest, with progress saved on their phone. Follow **SETUP-ACCOUNTS.md** to switch on:
- Usernames (no email needed) and leaderboards
- Finds and photos saved to each account, so they follow players to a new phone
- AI photo checking: a clear match earns full XP, an unsure photo earns half, and a wrong or faked photo earns none
- Sightings checked against GPS location on the server
- The Identify tool
- Guest finds moving into the account when someone signs up

## Good to know
- Photos are private to the player who took them. The leaderboard shows only usernames, species counts and XP.
- Rare and threatened species sometimes have their exact locations hidden by the databases to protect them.
- Look, don't touch. Keep well back from snakes and wild animals, and stay on trails.
