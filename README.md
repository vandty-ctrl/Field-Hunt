# Field Hunt — put it on your iPhone

Field Hunt is a web app you install from Safari. It needs to live at an https:// web address first, because iPhone only allows location and camera on secure sites. Both options below are free and take about 5 minutes.

## Option A: Netlify Drop (easiest, needs a computer)
1. Unzip `field-hunt-app.zip` on your computer.
2. Go to https://app.netlify.com/drop and drag the whole `field-hunt-app` folder onto the page.
3. Netlify gives you a link like `https://something-random.netlify.app`. Make a free account when it asks, so the site doesn't expire.

## Option B: GitHub Pages
1. Create a free account at github.com and make a new public repository called `field-hunt`.
2. Click "uploading an existing file" and upload everything inside the folder (index.html, sw.js, manifest.webmanifest, the icons folder).
3. Go to Settings > Pages, set Source to "Deploy from a branch", choose `main` and `/ (root)`, then Save.
4. After a minute your app is at `https://YOUR-USERNAME.github.io/field-hunt/`.

## Install on iPhone
1. Open your link in **Safari** (not Chrome).
2. Tap the Share button, then **Add to Home Screen**, then **Add**.
3. Open Field Hunt from the Home Screen. Allow location when asked.

## Using it
- Tap **Use my location**, or type any park or place in the world and tap **Find**.
- Tick the boxes you want: reptiles, amphibians, fish, mammals, birds, plants, trees. Tick as many as you like.
- Pick a search radius and tap **Find species**.
- The satellite map shows recent sightings as coloured dots. Tap **Show on map** on any species to see only its sightings.
- Tap **I found it** to take your photo. Your finds show as yellow dots on the map and in **All my finds**.
- Know something lives there that isn't listed? Tap **+ Add a species**, type its name and pick it. It stays on your list whenever you search that area.

## Good to know
- Species, photos and map pins come from iNaturalist research-grade sightings. Rare or threatened species have their exact spots hidden by iNaturalist, so they may appear in the list without pins.
- "Trees" covers the main tree families (pines, oaks, eucalypts, palms and so on). Some shrubs in those families will show up too.
- Your photos are saved only on your phone, inside the app. Deleting the app deletes them.
- You need signal to search. The app itself opens offline once installed.
