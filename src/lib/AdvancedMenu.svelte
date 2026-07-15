<script lang="ts">
  import { GENRE_METHODS } from '../core/genre'
  import type { Track } from '../core/model'
  import { type BpmProgression } from '../core/settings'
  import { SAMPLE_PACKS } from '../data/samples'
  import {
    criteria,
    mustInclude,
    pinnedFirst,
    pinnedLast,
    rightPanel,
    settings,
    trackById,
    visibleLibrary,
  } from '../stores'
  import { confirmReplaceLibrary, loadSamplePack } from './persistence'

  let packId = $state(SAMPLE_PACKS[0].id)

  const selectedPack = $derived(SAMPLE_PACKS.find((p) => p.id === packId) ?? SAMPLE_PACKS[0])

  function loadPack() {
    if (!confirmReplaceLibrary(selectedPack.name)) return
    loadSamplePack(selectedPack)
  }

  // --- Set order (design-v6 §C) ---
  // The pickers are the second home of the 📌 pins: picking here pins, and a
  // pinned set row prefills the picker. Options come from the visible
  // library; a pin that fell out of visibility is kept selectable on top.
  const PROGRESSION_LABEL: Record<BpmProgression, string> = {
    any: 'any (no preference)',
    steady: 'steady — hold the tempo',
    rising: 'rising — build up',
    falling: 'falling — wind down',
    sawtooth: 'sawtooth — build, drop, repeat',
  }
  const PROGRESSIONS = Object.keys(PROGRESSION_LABEL) as BpmProgression[]

  const sortedTracks = $derived(
    [...$visibleLibrary].sort(
      (a, b) => (a.artist ?? '~').localeCompare(b.artist ?? '~') || a.title.localeCompare(b.title),
    ),
  )
  function pickerOptions(pinnedId: string | null): Track[] {
    if (pinnedId === null || sortedTracks.some((t) => t.id === pinnedId)) return sortedTracks
    const pinned = $trackById.get(pinnedId)
    return pinned === undefined ? sortedTracks : [pinned, ...sortedTracks]
  }
  function trackLabel(track: Track): string {
    return `${track.artist ?? '?'} — ${track.title}`
  }
  function setPin(store: typeof pinnedFirst, value: string) {
    store.set(value === '' ? null : value)
  }
  function unmark(id: string) {
    mustInclude.update((ids) => ids.filter((x) => x !== id))
  }
  const mustIncludeTracks = $derived(
    $mustInclude.map((id) => $trackById.get(id)).filter((t): t is Track => t !== undefined),
  )

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

  function close() {
    rightPanel.set('set')
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') close()
  }}
/>

<!-- Lives in the right aside, swapping with "Your set" (design-v5 §E), so
     the wheel stays visible while settings change. -->
