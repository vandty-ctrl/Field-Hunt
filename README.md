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
- **Hunt:** Tap **Near me** or type any park or place in the world. Tap **Hunt for** to choose groups in three sections: animals with backbones (reptiles, amphibians, fish, birds, mammals), bugs and other invertebrates (insects, spiders & kin, crustaceans, snails & shellfish, millipedes & worms), and plants & fungi (plants, trees, fungi). Each section has an **All** button. Then, choose a distance in km or miles, and tap **Start the hunt**.
- **Field cards:** Each species is a card rated Common, Uncommon, Rare, Epic or Legendary, based on how rarely it's been recorded nearby. Rarer cards are worth more XP.
- **Flip cards:** Tap any card, found or not, and it flips over to its field guide: taxonomy from kingdom to species, field notes (habitat, diet or growth, breeding or flowering season, size, male vs female, lifespan, a fun fact, and safety warnings), a "when to look" chart of sightings by month near you (plus flowering months for plants), and example photos of males and females. Tap the card again to flip back.
- **Collect:** On the card, tap **I found it! Take a photo**. Bonus XP for your first find of the day and for exploring a new area.
- **Saw it, but no photo:** Too fast to photograph? Tap a card, then **Saw it, but no photo**. Your phone's GPS position is checked against iNaturalist and GBIF records within 10 km. A confirmed sighting earns half points. Add a photo later to upgrade it to full points. Sightings show on the map as yellow rings.
- **Identify something:** Don't know what it is? Tap **Identify something**, then snap or choose a photo, or describe it. The species AI suggests the likeliest matches for where you are, with reference photos. Tap **This is it** to add it to your cards and collect it. (Needs an account.)
- **Add a species:** Know something lives there that isn't listed? Tap **+ Add a species you know is here**.
- **Map:** Satellite map of recorded sightings, coloured by group. Your finds show as yellow dots. **Show on map** on any card shows just that species.
- **Journal:** Your stats, 19 badges, and all your photos.
- **Ranks:** Weekly and all-time leaderboards (needs accounts switched on).
- **Me:** Create an account or sign in, and switch between km and miles.

## Safety warnings
- Cards for anything that can hurt people show a coloured warning on the front: yellow for **Caution**, orange for **Danger**, red for **Extreme danger**, with the hazard (venomous, poisonous, stings, bites, can attack, skin irritant, carries disease) and how far back to stay.
- The back of the card opens with a **Safety** section: what each hazard means, the distance in metres and feet, what to do, and the emergency and poison-help numbers for the country you're in.
- Before photographing a dangerous species, the card reminds players to stay back and use the camera's zoom, or log a sighting instead.
- Warnings come from built-in rules for well-known hazards (venomous snakes and spiders, scorpions, wasps, stingrays, bears, bison, crocodiles, cassowaries, poison ivy, deadly mushrooms and more). The AI field notes can add extra warnings but can never lower one.
- Distances follow common park and wildlife-agency guidance. Always follow local signs and rangers.

## Wild species only
- People, pets and farm animals (cats, dogs, cattle, horses, sheep, goats, domestic pigs, poultry and so on) never appear and can't be collected.
- Records from zoos, botanical-garden collections and farms are left out of the species lists.
- Every photo and sighting is checked against OpenStreetMap: if you're inside a zoo, aquarium, wildlife park, petting farm, pet shop or animal shelter (or, for plants, a botanical garden or nursery), it scores 0.
- The photo checker also rejects pets, people, cages, tanks, enclosures and animals being held.

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
