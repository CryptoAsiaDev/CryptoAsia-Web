# Crypto Asia website

Upload everything in this folder to the GitHub repo (keep the folder structure). Do NOT upload `news.json` if you already have one live: the news bot owns that file.

## Pages
index, news, jobs, airdrop-calculator, nft-studio, inheritance, fortune. `shared.css` / `shared.js` hold the menu, footer and the light/dark switch. The menu order is the LINKS list at the top of `shared.js`.

## Automatic news (news.html)
1. Files: `news.html`, `scripts/` folder, `.github/workflows/news.yml`.
2. Repo > Settings > Secrets and variables > Actions > New repository secret: `ANTHROPIC_API_KEY`.
3. Actions tab > "Update crypto news" > Run workflow. It then runs by itself every ~30 minutes.
4. Thumbnails: the bot saves each article's own preview image; `news.html` shows it (credited to the source) and falls back to a Crypto Asia graphic. To turn publisher images off, set `SHOW_SOURCE_IMAGES = false` in `news.html`.
5. Airdrop stories get the "Airdrops" category automatically. Feeds are listed in `scripts/feeds.json`.

## Jobs board with wallet login and USDC fee (jobs.html)
Works in three layers: the page (wallet connect, sign, pay), a Supabase database, and a verifier bot that confirms the payment on-chain before a listing goes public.
1. Create a free project at supabase.com. SQL Editor > paste `supabase/schema.sql` > Run.
2. In Supabase > Project Settings > API copy the Project URL, the `anon` public key and the `service_role` key.
3. Edit `jobs-config.json`: set `receiver` (your public EVM address that receives the fees), `supabaseUrl`, `supabaseKey` (the anon key only) and the fees. Check the receiver address twice; payments cannot be reversed.
4. GitHub repo > Settings > Secrets > Actions: add `SUPABASE_SERVICE_KEY` (the service_role key). Never put this key in any website file.
5. Upload `scripts/verify-submissions.mjs` and `.github/workflows/verify.yml`. Actions > "Verify job submissions" > Run workflow. It then runs every ~15 minutes.
6. Test with the smallest fee first (set the fee to 1) using your own wallet on one chain before announcing.
To take a listing down: Supabase > Table editor > submissions > set `hidden` to true.
Curated jobs you add yourself still go in `jobs.json`.

## NFT Studio (nft-studio.html)
Runs fully in the browser. Needs internet for the zip library (cdnjs). Free, no login. Max 5,000 NFTs per run.

## Homepage sections removed
The removed sections (Venture/Collect/Build, Our HODL, What We've Built, Token Portfolio) are saved in `homepage-sections-backup.html` (kept outside this folder; do not upload it).
