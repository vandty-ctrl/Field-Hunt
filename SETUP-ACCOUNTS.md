# Turn on usernames and leaderboards

Field Hunt works without this. Points, levels and badges are saved on each phone. Doing this once lets people make a username and compete on shared weekly and all-time leaderboards.

It uses **Supabase**, a free service that stores the accounts and scores. It takes about 10 minutes and you only do it once.

## 1. Make a free Supabase account
1. Go to **supabase.com** and click **Start your project**.
2. Choose **Continue with GitHub** and sign in with your GitHub account.

## 2. Create a project
1. Click **New project**.
2. Name: `field-hunt`.
3. Database password: click **Generate a password**, then copy it somewhere safe. You won't need it for the app.
4. Region: pick the one closest to you.
5. Click **Create new project** and wait about 2 minutes while it sets up.

## 3. Create the leaderboard tables
1. In the left menu, click **SQL Editor**.
2. Click **New query**.
3. Open `setup.sql` from the Field Hunt folder, copy everything in it, and paste it into the big box.
4. Click **Run** (bottom right). You should see "Success. No rows returned".

## 4. Turn off email confirmation
Field Hunt accounts only need a username and password. No email is collected, which keeps kids' accounts private.
1. In the left menu, click **Authentication**.
2. Open **Sign In / Providers** (on some screens it's called **Providers**), then click **Email**.
3. Turn **Confirm email** OFF.
4. Click **Save**.

## 5. Copy your two keys
1. In the left menu, click **Project Settings** (gear icon), then **API** (it may be called **Data API** or **API Keys**).
2. Copy the **Project URL**. It looks like `https://abcdefgh.supabase.co`.
3. Copy the **anon public** key. Newer projects may call it the **publishable** key, starting with `sb_publishable_`. Either one works.
   Do **not** use the "service_role" or "secret" key.

## 6. Put the keys into the app
1. Go to your Field Hunt repository on GitHub and click **config.js**.
2. Click the **pencil** icon (Edit) at the top right of the file.
3. Paste your values between the quotes, like this:
   ```
   supabaseUrl: "https://abcdefgh.supabase.co",
   supabaseAnonKey: "eyJhbGciOi...your long key..."
   ```
4. Click **Commit changes**, then **Commit changes** again.
5. Wait for the green tick in the **Actions** tab, then close and reopen Field Hunt on your phone.

## 7. Try it
Open the **Me** tab, pick a username and password, and tap **Create account**. Your finds so far are added to the leaderboard automatically. Check the **Ranks** tab.

## Good to know
- The anon (publishable) key is meant to be public. The database rules in `setup.sql` stop anyone changing other players' scores.
- Only usernames, species names and points are shared. Photos and exact locations stay on each phone.
- There's no password reset, because no email is collected. Players should write their password down.
- For kids under 13, a parent should create the account and choose a username that isn't the child's real name.
