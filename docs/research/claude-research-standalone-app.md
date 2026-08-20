# Zodiac Tracker as a stand-alone macOS app — feasibility report

**Status: report only.** Michiel's explicit instruction (2026-08-21): investigate in detail how the web app could become a stand-alone application on his MacBook M4, list all advantages and disadvantages, think through the practical challenges — **do not build anything**. Constraints confirmed by him for this report: all four motivations apply (app-like feel · file-access pain · local audio analysis · offline+performance); an embedded web engine is acceptable **provided AIFF plays** (his main format); the app is for him alone (no distribution, no App Store); the web version stays alive in parallel, so web and desktop must share one codebase.

Research base: full codebase inventory plus six web-research passes (Tauri, Electron, browser-only routes, native/lightweight shells, AIFF codec support, analysis-sidecar bundling), ~150 sources, August 2026. Source URLs for every load-bearing claim are listed in §9.

## 1. What the repo already has (prior art)

- **The app already ships as an installable PWA** — `public/manifest.webmanifest` (`display: "standalone"`, own icons), hand-rolled offline service worker `public/sw.js`, registered in `main.ts:11`. README:250 already sells it as "opens like a double-click application, offline included". This *is* a stand-alone app in the dock sense; what it cannot do is the subject of this report.
- **The decision of record**: design-v12.md — "PWA first; **Tauri only if the PWA disappoints**"; restated in IDEAS.md:69-70 and in design-v28's Declined section ("revisit if the once-a-session pick proves genuinely annoying"). This report is that revisit, priced precisely.
- **The filesystem layer is already abstracted** behind the `AudioSource` interface (`src/lib/audio/source.ts`): `fsaSource.ts` (Chromium File System Access, handle persisted in IndexedDB via `handleStore.ts`) and `pickerSource.ts` (`webkitdirectory`, session-only). A desktop shell would be a **third implementation** behind the same interface; matching, formats and coverage live in the pure core (`src/core/audio/`, fully unit-tested) and carry over unchanged.
- **The audio engine streams deliberately**: `engine.ts:10-12` — `<audio>` + `createMediaElementSource`, *not* `decodeAudioData`, precisely to avoid ~100 MB decodes and multi-second stalls. Consequence: playable formats = whatever the embedding engine's *media element* plays. The coverage read-out exists because of the resulting gap (design-v28, Known limitation: "**AIFF and ALAC. Chrome plays neither; Safari plays both.**").
- **Local audio analysis is already designed as a repo-local script** (research/claude-research-audio-analysis.md, 2026-08-14): `scripts/analyse-audio.py` opens files by decoded `Track.location` path — no browser limit, no app-spawned process needed. Rekordbox XML already supplies `AverageBpm`/`Tonality`; only 22/2080 tracks lack BPM, 33 lack key.
- **`Track.location` holds the real absolute path** (`file://localhost/...`), which a web page may not open and a desktop shell may. The entire pathMatch/suffix/NFC layer (`src/core/audio/pathMatch.ts`) exists only to work around that — a shell reads the path directly.

## 2. The four motivations, examined

| Motivation | Verdict |
|---|---|
| App-like feel | **Already delivered** by the shipped PWA once installed (own dock icon, standalone window, Cmd-Tab identity). |
| File-access pain | **Probably already solved, untested**: since Chrome 122 (Feb 2024), *installed PWAs auto-persist* File System Access directory permissions — pick once, then `queryPermission()` returns `granted` silently on every launch. `restoreSavedFolder()` (`sourceStore.ts:113`) already handles that path; the Reconnect button simply stops being needed. Five-minute test, zero code (§8). |
| Local audio analysis | **Does not require a shell.** The designed sidecar is a terminal-run batch script writing JSON the app imports; Rekordbox covers ~98% of key/BPM anyway. A shell only adds one-click in-app analysis — a nicety, not a gate. |
| Offline + performance | Offline: already shipped (sw.js). Performance: no recorded performance complaint anywhere in ISSUES.md; a shell swaps Chromium for WebKit, same class of engine — no material speed-up to expect. |

**What survives scrutiny as the real, irreducible drivers: AIFF (+ALAC) playback, and zero-prompt access to real paths.** Everything else the current PWA delivers or a script delivers.

## 3. The decisive platform facts (verified 2026-08-21)