<aside class="panel">
  <div class="head">
    <h2 class="micro-label">Advanced settings</h2>
    <button
      class="close"
      aria-label="Close advanced settings"
      title="Back to your set"
      onclick={close}
    >
      ✕
    </button>
  </div>

  <!-- Grouped into collapsible sections (ISSUES.md #16): the workflow
       section opens by default, tuning sections stay folded. -->
  <details class="section" open>
    <summary>Set order</summary>
    <label>
      Opening track
      <select
        value={$pinnedFirst ?? ''}
        onchange={(e) => setPin(pinnedFirst, e.currentTarget.value)}
      >
        <option value="">— any —</option>
        {#each pickerOptions($pinnedFirst) as t (t.id)}
          <option value={t.id}>{trackLabel(t)}</option>
        {/each}
      </select>
    </label>
    <label>
      Closing track
      <select value={$pinnedLast ?? ''} onchange={(e) => setPin(pinnedLast, e.currentTarget.value)}>
        <option value="">— any —</option>
        {#each pickerOptions($pinnedLast) as t (t.id)}
          <option value={t.id}>{trackLabel(t)}</option>
        {/each}
      </select>
    </label>
    <p class="hint">
      Same as the 📌 pins on your set's first and last rows: suggested sets open and close on these
      tracks (with both set, the walk grows from both ends inward).
    </p>
    <label>
      BPM progression
      <select bind:value={$settings.bpmProgression}>
        {#each PROGRESSIONS as p (p)}
          <option value={p}>{PROGRESSION_LABEL[p]}</option>
        {/each}
      </select>
    </label>
    <p class="hint">
      Nudges each next pick toward the preferred tempo trajectory — combo criteria still come first.
    </p>
    <div class="must-block">
      <span class="must-title">Must include</span>
      {#if mustIncludeTracks.length === 0}
        <p class="hint">
          Select a track on the wheel and mark it "must include" — suggested sets will strongly
          favour working it in.
        </p>
      {:else}
        <ul class="must-list">
          {#each mustIncludeTracks as t (t.id)}
            <li>
              <span class="must-name">{trackLabel(t)}</span>
              <button
                class="unmark"
                title="Remove from must-include"
                aria-label="Remove {t.title} from must-include"
                onclick={() => unmark(t.id)}>✕</button
              >
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </details>

  <details class="section">
    <summary>Genre matching</summary>
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
          <input type="range" min="0" max="1" step="0.05" bind:value={$criteria.genre.threshold} />
        </label>
        <p class="hint">
          Genres link when each is in the other's top-k — self-calibrating where genre space is
          dense (electronic) or sparse; umbrella tags never count as neighbours.
          <a href="https://jmlr.org/papers/v11/radovanovic10a.html" target="_blank" rel="noreferrer"
            >[Radovanović et al. 2010]</a
          >
        </p>
      {:else}
        <label>
          Similarity ≥ <strong>{$criteria.genre.threshold.toFixed(2)}</strong>
          <input type="range" min="0" max="1" step="0.05" bind:value={$criteria.genre.threshold} />
        </label>
        <p class="hint">
          Lower = looser matching. With the graph method, 0.6 accepts direct relatives, 0.36 two
          steps apart.
        </p>
      {/if}
    {/if}
  </details>

  <details class="section">
    <summary>Key</summary>
    <label class="row">
      <input type="checkbox" bind:checked={$criteria.key.plusTwo} />
      allow +2 moves (energy jump)
    </label>
    <label class="row">
      <input type="checkbox" bind:checked={$criteria.key.plusSeven} />
      allow +7-semitone moves
    </label>
    <label class="row">
      <input type="checkbox" bind:checked={$criteria.key.vinylMode} />
      vinyl mode
    </label>
    <p class="hint">
      Beatmatching on vinyl shifts pitch with tempo, so keys are compared after the shift needed to
      beatmatch. Tempo gaps landing on a whole semitone transpose the key (+7 Camelot); gaps in
      between detune it — even same-key tracks lose their match. Gaps beyond the BPM tolerance (the
      pitch fader's range) can't beatmatch at all.
    </p>
  </details>

  <details class="section">
    <summary>Display</summary>
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
      <input type="range" min="0" max="7.5" step="0.5" bind:value={$settings.slotSpreadDeg} />
    </label>
    <label>
      Edge opacity <strong>{$settings.edgeOpacity.toFixed(2)}</strong>
      <input type="range" min="0" max="0.9" step="0.05" bind:value={$settings.edgeOpacity} />
    </label>
    <label>
      Max genre classes <strong>{$settings.maxGenreClasses}</strong>
      <input type="range" min="2" max="6" step="1" bind:value={$settings.maxGenreClasses} />
    </label>
    <p class="hint">
      Clearly different genre families get distinct node shapes (circle, square, triangle, …) up to
      this many classes — clustered with the selected genre method. Everything stays a circle when
      the library doesn't separate.
    </p>
  </details>

  <details class="section">
    <summary>Suggestions</summary>
    <label>
      Suggested set length
      <input type="number" min="2" max="99" bind:value={$settings.suggestLength} />
    </label>
    <label>
      Adventurousness <strong>{$settings.suggestRandomness.toFixed(2)}</strong>
      <input type="range" min="0" max="1" step="0.05" bind:value={$settings.suggestRandomness} />
    </label>
    <p class="hint">
      0 always picks the safest transition; higher values embrace dissonance. Genre closeness always
      counts in the ranking.
    </p>
  </details>

  <details class="section">
    <summary>Sample libraries</summary>
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
  </details>
</aside>

<style>
  .panel {
    width: 280px;
    flex-shrink: 0;
    background: var(--page);
    border-left: 1px solid var(--border);
    overflow-y: auto;
    padding: 0 14px 12px;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 12px 0 2px;
  }

  h2 {
    font-size: 14px;
    margin: 0;
  }

  .close {
    background: none;
    border: none;
    color: var(--ink-muted);
    font-size: 12px;
    padding: 2px 4px;
  }

  .close:hover {
    color: var(--ink);
  }

  .section {
    padding: 8px 0;
    border-bottom: 1px solid var(--grid);
  }

  .section:last-child {
    border-bottom: none;
  }

  summary {
    cursor: pointer;
    margin: 0 0 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-muted);
    user-select: none;
  }

  summary:hover {
    color: var(--ink-secondary);
  }

  .must-block {
    margin-top: 6px;
  }

  .must-title {
    display: block;
    font-size: 11px;
    color: var(--ink-secondary);
  }

  .must-list {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .must-list li {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 2px 4px 2px 8px;
  }

  .must-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .unmark {
    background: none;
    border: none;
    color: var(--ink-muted);
    font-size: 11px;
    padding: 1px 4px;
  }

  .unmark:hover {
    color: var(--ink);
  }

  select {
    max-width: 160px;
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
