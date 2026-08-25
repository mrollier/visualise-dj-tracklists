# Legal essentials — IP & licensing

> **Not legal advice.** This is a plain-language reference written for a solo developer, not a
> lawyer's opinion. The contours below are well established, but if this ever goes commercial or
> you get a nervous feeling, a one-off consult with an IP lawyer is cheap insurance.
> Last reviewed: 2026-07-20.

There are **two separate questions**, often confused:

1. **Am I infringing anyone else's IP?** (looking like Rekordbox, using "Camelot", etc.) — §1–§2
2. **How do I license my own work when I release it?** (the "Creative Commons" plan) — §3

---

## 1. Not infringing others — the visual look & the wheel

**Short version: a shared _style_ is fine; copied _assets_, _branding_, or a pixel _clone_ are not.**
Four different bodies of law get lumped together as "copyright":

### Copyright — protects specific _expression_, not ideas or function

- ✅ **Fine:** the general dark pro-audio aesthetic; a colour-coded key wheel; waveforms; BPM/key
  columns; tabular numerals; harmonic-mixing suggestions. These are _conventions of the genre_
  ("scènes à faire") — standard for this kind of tool, so not protectable.
- ❌ **Not fine:** copying another app's icon artwork, bundled graphics, proprietary illustrations,
  or source code.

### Trade dress — the real "it looks too much like Rekordbox" risk

Protects a product's overall look-and-feel _only if_ it's distinctive, **non-functional**, and the
public associates that exact look with one brand (cf. Apple v. Samsung). Hard to claim for a
functional UI, and this app isn't a clone. **Low risk** unless you deliberately reproduce a
competitor's whole screen layout + palette + chrome so closely a user would confuse the source.

### Trademark — the brightest line (this is where you'd get a letter)

- Don't use competitors' **names, logos**, or a **confusingly similar app name**.
- Don't imply **endorsement or affiliation** with Pioneer/AlphaTheta, Serato, Native Instruments, etc.
- Pick a clearly-original name and do a quick **knock-out search** before committing: USPTO
  (tess2.uspto.gov) + EUIPO, plus app stores + domain availability.

### The "Camelot" wheel — one specific thing to know

**"Camelot" / "Camelot Wheel" is a trademark of Mixed In Key, LLC.** But:

- ✅ The **1A–12B notation** is a functional key-naming method that's become a de-facto standard —
  using it, and being "compatible with Camelot notation," is fine and universal.
- ❌ Reproducing MIK's specific **wheel graphic**, or branding your feature as "the Camelot Wheel®"
  as if it's yours, is the line. Call it a **"harmonic key wheel"** and you're clear.

---

## 2. Practical do / don't

| ✅ Do                                         | ❌ Don't                                                    |
| --------------------------------------------- | ----------------------------------------------------------- |
| Use genre conventions & the 1A–12B notation   | Copy any competitor's icons, graphics, or code              |
| Use your own colour values & original layout  | Reproduce a competitor's exact screen                       |
| Use your own name + logo, cleared by a search | Use their names/logos or imply endorsement                  |
| Use system fonts or properly-licensed fonts   | Bundle a font without checking its licence                  |
| Ship invented/sample track metadata           | Ship real track metadata, album art, or audio you don't own |

The current design sits safely on the right side of all of this: genre conventions + standard
notation + **your own** palette, name, and organising metaphor (a set as a _walk_).

---

## 3. Licensing your own release — the Creative Commons plan

### ⚠️ Key point: **don't put the source code under a Creative Commons licence**

Creative Commons **officially recommends against using CC licences for software.** CC licences
don't handle source-vs-object code or patent grants, and aren't compatible with the common
open-source licences other developers expect. Use a proper software licence for **code**, and keep
CC for **non-code creative content** (docs, the concept paper, images, the design).

### Recommended split

| What                                                           | Licence                                                     | Why                        |
| -------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------- |
| **The code** (`src/`, scripts)                                 | **MIT** (permissive) _or_ **GPL-3.0 / AGPL-3.0** (copyleft) | pick by intent — see below |
| **Docs, concept paper, design, images** (`docs/`, screenshots) | **CC BY 4.0** _or_ **CC BY-SA 4.0**                         | CC is right _here_         |

### Which code licence matches your intent?

- **"Anyone can use/remix freely, just credit me"** → **MIT** (code) + **CC BY 4.0** (docs). Simplest.
- **"Anyone can use/remix, but derivatives must stay open too"** (the CC _ShareAlike_ spirit applied
  to software) → **GPL-3.0** (code) + **CC BY-SA 4.0** (docs). Use **AGPL-3.0** instead if you care
  about people running modified versions as a hosted web app without sharing changes.
- **My default recommendation:** if you're unsure, **MIT + CC BY 4.0** — permissive, friendly,
  and the least friction for a portfolio/community project. Choosing a licence _clarifies what
  others may do_; it does **not** shield you from §1 (it's the other question).

### How to apply

1. Add a **`LICENSE`** file at repo root with the chosen code licence (github.com/new lets you pick
   one; choosealicense.com explains them).
2. Note the docs/asset licence in `README.md` (e.g. "Code: MIT. Docs & designs: CC BY 4.0.").
3. Add an SPDX header or a line in README rather than per-file if you prefer.

---

## 4. Third-party dependencies — comply with their licences

Your stack is permissively licensed, which is easy, **but you must retain their notices** when you
distribute:

- **Svelte** — MIT · **Vite** — MIT · **d3-\*** modules — ISC/BSD-3 · **Playwright** — Apache-2.0.
- Action: keep a **`THIRD-PARTY-NOTICES`** (or rely on `node_modules` licences in source dist), and
  don't strip copyright headers. Re-check with `npx license-checker --summary` before a release.
- **Fonts:** currently system fonts + emoji glyphs — nothing to license. If you ever bundle a
  custom font, verify its licence permits redistribution/embedding (many don't).

### The offline analyser is deliberately outside the app (v34)

`scripts/analyse-audio.py` uses **essentia-tensorflow (AGPL-3.0)** and the
**MTG Essentia models (CC BY-NC-SA 4.0)**. Neither enters the app bundle, and
that separation is the point rather than an accident:

- The script is a **separate program** that communicates with the app through a
  JSON file it writes. Its outputs are numbers about your own tracks in your own
  project file — data, not a derivative of essentia — so displaying them is fine.
- The **models are gitignored** and fetched on demand by `scripts/fetch-models.sh`.
  They are never redistributed. NonCommercial is the binding term, which is
  irrelevant for personal use but would matter if this ever went commercial.
- Because of both, **the app's own licence stays open**: the MIT + CC BY 4.0
  split recommended in §3 is still available.

Contrast the road not taken: shipping **essentia.js** (also AGPL-3.0) in the
browser bundle would have made the whole app a derivative work, forcing AGPL-3.0
on it the moment it was published or hosted. That was one of the reasons the
in-app analyser was dropped. If you ever revisit it, this is a one-way door —
decide the licence first.

---

## 5. Pre-publish checklist

- [ ] App name cleared (USPTO/EUIPO + app stores + domain).
- [ ] No competitor names, logos, screenshots, icons, or code anywhere in the repo or marketing.
- [x] Wheel described as "harmonic key wheel"; "Camelot" used only as compatible notation, not branding.
- [ ] `LICENSE` file added (code) + docs/asset licence stated in README.
- [ ] Dependency notices retained; `license-checker` run.
- [ ] Sample data is invented; no real track metadata/art/audio shipped.
- [ ] (If commercial) consider a professional trademark/trade-dress clearance.
