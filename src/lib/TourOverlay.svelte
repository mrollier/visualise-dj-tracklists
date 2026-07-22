<script lang="ts">
  // The guided tour (v12 WS12; rebuilt v16 #12): a spotlight coachmark walk.
  // Each step dims the app and highlights the real element it describes — the
  // UI stays interactive through the cutout, so every step can be *done*. The
  // controlled demo state (Classic + Key/BPM) is set up in tour.ts.
  import { tourStep } from '../stores'
  import { endTour, tourSnapshot } from './tour'

  interface Step {
    /** data-tour value to spotlight; null = a centred card with a full dim. */
    target: string | null
    title: string
    body: string
  }

  const STEPS: Step[] = [
    {
      target: 'wheel',
      title: 'Your library, drawn as a wheel',
      body: 'Every track sits in its key’s slot on the Camelot wheel; distance from the centre is its BPM. It’s all computed from your files, in your browser — nothing is uploaded.',
    },
    {
      target: 'wheel',
      title: 'Click a track to light up its combos',
      body: 'Click any star on the wheel. Its playable transitions fan out — every edge computed from the criteria on the left, and every one there for a reason you can read.',
    },
    {
      target: 'criteria',
      title: 'What decides a combo',
      body: 'These criteria draw the edges. For the demo just Key and BPM are on, so the wheel stays easy to read. Lock one to require it, loosen it, or switch more on anytime.',
    },
    {
      target: 'playlists',
      title: 'Focus on a crate',
      body: 'Toggle playlists to scope the wheel to part of your library; the filters and genres above narrow it further. The wheel and counts react live.',
    },
    {
      target: 'suggest',
      title: 'Draw a constellation',
      body: 'Press ✨ and watch a constellation — this app’s name for a set — draw itself key to key through the wheel. (The s key does it too.)',
    },
    {
      target: 'constellation',
      title: 'Your constellation lives here',
      body: 'Reorder it, pin an opener or closer, mark must-plays with ★ — then export it as M3U8/CSV, or save a Portrait poster of the walk.',
    },
    {
      target: 'easy',
      title: 'Prefer to start simple?',
      body: 'Easy mode runs the whole app on sensible defaults — just pick playlists and press ✨. Your setup isn’t changed, only set aside; All controls brings it back exactly as you left it.',
    },
    {
      target: null,
      title: 'That’s the map',
      body: 'That’s Zodiac Tracker: a map of everything you could play, with every set a visible walk. Have a wander.',
    },
  ]

  const step = $derived($tourStep)
  const hasSnapshot = $derived($tourSnapshot !== null)
  const isLast = $derived(step !== null && step >= STEPS.length - 1)

  let rect = $state<DOMRect | null>(null)
  let raf = 0

  function measure(): void {
    const s = $tourStep
    const sel = s === null ? null : STEPS[s]?.target
    if (!sel) {
      rect = null
      return
    }
    const el = document.querySelector(`[data-tour="${sel}"]`)
    rect = el ? el.getBoundingClientRect() : null
  }

  // Re-measure after the DOM settles whenever the step changes (rAF so the
  // demo library / panels have painted), and on resize / any scroll.
  $effect(() => {
    void $tourStep
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(raf)
  })
  $effect(() => {
    const on = () => measure()
    window.addEventListener('resize', on)
    window.addEventListener('scroll', on, true)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('scroll', on, true)
    }
  })

  const CARD_W = 320
  const CARD_H = 195
  const M = 14

  // Place the card on the side of the target with the most room, clamped to
  // the viewport; centred bottom when there is no target (outro).
  const cardPos = $derived.by(() => {
    if (rect === null) return null
    const clampX = (x: number) => Math.max(M, Math.min(x, window.innerWidth - CARD_W - M))
    const clampY = (y: number) => Math.max(M, Math.min(y, window.innerHeight - CARD_H - M))
    if (window.innerHeight - rect.bottom >= CARD_H + M) return { top: rect.bottom + M, left: clampX(rect.left) }
    if (window.innerWidth - rect.right >= CARD_W + M) return { top: clampY(rect.top), left: rect.right + M }
    if (rect.top >= CARD_H + M) return { top: rect.top - CARD_H - M, left: clampX(rect.left) }
    if (rect.left >= CARD_W + M) return { top: clampY(rect.top), left: rect.left - CARD_W - M }
    return { top: window.innerHeight - CARD_H - M, left: clampX((window.innerWidth - CARD_W) / 2) }
  })

  const holeStyle = $derived(
    rect === null
      ? ''
      : `left:${rect.left - 6}px;top:${rect.top - 6}px;width:${rect.width + 12}px;height:${rect.height + 12}px`,
  )
  const cardStyle = $derived(
    cardPos === null
      ? `left:${(typeof window !== 'undefined' ? window.innerWidth - CARD_W : 400) / 2}px;bottom:48px`
      : `left:${cardPos.left}px;top:${cardPos.top}px`,
  )

  function next(): void {
    if (step === null) return
    if (isLast) endTour(false)
    else tourStep.set(step + 1)
  }
  function back(): void {
    if (step !== null && step > 0) tourStep.set(step - 1)
  }
  // Skipping returns replayers to their own work (there is a snapshot); on a
  // first run there is nothing to go back to, so it just keeps the demo.
  function skip(): void {
    endTour(hasSnapshot)
  }
