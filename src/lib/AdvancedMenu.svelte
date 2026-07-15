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
    hybrid: 'Hybrid (embedding + tree)',
  } as const

  interface MethodInfo {
    text: string
    sources: { label: string; href: string }[]
  }

  const METHOD_EXPLAINER: Record<keyof typeof METHOD_LABEL, MethodInfo> = {
    exact: {
      text: 'Only identical genres match, after alias normalization (DnB = Drum & Bass). Strict but blind to relatedness.',
      sources: [
        {
          label: 'Schreiber 2015',
          href: 'https://archives.ismir.net/ismir2015/paper/000102.pdf',
        },
      ],
    },
    lexical: {
      text: 'Word overlap (token Jaccard): Melodic House ~ House, but not Techno ~ Tech House. No data pack, no opinions.',
      sources: [
        {
          label: 'Tversky 1977',
          href: 'https://doi.org/10.1037/0033-295X.84.4.327',
        },
      ],
    },
    graph: {
      text: 'Shortest path through a curated genre-relation graph (editable JSON in the repo), decaying per step: Techno ~ Tech House. Treats every link as equally long — its known weakness.',
      sources: [{ label: 'Rada et al. 1989', href: 'https://doi.org/10.1109/21.24528' }],
    },
    taxonomy: {
      text: 'Lin similarity over a rooted genre tree: pairs sharing a deep, specific ancestor (Liquid DnB & Neurofunk) score high; pairs relating only through umbrella nodes (Electronic) score low.',
      sources: [
        {
          label: 'Lin 1998',
          href: 'https://dl.acm.org/doi/10.5555/645527.657297',
        },
      ],
    },
    embedding: {
      text: 'Statistical relatedness learned from ~2M real-world tag co-occurrences (AcousticBrainz), via PPMI + truncated SVD, with mutual-proximity hub correction.',
      sources: [
        {
          label: 'Levy & Goldberg 2014',
          href: 'https://papers.nips.cc/paper_files/paper/2014/hash/feab05aa91085b7a8012516bc3533958-Abstract.html',
        },
        {
          label: 'Schnitzer et al. 2012',
          href: 'https://jmlr.org/papers/v13/schnitzer12a.html',
        },
      ],
    },
    hybrid: {
      text: 'The embedding retrofitted toward the curated tree: real-world data where it exists, hand-audited lineage where it doesn’t. Best coverage of club subgenres — the recommended method.',
      sources: [{ label: 'Epure et al. 2020', href: 'https://arxiv.org/abs/2009.07755' }],
    },
  }

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
        <p class="hint">
          {METHOD_EXPLAINER[$criteria.genre.method].text}
          {#each METHOD_EXPLAINER[$criteria.genre.method].sources as source (source.href)}
            <a href={source.href} target="_blank" rel="noreferrer">[{source.label}]</a>
          {/each}
        </p>
        {#if $criteria.genre.method !== 'exact'}
          <label class="row">
            <input type="radio" value="topk" bind:group={$criteria.genre.mode} />
            k nearest (mutual)
            <input type="radio" value="threshold" bind:group={$criteria.genre.mode} />
            score threshold
          </label>
          {#if $criteria.genre.mode === 'topk'}
            <label>
              Link each genre to its <strong>{$criteria.genre.k}</strong> nearest
              <input type="range" min="1" max="15" step="1" bind:value={$criteria.genre.k} />
            </label>
            <label>
              Minimum score <strong>{$criteria.genre.threshold.toFixed(2)}</strong>
              <input
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                bind:value={$criteria.genre.threshold}
              />
            </label>
            <p class="hint">
              Genres link when each is in the other's top-k — self-calibrating where genre space is
              dense (electronic) or sparse; umbrella tags never count as neighbours.
              <a
                href="https://jmlr.org/papers/v11/radovanovic10a.html"
                target="_blank"
                rel="noreferrer">[Radovanović et al. 2010]</a
              >
            </p>
          {:else}
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
        <label>
          Max genre classes <strong>{$settings.maxGenreClasses}</strong>
          <input type="range" min="2" max="6" step="1" bind:value={$settings.maxGenreClasses} />
        </label>
        <p class="hint">
          Clearly different genre families get distinct node shapes (circle, square, triangle, …) up
          to this many classes — clustered with the selected genre method. Everything stays a circle
          when the library doesn't separate.
        </p>
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

  .hint a {
    color: var(--ink-secondary);
    margin-left: 4px;
    text-decoration: underline dotted;
  }

  .load-pack {
    margin-top: 6px;
    width: 100%;
    font-size: 12px;
  }
</style>