1. **Chromium cannot play AIFF or ALAC, and never will by flag or variant.** Compile-time fact in Chromium's ffmpeg config (`config_components.h`, mac/arm64): `CONFIG_AIFF_DEMUXER 0`, `CONFIG_ALAC_DECODER 0`. Applies identically to Chrome, an installed PWA, `--app=` windows, and Electron. (Irony: the big-endian PCM *decoder* is compiled in; only the ~500-line AIFF *demuxer* is off.)
2. **WebKit plays both, in both paths.** WebKit's Web Audio decode (`AudioFileReaderCocoa.mm`) and `<audio>` (AVFoundation) go through CoreAudio: AIFF, AIFF-C, ALAC, plus MP3/AAC/WAV/FLAC/CAF. Every WKWebView shell (Tauri, Wails, hand-rolled Swift, Neutralino) inherits this. A WKWebView port has *better* format coverage than today's Chrome version.
3. **WebKit has no `showDirectoryPicker`** (OPFS only, through Safari 26.x). Every WKWebView route therefore replaces the FSA layer with a native bridge — which the `AudioSource` abstraction already anticipates. In Tauri the replacement is *stronger* than what it replaces: dialog plugin returns a real path, fs-plugin scope auto-extends, `tauri-plugin-persisted-scope` restores it across launches — pick once, silent forever, and no basename matching needed.
4. **Chromium's AIFF gap is cheaply fixable in shared code** — `@audio/decode-aiff` (MIT, ~25 KB, pure JS — AIFF is just big-endian PCM in an IFF container; v1.3.0, 2026-08-11, actively maintained) decodes to PCM for a manual `AudioBuffer`. But because the engine streams rather than decodes, wiring it in means a **second, buffer-based playback path** (`AudioBufferSourceNode`) beside the streaming one: new seek/pause/duration handling for buffer decks, ~100 MB RAM per loaded 5-min AIFF. Real work (order of 1–2 days), and it fixes AIFF **on the web version too** — valuable independent of any packaging decision.
5. **No browser context can launch a process** (Native Messaging is extension-only) — bundled one-click analysis is shell-only. The ceiling for a pure-browser app is a separately started localhost daemon (Chrome 142+ adds a loopback-network permission prompt; Safari blocks localhost from https as mixed content).
6. **Personal use erases the signing problem.** A locally built app has no quarantine attribute → Gatekeeper never evaluates it; Apple Silicon's mandatory signature is applied ad-hoc by the linker. No Apple Developer account, no notarisation. One caveat: ad-hoc identities change per rebuild, so a TCC-protected folder (Desktop/Documents/external drive) would re-prompt after rebuilds — `~/Music` is not on the TCC list, so likely moot; a free Apple-ID development certificate fixes it if it ever bites.
7. **Sidecar reality check**: essentia-tensorflow's arm64 wheel is 98.8 MB (cp314-only, macOS 15+, open import bug MTG/essentia#1486 unverified-fixed); a TF-bearing PyInstaller bundle runs 300 MB–1 GB with a ~5–20 s cold import. Plain `essentia` (no TF) does key+BPM in a 20.5 MB wheel. The decoupled batch script remains the best shape regardless of packaging — as the audio-analysis report already concluded.

## 4. Options, with all advantages and disadvantages

### A. Install the existing PWA (zero work)

*Advantages:* zero code, zero new build targets, same deploy; own dock icon/window/Cmd-Tab identity; offline already works; **likely** silent folder restore via Chrome 122+ installed-PWA persistent permissions (the one untested claim — §8); Safety-Check auto-revocation is the only known threat and regular use prevents it.
*Disadvantages:* AIFF/ALAC stay unplayable (31 tracks currently "unsupported format"); Chrome is still the runtime (Chrome update restarts, Chrome branding in Activity Monitor); no process spawning ever; real paths stay unobservable so basename matching stays load-bearing.

### B. A + shared-code AIFF fallback (the highest-value code anywhere)

