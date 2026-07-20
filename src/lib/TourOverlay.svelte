<script lang="ts">
  // The guided demo tour (v12 WS12). A floating card, not a modal: the app
  // stays interactive so every step can be *done* while reading it.
  import { tourStep } from '../stores'
  import { markTourSeen } from './tour'

  const STEPS = [
    {
      title: 'Your library is the wheel',
      body: 'Every track sits in its key’s slot on the Camelot wheel; the distance from the centre is its BPM. All of it is computed from your file, in your browser — nothing is uploaded.',
    },
    {
      title: 'Click a track',
      body: 'A star of edges appears: every playable transition from there, computed from the combo criteria on the left. Every edge exists for a reason you can read.',
    },
    {
      title: 'Let it walk',
      body: 'Press ✨ Suggest a constellation and watch the walk draw itself, key to key, through your library. (The s key does it too.)',
    },
    {
      title: 'Your constellation lives on the right',
      body: 'Reorder it, pin an opener or closer, mark must-plays with ★ — then export it, or save a Portrait poster of the walk.',
    },
    {
      title: 'Easy or everything',
      body: 'Easy mode runs the whole app on sensible defaults — just pick your playlists and press ✨. Your criteria, filters, pins and marks aren’t changed, only set aside; All controls brings them back exactly as you left them. Cmd+Z undoes nearly anything. Have fun.',
    },
  ]

  const step = $derived($tourStep)

  function close() {
    markTourSeen()
    tourStep.set(null)
  }
  function next() {
    if (step === null) return
    if (step >= STEPS.length - 1) close()
    else tourStep.set(step + 1)
  }
  function back() {
    if (step !== null && step > 0) tourStep.set(step - 1)
  }
</script>

{#if step !== null && STEPS[step] !== undefined}
  <div class="tour" role="dialog" aria-label="Guided tour">
    <div class="tour-head">
      <strong>{STEPS[step].title}</strong>
      <button class="close" aria-label="Close the tour" onclick={close}>✕</button>
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
        <button class="primary" onclick={next}>
          {step >= STEPS.length - 1 ? 'Done' : 'Next'}
        </button>
      </span>
    </div>
  </div>
{/if}

<style>
  .tour {
    position: fixed;
    left: 270px;
    bottom: 56px;
    width: 330px;
    z-index: 40;
    background: var(--surface-raised, var(--surface));
    border: 1px solid var(--accent);
    border-radius: 10px;
    padding: 12px 14px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
    font-size: 13px;
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
</style>
