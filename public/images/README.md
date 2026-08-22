# Images for the landing page

Drop files into this folder with these exact names and the landing page
will pick them up automatically — no code changes needed. Every slot has
a graceful fallback (a soft branded placeholder) if the file isn't there
yet, so the site never looks broken while you're still designing these.

## 1. `hero.jpg` — required for the biggest visual impact
The main hero image, shown split-screen next to the headline on wide
screens (desktop/laptop — this is the pattern most current job/career
platforms use, e.g. Handshake).

- **Aspect ratio:** 4:5 (portrait) — e.g. 1200×1500px or larger
- **Content direction, matching the product's existing brand voice:**
  real, authentic-feeling photography — an actual person or small group
  in a believable environment (working, building, talking to a
  customer), natural lighting, not a posed corporate stock photo, not
  AI-generated-looking (avoid the too-perfect-skin/too-symmetrical
  tell). Should read as African and modern — avoid clichés (no maps,
  no flags, no "poverty" framing) — think: a graphic designer at a
  laptop in a real workspace, a shop owner with real inventory, a
  small business in motion.
- **Format:** `.jpg`, `.png`, or `.webp` all work — just use that exact
  filename with whichever extension, and update the `src` in
  `components/AfriforceApp.jsx`'s `Landing` component if you don't use
  `.jpg`.

## 2–4. `band-1.jpg`, `band-2.jpg`, `band-3.jpg` — optional
Three images in a row further down the page, representing the range of
people the platform serves (a job seeker, an entrepreneur, an employer
— in any order). Each is optional independently; missing ones just show
the placeholder, so you can add these one at a time.

- **Aspect ratio:** 1:1 (square) — e.g. 900×900px or larger
- **Content direction:** same authenticity guidance as the hero. Aim for
  variety across the three — different settings, different people —
  rather than three similar shots.

## Why filenames instead of an upload UI
This is a static prototype without a media/CMS system — the simplest,
most reliable way to get your own images in is dropping files into this
folder with the right name and redeploying. If this grows into a real
product, that's the point to add proper image upload/storage (e.g.
Firebase Storage, which is already in the same Firebase project).
