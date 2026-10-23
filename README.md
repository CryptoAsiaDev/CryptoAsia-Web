# Crypto Asia Website

## Files to upload to GitHub
- `index.html` — the main website
- `CRYPTO_ASIA_PAVIA.png` — the logo (must be in the same folder as index.html)

## How to enable GitHub Pages (so your site goes live)

1. Go to **https://github.com/CryptoAsiaDev/CryptoAsia-Web**
2. Click **Settings** (top tab)
3. In the left sidebar, click **Pages**
4. Under "Branch", select **main** and folder **/ (root)**
5. Click **Save**
6. Wait 1–2 minutes, then visit: **https://cryptoasiadev.github.io/CryptoAsia-Web**

## Automatic news (news.html)
1. Upload `news.html`, `news.json`, the `scripts/` folder and `.github/workflows/news.yml` to the repo (the workflow file must keep that exact path).
2. Repo → Settings → Secrets and variables → Actions → New repository secret: name `ANTHROPIC_API_KEY`, value = your key.
3. Repo → Actions → "Update crypto news" → Run workflow. After that it runs every 30 minutes.
4. Check each feed in `scripts/feeds.json` opens in a browser and that the publisher allows this use. Remove any that don't.
5. Images: by default each story shows a Crypto Asia graphic (coin symbol or category). To show the publisher's own thumbnail instead, set `SHOW_SOURCE_IMAGES = true` near the top of the script in `news.html`. Those images belong to the publishers, so only do this if you accept that risk.
