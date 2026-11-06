# Yacht Rockin' Radio — PWA Wrapper

A Progressive Web App (PWA) that wraps yachtrockinradio.com/player so it installs
and launches like a native app on **any device**.

---

## What's Included

```
yacht-rock-pwa/
├── index.html      ← App shell + splash screen + install prompts
├── manifest.json   ← PWA manifest (name, icons, display mode)
├── sw.js           ← Service worker (offline shell, caching)
└── icons/          ← All required icon sizes (32px → 512px)
```

---

## How to Deploy (Required for PWA to work)

PWAs **must be served over HTTPS** from a real domain. Here are 3 free options:

### Option A — Netlify (Easiest, Free)
1. Go to https://netlify.com and sign up free
2. Drag-and-drop the `yacht-rock-pwa/` folder onto the Netlify dashboard
3. Done — Netlify gives you an HTTPS URL instantly

### Option B — GitHub Pages (Free)
1. Create a GitHub account at https://github.com
2. Create a new repository (e.g. `yacht-rock-radio`)
3. Upload all files in this folder to the repo
4. Go to Settings → Pages → Source: "main branch / root"
5. Your app will be live at `https://yourusername.github.io/yacht-rock-radio`

### Option C — Vercel (Free)
1. Go to https://vercel.com
2. Import your GitHub repo or drag-drop the folder
3. Deploy — done

---

## Installing the App on Each Device

### Android (Chrome)
- Visit your deployed URL in Chrome
- A banner will appear: **"Add to Home Screen"** — tap Install
- Or tap the 3-dot menu → "Add to Home Screen"

### iPhone / iPad (Safari ONLY)
- Open the deployed URL in **Safari** (not Chrome)
- Tap the **Share button** (box with arrow) at the bottom
- Scroll and tap **"Add to Home Screen"**
- Tap **Add**

### Desktop (Chrome / Edge)
- Visit your URL
- Click the install icon in the address bar (right side)
- Or click the ⋮ menu → "Install Yacht Rockin' Radio"

---

## Features
- ✅ Full-screen standalone app (no browser bar)
- ✅ Custom splash screen with animations
- ✅ Branded nav bar with live indicator  
- ✅ Install prompts for Android, iOS, and Desktop
- ✅ App icon on home screen / taskbar
- ✅ Service worker for fast shell loading
- ✅ Safe-area support for iPhone notch/Dynamic Island

---

## Notes
- Audio continues as long as the app is open (background audio depends on device OS)
- The actual radio stream is always loaded live from yachtrockinradio.com
- This wrapper does NOT host or redistribute any radio content
