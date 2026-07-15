<script lang="ts">
  import { GENRE_METHODS } from '../core/genre'
  import { SAMPLE_PACKS } from '../data/samples'
  import { criteria, library, libraryName, settings } from '../stores'
  import { loadSamplePack } from './persistence'

  let open = $state(false)
  let menuEl: HTMLDivElement | undefined = $state()
  let packId = $state(SAMPLE_PACKS[0].id)

  const selectedPack = $derived(SAMPLE_PACKS.find((p) => p.id === packId) ?? SAMPLE_PACKS[0])

  function loadPack() {
    const overwritingOwnWork = $library.length > 0 && !$libraryName.toLowerCase().includes('sample')
    if (
      overwritingOwnWork &&
      !confirm(`Replace the current library and set with "${selectedPack.name}"?`)
    ) {
      return
    }
    loadSamplePack(selectedPack)
  }

  const METHOD_LABEL = {
    exact: 'Exact match',
    lexical: 'Lexical (word overlap)',
    graph: 'Genre graph (curated relations)',
    taxonomy: 'Taxonomy (Lin, rooted tree)',
    embedding: 'Embedding (co-occurrence pack)',
  } as const

  const METHOD_EXPLAINER = {
    exact: 'Only identical genres match (after normalization: DnB = Drum & Bass).',
    lexical: 'Genres sharing words match: Melodic House ~ House, but not Techno ~ Tech House.',
    graph: 'Follows a curated genre family tree (editable JSON in the repo): Techno ~ Tech House.',
    taxonomy:
      'Lin similarity over a rooted genre tree: deep shared ancestry counts, umbrella labels do not.',
    embedding:
      'Statistical relatedness learned from how real-world listeners tag music (AcousticBrainz).',
  } as const

  function onWindowClick(e: MouseEvent) {
    if (open && menuEl && !menuEl.contains(e.target as Node)) open = false
  }
</script>

<svelte:window
  onclick={onWindowClick}
  onkeydown={(e) => {
    if (e.key === 'Escape') open = false
  }}
/>

<div class="advanced" bind:this={menuEl}>
  <button
    aria-haspopup="true"
    aria-expanded={open}
    title="Advanced options"
    onclick={() => (open = !open)}
  >
    ⚙ Advanced
  </button>

  {#if open}
    <div class="panel" role="menu">
      <section>
        <h3>Genre matching</h3>
        <label>
          Method
          <select bind:value={$criteria.genre.method}>
            {#each GENRE_METHODS as method (method)}
              <option value={method}>{METHOD_LABEL[method]}</option>
            {/each}
          </select>
        </label>
        <p class="hint">{METHOD_EXPLAINER[$criteria.genre.method]}</p>
        {#if $criteria.genre.method !== 'exact'}
          <label>
            Similarity ≥ <strong>{$criteria.genre.threshold.toFixed(2)}</strong>
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              bind:value={$criteria.genre.threshold}
            />
          </label>
          <p class="hint">
            Lower = looser matching. With the graph method, 0.6 accepts direct relatives, 0.36 two
            steps apart.
          </p>
        {/if}
      </section>

      <section>
        <h3>Key</h3>
        <label class="row">
          <input type="checkbox" bind:checked={$criteria.key.advancedMoves} />
          allow +2 / +7-semitone moves
        </label>
        <label class="row">
          <input type="checkbox" bind:checked={$criteria.key.vinylMode} />
          vinyl mode
        </label>
        <p class="hint">
          Beatmatching on vinyl shifts pitch with tempo: keys are compared after the tempo-induced
          transposition (when the gap lands on a whole semitone).
        </p>
      </section>

      <section>
        <h3>Display</h3>
        <label>
          Colour scheme
          <select bind:value={$settings.colorScheme}>
            <option value="blue">Blue</option>
            <option value="aqua">Aqua</option>
            <option value="violet">Violet</option>
          </select>
        </label>
        <label>
          Same-key spread <strong>{$settings.slotSpreadDeg}°</strong>
          <input type="range" min="0" max="15" step="1" bind:value={$settings.slotSpreadDeg} />
        </label>
        <label>
          Edge opacity <strong>{$settings.edgeOpacity.toFixed(2)}</strong>
          <input type="range" min="0.05" max="0.9" step="0.05" bind:value={$settings.edgeOpacity} />
        </label>
      </section>

      <section>
        <h3>Suggestions</h3>
        <label>
          Suggested set length
          <input type="number" min="2" max="99" bind:value={$settings.suggestLength} />
        </label>
        <label>
          Adventurousness <strong>{$settings.suggestRandomness.toFixed(2)}</strong>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            bind:value={$settings.suggestRandomness}
          />
        </label>
        <p class="hint">
          0 always picks the safest transition; higher values embrace dissonance. Genre closeness
          always counts in the ranking.
        </p>
      </section>

      <section>
        <h3>Sample libraries</h3>
        <label>
          Pack
          <select bind:value={packId}>
            {#each SAMPLE_PACKS as p (p.id)}
              <option value={p.id}>{p.name}</option>
            {/each}
          </select>
        </label>
        <p class="hint">{selectedPack.description}</p>
        <button class="load-pack" onclick={loadPack}>Load pack + demo set</button>
      </section>
    </div>
  {/if}
</div>

<style>
  .advanced {
    position: relative;
  }

  .panel {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 20;
    width: 280px;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 14px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
  }

  section {
    padding: 8px 0;
    border-bottom: 1px solid var(--grid);
  }

  section:last-child {
    border-bottom: none;
  }

  h3 {
    margin: 0 0 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-muted);
  }

  label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 0;
    font-size: 13px;
    flex-wrap: wrap;
  }

  label.row {
    justify-content: flex-start;
  }

  input[type='range'] {
    width: 100%;
    padding: 0;
  }

  input[type='number'] {
    width: 64px;
    padding: 2px 6px;
  }

  .hint {
    color: var(--ink-muted);
    font-size: 11px;
    margin: 2px 0 0;
  }

  .load-pack {
    margin-top: 6px;
    width: 100%;
    font-size: 12px;
  }
</style>