</script>

{#if step !== null && STEPS[step] !== undefined}
  {#if rect === null}
    <div class="tour-backdrop"></div>
  {:else}
    <div class="tour-hole" style={holeStyle}></div>
  {/if}

  <div class="tour-card" style={cardStyle} role="dialog" aria-modal="false" aria-label="Guided tour">
    <div class="tour-head">
      <strong>{STEPS[step].title}</strong>
      <button class="close" aria-label="Skip the tour" onclick={skip}>✕</button>
    </div>
    <p>{STEPS[step].body}</p>
    <div class="tour-foot">
      <span class="dots" aria-label="Step {step + 1} of {STEPS.length}">
        {#each STEPS.keys() as i (i)}
          <i class:on={i === step}></i>
        {/each}
      </span>
      <span class="nav">
        {#if step > 0}
          <button onclick={back}>Back</button>
        {/if}
        {#if isLast && hasSnapshot}
          <button onclick={() => endTour(false)}>Keep this demo</button>
          <button class="primary" onclick={() => endTour(true)}>Return to my work</button>
        {:else}
          <button class="primary" onclick={next}>{isLast ? 'Done' : 'Next'}</button>
        {/if}
      </span>
    </div>
  </div>
{/if}

<style>
  .tour-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    pointer-events: none;
    z-index: 60;
  }

  /* The spotlight: a clear rounded window over the target, everything else
     dimmed by the huge box-shadow. pointer-events:none so the real element
     underneath stays clickable (the tour "stays interactive"). */
  .tour-hole {
    position: fixed;
    border-radius: 8px;
    border: 2px solid var(--accent);
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    z-index: 60;
    transition:
      left 0.25s ease,
      top 0.25s ease,
      width 0.25s ease,
      height 0.25s ease;
  }

  .tour-card {
    position: fixed;
    width: 320px;
    z-index: 61;
    background: var(--surface-raised, var(--surface));
    border: 1px solid var(--accent);
    border-radius: 10px;
    padding: 12px 14px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    font-size: 13px;
    pointer-events: auto;
  }

  .tour-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .tour-head strong {
    flex: 1;
  }

  .close {
    background: none;
    border: none;
    color: var(--ink-muted);
    padding: 0 2px;
  }

  p {
    margin: 6px 0 10px;
    color: var(--ink-secondary);
  }

  .tour-foot {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dots {
    flex: 1;
    display: flex;
    gap: 5px;
  }

  .dots i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--grid);
  }

  .dots i.on {
    background: var(--accent);
  }

  .nav {
    display: flex;
    gap: 6px;
  }

  .nav .primary {
    border-color: var(--accent);
    color: var(--accent);
  }

  @media (prefers-reduced-motion: reduce) {
    .tour-hole {
      transition: none;
    }
  }
</style>
