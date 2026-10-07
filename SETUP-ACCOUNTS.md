# Turn on accounts, leaderboards and photo checking

> **Already set up from an earlier version?** You only need to do two things:
> 1. Run the new `setup.sql` again (step 3). It adds what's new (sightings, the shared field-guide table) and takes points away from any people, pets or farm animals already logged. Everything else is left alone.
> 2. Replace the code in your `verify-find` function with the new `verify-find.ts` and click **Deploy** again (step 8).
>
> **Updating for gallery photos:** only step 2 is needed. Open Edge Functions → `verify-find` → **Code**, delete everything, paste in the new `verify-find.ts`, and click **Deploy**.

Field Hunt works without this, with points and badges saved on each phone. Setting this up once gives you:
- **Usernames and leaderboards** (weekly and all-time)
- **Finds and photos saved to each player's account**, so they follow them to a new phone
- **AI photo checking**: Claude looks at every photo to confirm it shows the species claimed. Unsure photos earn half points, and wrong or faked photos earn none.
- **Sightings without a photo**, confirmed on the server against species records near the player's GPS position (half points)
- **Identify**: the species AI suggests what a photo or description shows
- **Field notes on every card**: habitat, diet, seasons and more, written once per species by the AI and shared with every player
- **Zoo and captive check**: every photo and sighting location is checked against OpenStreetMap for zoos, aquariums, wildlife parks, pet shops and shelters (no setup needed)

You'll use two free sign-ups: **Supabase** (stores accounts, scores and photos) and **Anthropic** (the photo checker, which costs a small amount per photo). Allow about 20 minutes. Menu names can move around a little; if a button isn't exactly where described, look for one with a similar name.

---

## Part A: Supabase (accounts, scores, photos)

### 1. Make a free account
1. Go to **supabase.com** and click **Start your project**.
2. Choose **Continue with GitHub** and sign in.

### 2. Create a project
1. Click **New project**, and name it `field-hunt`.
2. Database password: click **Generate a password**, then copy it somewhere safe. You won't need it for the app.
3. Pick the region closest to you and click **Create new project**. Wait about 2 minutes.

### 3. Create the tables and photo storage
1. Left menu: **SQL Editor**, then **New query**.
2. Open `setup.sql` from the Field Hunt folder, copy everything, and paste it in.
3. Click **Run**. You should see "Success. No rows returned".
   (If you ran an older `setup.sql` before, that's fine. Just run this new one too.)

### 4. Turn off email confirmation
Accounts use only a username and password. No email is collected, which keeps kids' accounts private.
1. Left menu: **Authentication**, then **Sign In / Providers** (sometimes just **Providers**), then **Email**.
2. Turn **Confirm email** OFF and click **Save**.

### 5. Copy your two keys
1. Left menu: **Project Settings** (gear icon), then **API** (may be called **Data API** or **API Keys**).
2. Copy the **Project URL**, which looks like `https://abcdefgh.supabase.co`.
3. Copy the **anon public** key (newer projects call it the **publishable** key, starting `sb_publishable_`).
   Never use the "service_role" or "secret" key in the app.

---

## Part B: Anthropic (the photo checker) — optional

**You can skip Part B and Part C's step 7.** Without an Anthropic key nothing is ever charged: photos are checked by location instead (the species must have been recorded within 10 km of where the photo was taken, plus the zoo check and the reused-photo check), Identify is hidden, and field notes come from Wikipedia. You still need step 8 (deploy the `verify-find` function), because it scores photos and sightings.

To switch the AI on later: do steps 6 and 7, then edit `config.js` on GitHub and change `aiFeatures: false` to `aiFeatures: true`.

## Part B: Anthropic (the photo checker)

### 6. Get an API key
1. Go to **console.anthropic.com** and sign up.
2. Open **Billing** and add a payment method or buy a small amount of credit.
3. Set a **monthly spend limit** (under **Limits** in Settings) so costs can never surprise you. Each photo check costs a fraction of a cent, and the app also caps each player at 80 checks a day.
4. Open **API Keys**, click **Create Key**, name it `field-hunt`, and copy it. It starts with `sk-ant-`. Keep it secret: it goes only into Supabase in the next step, never into the app files on GitHub.

---

## Part C: Connect the photo checker

### 7. Add the key to Supabase as a secret
1. In Supabase, left menu: **Edge Functions**, then **Secrets**.
2. Add a new secret with name `ANTHROPIC_API_KEY`, paste your Anthropic key as the value, and click **Save**.

### 8. Deploy the checker
1. Left menu: **Edge Functions**, then **Deploy a new function**, then **Via Editor**.
2. Name the function exactly: `verify-find`
3. Delete the sample code in the editor. Open `verify-find.ts` from the Field Hunt folder, copy everything, and paste it in.
4. Click **Deploy function**. Leave "Verify JWT" (or "Enforce JWT") switched ON, so only signed-in players can use it.

---

## Part D: Connect the app

### 9. Put your Supabase keys into the app
1. On GitHub, open your Field Hunt repository and click **config.js**.
2. Click the **pencil** icon (Edit).
3. Paste your values between the quotes:
   ```
   supabaseUrl: "https://abcdefgh.supabase.co",
   supabaseAnonKey: "your anon / publishable key"
   ```
4. Click **Commit changes** twice. Wait for the green tick in **Actions**, then close and reopen Field Hunt on your phone.

### 10. Try it
1. Open **Me**, pick a username and password, and tap **Create account**. Any guest finds on the phone move into the new account and get checked.
2. Photograph something. You'll see "Checking your photo…", then the result.

---

## Good to know
- **Privacy:** Photos are stored privately; only the player who took them can see them. The leaderboard shows only usernames, species counts and XP, never photos or locations.
- **Points are worked out on the server**, including how rare each species is nearby, so they can't be faked from the phone. The same photo can't be used twice, and photos of screens, books, toys, pets or zoo animals don't count.
- **No signal?** The photo is saved and gets checked automatically next time the app opens with signal.
- **No password reset** is possible, because no email is collected. Players should write their passwords down.
- **Kids under 13:** a parent should create the account and choose a username that isn't the child's real name.
- **Which AI model:** Photo checks use a fast, low-cost Claude model. Identify uses a stronger one for better identifications, and each identify costs roughly a cent or two. To change either, add a secret named `VISION_MODEL` or `IDENTIFY_MODEL` in Edge Functions > Secrets with the model name from console.anthropic.com. If Identify ever reports an AI error, that model name is the first thing to check.
- **Field notes** use the low-cost model and are written only once per species, the first time a signed-in player flips that card. After that every player, including guests, reads the saved copy for free. Each player can trigger at most 150 new write-ups a day.
- **Sightings** don't use the AI, so they're free. They're confirmed only by real GPS position: the player must be within 10 km of existing records of that species.
- **Costs:** Supabase's free tier covers a small community. The Anthropic bill depends on how many photos are checked; your spend limit caps it.
