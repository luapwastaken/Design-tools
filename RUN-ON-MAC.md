# Running Design Tools on macOS

Two ways: download a prebuilt `.dmg`, or run from source.

## Option A — Download the prebuilt app (easiest)

1. Go to the repo's **Actions** tab → open the latest **"Build macOS app"** run.
2. Download the **`DesignTools-macOS`** artifact (it's a zip containing the `.dmg`).
3. Unzip, open the `.dmg`, drag **Design Tools** to Applications.
4. **First launch:** the app is unsigned, so macOS will block it. Right-click the
   app → **Open** → **Open** in the dialog. (Only needed the first time.)
   - If it still won't open: System Settings → Privacy & Security → scroll down →
     **Open Anyway**.

## Option B — Run from source

Requires [Node.js](https://nodejs.org) 20+.

```bash
git clone <repo-url>
cd designtools
npm install
npm run dev
```

To build your own `.dmg` locally instead:

```bash
npm run dist
# output: dist-electron/*.dmg
```

---

The app is unsigned because that needs a paid Apple Developer account. That's fine
for testing — the right-click-Open step above is all it takes.
