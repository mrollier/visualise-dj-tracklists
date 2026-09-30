# v30.1 — panel tabs, and the link control slimmed

Same branch as v30 (`v30-collapsible-panels`). Michiel lived with the
collapsible panels and reported four things: two corrections to what v30
shipped, two about the folder-link control beside the transport.

## Thesis

v30's collapse buttons were positioned against the central column's edges and
translated back by half their own size, so each one straddled the boundary it
controlled. That is a defensible place for a control that owns a seam — but it
means half of it is drawn on the panel's own contents, and at the top that half
landed on the deck row's seek line, a few pixels from the transport buttons.

A tab fixes it without giving up anything v30 bought: the positioning is
unchanged, so a collapse still moves each button for free and no button knows a
rail width. Only the direction of the overhang changes.

---

## The tab does not cross its seam

Flat edge on the boundary, rounded into the central view, no border along the
seam itself — so it reads as growing out of the panel rather than floating over
it. One rule per side covers both states: with the rail collapsed the seam _is_
the window edge, and the tab docks against it exactly as it docked against the
panel.

That retires `.tucked`. It existed for one reason — a collapsed rail's button
would otherwise hang half outside the window — and a tab that never crosses the
seam has no such state to describe.

The ink is deliberately a sliver (14px). The hit area is not: an invisible
`::before` cushion brings each tab up to the 24px pointer target, growing into
the view only. A cushion that reached back over the panel would take clicks from
the contents this wave exists to stop covering.

## Reserving the strip

A tab that never crosses its seam has to protrude somewhere, and that somewhere
is the central pane. The browser pass said what that costs: the top tab sat
squarely on the Tracks view's `KEY` header, and the side tabs on its ★ and
rating columns. Off the panels, still on content — which is half a fix.

So the pane reserves the strip. `--panel-tab` is both how far a tab protrudes
and how much padding `.center-scroll` keeps on the three edges they occupy — one
number, so the two cannot drift. The Tracks view is its own scroller inside that
padding, so its sticky header starts below the band and stays below it while it
scrolls; the wheel and the genre map are `viewBox` + `meet`, so they simply draw
14px smaller. The band paints `var(--surface)`: without that it showed the page
behind it, which read as a frame around the view rather than part of it.

## One line, or it is not there

Before a folder was linked the bar's button read `Link` / `music` / `folder…` on
three lines — and a taller button is a taller bar, which is the one thing v30
said would depend on the deck count and nothing else.

Two causes. The copyable suggested-path chip was the widest thing in `.source`
and squeezed the button down to its longest word; and a squeezed button is free
to wrap its own text, because nothing said otherwise. So labels in the bar are
`nowrap`, and the path chip is panel-only now. The panel is exempt from the
`nowrap`: its coverage read-out is the long form, and wrapping is how it fits
the rail.

The adaptive label needed no work — `Link music folder…` above the 700px
container query and `Link…` below it was already the markup. What it needed was
room, which is what the chip was taking.

The chip itself is not gone, only relocated to where it costs nothing:
Advanced → View is the management surface, and since no browser will open a
picker at a path, the copy-then-⌘⇧G route is still the only one there is. The
bar's ⓘ says where the one-click copy lives.

## The example names something you can see

The ⓘ's worked example — _this track is at that path, so link this folder_ —
named the first track in the whole library that carried a path. That is nothing
in particular, and often nothing on screen.

Both candidates are drawn from what is visible now, most-wanted first: the track
the user last clicked, then the first one the filters still leave standing. A
clicked track that has since been filtered away does not count; deck B goes on
playing it, but the ⓘ is meant to name something the user can see.

`clickedTrackId` rather than `selectedId`, for the reason v29 #10 gave when deck
B was wired the same way: it means a track the user picked, not wherever the app
moved the selection.

`folderHint` takes the candidates as an optional second argument, so every
existing call and every existing test keeps its exact behaviour. It only ever
wants the first candidate with a path, so the caller hands it two entries rather
than the visible library.

The **suggested folder** deliberately still reads the whole library. What gets
linked has to cover everything, not just what survives the filters — an ancestor
computed from four visible tracks would leave the other two thousand unresolved.

## Declined

- **Moving only the top button.** It is the one that collided, but the same
  argument applies to all three, and three tabs that behave alike are easier to
  learn than one tab and two straddlers.
- **A floating pill inset into the view.** Detaching the button from its panel
  makes it a control of the view, which is not what it does.
- **Padding the Tracks view instead of the pane.** It would fix the view that
  complained and leave the genre map to be discovered later; the strip belongs
  to the chrome that occupies it, so the pane owns it.
- **Dropping the path chip everywhere.** Michiel's complaint was about the bar,
  where it costs space it does not earn. In the panel it is the whole of the
  help a browser permits.
- **Naming the selected track rather than the clicked one.** The selection moves
  for reasons that are not a click — undo, a suggestion, a project load — and a
  tooltip that changes because the app moved something is noise.

## Verified in the browser

A fourth Playwright probe beside v30's three, 25 checks, zero console errors,
against the same real import and music folder.

Geometry, at 1440 and with each rail open and collapsed: every tab's box clears
the panel it controls and stays inside the window; the top tab hangs below the
bar's border, and below the ribbon's when the bar is off. A click 5px outside a
tab still lands on it; a click 4px back over the panel does not.

The bar: identical height at 1440 and at a width that trips the container query,
`Link music folder…` at the first and `Link…` at the second, the button one line
at both, no `.path` in the bar and exactly one in Advanced → View still carrying
its ⌘⇧G title.

The hint: clicking Nightmares names Dusky — Nightmares, clicking Midnight Drive
follows it, and the suggested folder does not move between the two. Filtering the
clicked track away (BPM ≥ 125) hands the example to Jon Hopkins — Aurora.

v30's three probes still pass unchanged — 18 + 20 + 13 — apart from one
assertion that was checking the retired behaviour: the top button no longer
straddles the ribbon seam, it hangs off it.

By eye, at 1440 and 980, light theme: the wheel with all three panels showing,
the Tracks view with its header now clear of the tab, both rails collapsed with
the tabs docked at the window edges, and Advanced → View with the path chip
where it now lives.
