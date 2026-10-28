# Crypto Asia website

Upload everything in this folder to the GitHub repo (keep the folder structure). Do NOT upload `news.json` if you already have one live: the news bot owns that file.

## Pages
index, news, jobs, airdrop-calculator, nft-studio, inheritance, fortune. `shared.css` / `shared.js` hold the menu, footer and the light/dark switch. The menu order is the LINKS list at the top of `shared.js`.

## Automatic news (now the front page, index.html; news.html redirects to it)
1. Files: `index.html`, `scripts/` folder, `.github/workflows/news.yml`.
2. Repo > Settings > Secrets and variables > Actions > New repository secret: `ANTHROPIC_API_KEY`.
3. Actions tab > "Update crypto news" > Run workflow. It then runs by itself every ~30 minutes.
4. Thumbnails: the bot saves each article's own preview image; `index.html` shows it (credited to the source) and falls back to a Crypto Asia graphic. To turn publisher images off, set `SHOW_SOURCE_IMAGES = false` in `news.html`.
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
Connect wallet > dashboard > full-page studio. Everything is built in the visitor's browser (images never leave the device). Needs internet for the zip library (cdnjs).
- Free: unlimited generation with a watermark. Paid: one clean export of one collection version, in USDC.
- Prices are in `studio-config.json` ($50 up to 4,999 NFTs, $75 for 5,000-9,999, $100 for 10,000+; max size 20,000). Payments go to the `receiver` and Supabase project in `jobs-config.json` (the same ones the jobs board uses).
- A "version" = seed + size + images + weights + rules + dimensions. Changing any of those needs a new payment. Names, metadata, royalties and format do not. Re-exporting the same version is free for the paying wallet.
- To switch paid export on: fill in `jobs-config.json` (receiver, supabaseUrl, supabaseKey), run the new part at the bottom of `supabase/schema.sql` (table `studio_exports`), and upload `scripts/verify-exports.mjs` plus the updated `.github/workflows/verify.yml`. The `SUPABASE_SERVICE_KEY` secret is the same one as for jobs. Until then the Export button says "coming soon" and free previews still work.
- Browsers can be forced to save big collections into a folder (Chrome/Edge "Save straight into a folder"). Other browsers get image zips of 500, downloaded automatically when memory would get tight.
- Heads up: the watermark and the paid check run in the browser, so a skilled developer can bypass them by editing the page code. The on-chain payment records give you a trail; true enforcement would need server-side generation.

## Homepage sections removed
The removed sections (Venture/Collect/Build, Our HODL, What We've Built, Token Portfolio) are saved in `homepage-sections-backup.html` (kept outside this folder; do not upload it).

## Traffic tracking and reports (Umami)

1. Sign up at umami.is (Cloud, free plan), add website `cryptoasiabtc.com`, copy the **Website ID**.
2. Paste it into `UMAMI_ID` near the top of the analytics block in `shared.js`. Empty = tracking off.
3. In Umami Cloud settings create an **API key**. In GitHub: Settings > Secrets and variables > Actions, add `UMAMI_API_KEY` and `UMAMI_WEBSITE_ID`.
4. Actions > "Traffic report" > Run workflow (type `all` to force). Daily reports run at 01:30 KL; weekly on Mondays; monthly on the 1st.
5. Open the run, scroll to **Artifacts**, download `traffic-reports` (HTML to print or share, plus CSV and JSON).

Tracking loads after the page finishes, sets no cookies, respects Do Not Track, and is disclosed on `about.html`.
Buttons with `data-track="name"` send click events (the airdrop Register buttons send `ref-<dex>`).

## Perp DEX rankings (perps.html)

- `.github/workflows/perps.yml` runs daily (08:15 KL), runs `scripts/fetch-perps.mjs`, and commits `perps-data.json` and `data/perps-history.json`.
- Data comes from DefiLlama's open endpoints (override with PERPS_VOL_URL / PERPS_OI_URL; optional secret DEFILLAMA_API_KEY).
- After the first run, open the run's summary: it lists any DEX not found on DefiLlama. Those show "--".
- Edit `perps-meta.json` to add fees, season, token status, referral links, or to add a DEX (use `match` words from its DefiLlama name).
- Trend and the daily signals (OI up/down, volume spike/slowdown) build from the saved history, so they fill in after a few days.

## Page layout
- `index.html` = News (front page). `about.html` = About page (tools intro and privacy, link `about.html#privacy`).
- The menu order is set in `shared.js` (LINKS). About is last.