Add `@audio/decode-aiff` as a decode fallback with a buffer-playback path in the engine, gated on `.aif/.aiff` (and later `.m4a`-ALAC via `@audio/decode-aac` if needed).
*Advantages:* kills the AIFF gap **in every Chromium context at once** — web, installed PWA, and any future shell's dev mode; ~25 KB, MIT, pure JS, no WASM; work is never wasted (the web version needs it as long as it lives); with A, all four motivations are then either solved or script-covered.
*Disadvantages:* dual-path engine complexity (streaming decks + buffer decks: seek, duration, promote-swap, ended-events twice); ~100 MB RAM per loaded AIFF deck (fine on an M4, against the engine's stated design rationale); package is young (Apr 2026) — spot-check against real AIFF-C files; ALAC needs a second package with a GPL-2.0 AAC engine inside (personal use: irrelevant; public web bundle: licence check).

### C. Tauri v2 — the shell to build, if one is built

Tauri 2.11 (stable since Oct 2024, audited, active). `tauri init` is additive: `src-tauri/` beside the untouched Vite app; `isTauri()` gates a third `AudioSource`; Vite HMR unchanged in `tauri dev`.
*Advantages:* AIFF + ALAC play **natively, zero code** (WKWebView/CoreAudio — the strongest possible answer to the hard requirement); zero-prompt persistent folder access, stronger than Chrome's (real paths; `Track.location` readable directly; pathMatch layer bypassable; "31 unsupported / 6 not found" both go to ~0); asset protocol streams with Range support, so the streaming engine carries over — no buffer path needed; first-class PyInstaller sidecar bundling if one-click analysis ever becomes real; ~5–15 MB app, ~30–50 MB idle RAM; unsigned local builds are frictionless; the pure core and all Svelte UI carry over verbatim.
*Disadvantages:* the file-access layer is written a second time (dialog+fs+persisted-scope; ~200 lines replaced, both kept alive); engine switch Chromium→WebKit means a Safari-grade CSS/JS pass over UI built against Chrome (the v28.1 vertical-fader bug shows engine-specific layout is a live risk); `window.prompt()` is not implemented in WKWebView — `exportName.ts` needs a small in-app dialog (arguably an upgrade — ConfirmDialog pattern exists); Blob-`<a download>` exports need verification and likely a save-dialog variant; Rust toolchain enters the build (rustup + Xcode CLT, minutes-long first compile — mostly config, not Rust-writing); WKWebView is welded to macOS updates (an OS beta once broke clicks in all Tauri apps); localStorage capped ~5–10 MiB (project autosave ≈1–2 MB today — fine, but the analysis sidecar plan should watch it); two build targets forever = every feature tested twice (the exact reason v28 declined this); deploy story splits (Cloudflare Pages stays, plus a local `tauri build` ritual); `scripts/screenshot.mjs` keeps driving the web build only.

### D. Electron — rejected

*Advantages (for completeness):* the only shell where the existing FSA code runs unchanged; identical Chromium engine so zero UI-porting risk; AAC/MP3/FLAC/WAV native; mature tooling (electron-vite + electron-builder); Node fs = zero-prompt folder access; sidecar spawning is the ecosystem's bread and butter.
*Disadvantages (decisive):* **fails the AIFF hard requirement natively** — same compiled-out demuxer as Chrome, so it needs exactly the option-B fallback work anyway, at which point B without Electron delivers more for less; ~250 MB on disk / 150–300 MB RAM floor for a 1.2 MB app; new Chromium major every 8 weeks with ~6-month support windows; its unique advantage (FSA reuse) is worth little since B is wanted regardless.

### E. Wails v3, Neutralino, hand-rolled Swift wrapper — parked

- **Wails v3 (Go):** architecturally Tauri's near-twin (WKWebView, so AIFF free), Go easier than Rust, and its Go `http.Handler` asset middleware is the cleanest audio-streaming story of any route. But it entered beta 2026-08-02 — churn risk now; re-rank if 3.0 finals before a shell is built.
- **Neutralino:** WKWebView but no way to hand `<audio>` a streamable URL into an arbitrary folder (file bytes cross a WebSocket as base64 → whole-file Blobs for 50–200 MB AIFFs); small bus factor. Out.
- **Swift/SwiftUI + WKWebView by hand:** feasible (a few hundred lines; 2–5 AI-assisted days), zero framework churn, direct `Process` for sidecars — but Range-correct media serving, the JS bridge, packaging and the dev loop are all hand-built in an unfamiliar toolchain to reach where `tauri init` starts. Only attractive as a zero-dependency purist play.

### F. Native Swift rewrite — rejected

AVAudioEngine would be genuinely better (sample-accurate dual decks, native everything, CoreML analysis) — but 150–400 h to reach parity, a permanent codebase fork violating the keep-both constraint, and the CoreML win is smaller than it looks (Essentia's DSP feature extraction lives outside the TF models and would need reimplementing). Only rational as a learning project valued for its own sake.

## 5. Recommendation: staged, with explicit gates

- **Stage 0 — test what already exists (5 minutes, zero code).** Install the PWA from Chrome (⋮ → Cast, save and share → Install). Relaunch; check the audition bar reconnects the music folder silently. Separately, open one of the 31 "unsupported format" AIFFs in Safari to witness the WebKit claim. Outcome decides how loud the remaining pain actually is.
- **Stage 1 — AIFF fallback in shared code** (option B), when the 31-track gap justifies 1–2 days. Benefits web + PWA + any future shell simultaneously; no packaging decision needed to start.
- **Stage 2 — Tauri v2 port** (option C), gated on: Stage 0/1 still disappointing, or one-click in-app analysis becoming a real want, or the basename-matching layer causing real misses that direct paths would end. The v12 rule stays intact — this report just defines "disappoints" measurably and prices the exit.

Not chosen at any stage: Electron (D), Neutralino, native rewrite (F). Watch: Wails v3 stabilisation, Tauri v3's experimental CEF backend (would offer engine choice), Safari ever shipping directory pickers (would strengthen A/B).

## 6. Practical-challenges catalogue for the Stage-2 port (when/if)

The complete punch list a Tauri port must clear, from the codebase inventory: third `AudioSource` (dialog/fs/persisted-scope; keep both web impls); audio via `convertFileSrc` + asset protocol (streaming engine unchanged — verify seek/Range on real 100 MB AIFFs early); `exportName.ts` `prompt()` → dialog component; export downloads → save-dialog path; `handleStore.ts` (IndexedDB) unused in shell; localStorage autosave headroom check; WebKit CSS/JS pass (vertical fader, `writing-mode`, dialogs, zoom/d3 interactions); `navigator.userAgent` Mac-detect fine; sidecar lifecycle (Tauri does not kill children on exit); media keys absent without a plugin (not currently needed); CI stays web-only, `tauri build` stays a local ritual; icons reusable from `public/`.

## 7. Risks & uncertainties (flagged, not resolved)

- Chrome-PWA silent-restore is documented but **untested here** (Stage 0 exists to falsify it); Safety-Check auto-revocation behaviour for installed PWAs is not clearly documented.
- WKWebView AIFF `<audio>` playback is asserted from Apple docs + WebKit source, not yet witnessed on this machine (Stage 0's Safari test covers it).
- `~/Music` being TCC-free is well-established practice, not centrally documented — verify on first shell run.
- Tauri asset-protocol seek behaviour verified by code history and absence of open macOS issues — absence of reports is not proof; make it the first shell spike.
- `@audio/decode-aiff` is young (Apr 2026); test against real AIFF-C (`sowt`) files from the library before trusting it.

## 8. Immediate next step (per "do not build")

Record this report: IDEAS.md stand-alone entry gains a pointer here and the sharpened gate. The two Stage-0 experiments are Michiel's to run whenever he likes; they cost nothing and settle the two claims everything else hangs on.

## 9. Sources (load-bearing subset)

- Chromium ffmpeg config (AIFF/ALAC off): https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/refs/heads/master/chromium/config/Chrome/mac/arm64/config_components.h · https://www.chromium.org/audio-video/
- WebKit CoreAudio decode paths: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/AudioFileReaderCocoa.mm · https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/Using_HTML5_Audio_Video/AudioandVideoTagBasics/AudioandVideoTagBasics.html
- Chrome 122 persistent FSA permissions (installed-PWA auto-persist): https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api
- Safari/WebKit FSA status (OPFS only): https://developer.mozilla.org/en-US/docs/Web/API/File_System_API · https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- Tauri v2: https://v2.tauri.app/plugin/file-system/ · https://v2.tauri.app/plugin/persisted-scope/ · https://v2.tauri.app/develop/sidecar/ · https://v2.tauri.app/security/asset-protocol/ · asset-protocol Range fix: https://github.com/tauri-apps/tauri/commit/45330e38193d0b2a01aa926aec433acc6b8f6597
- AIFF JS decoding: https://www.npmjs.com/package/@audio/decode-aiff · https://github.com/audiojs/audio-decode
- Electron AIFF gap: https://github.com/electron/electron/issues/22940
- Personal-use signing/Gatekeeper: https://v2.tauri.app/distribute/sign/macos/ · TCC: https://eclecticlight.co/2025/11/08/explainer-permissions-privacy-and-tcc/
- Sidecar packaging: https://pypi.org/project/essentia-tensorflow/ · https://github.com/MTG/essentia/issues/1486 · https://github.com/dieharders/example-tauri-v2-python-server-sidecar
- Wails v3 beta status: https://github.com/wailsapp/wails/releases · Neutralino architecture: https://neutralino.js.org/docs/contributing/architecture/
- Rekordbox XML key/BPM attributes: https://cdn.rekordbox.com/files/20200410160904/xml_format_list.pdf

Full per-topic research reports (six, with complete advantage/disadvantage lists and ~150 source URLs) were produced during this investigation; this document is their distillation.
