<script lang="ts">
  import { resetEverything } from './persistence'

  let dialogEl: HTMLDialogElement

  export function open() {
    dialogEl.showModal()
  }

  function confirmReset() {
    resetEverything()
    dialogEl.close()
  }
</script>

<dialog bind:this={dialogEl} aria-labelledby="reset-title">
  <h2 id="reset-title">Reset everything?</h2>
  <p>
    This wipes the imported library, your set, all filters and settings, and the autosave in this
    browser. Exported files and saved project JSONs are not touched.
  </p>
  <div class="actions">
    <button onclick={() => dialogEl.close()}>Cancel</button>
    <button class="danger" onclick={confirmReset}>Reset everything</button>
  </div>
</dialog>

<style>
  dialog {
    background: var(--surface-raised);
    color: var(--ink);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 18px 20px;
    max-width: 380px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  }

  dialog::backdrop {
    background: rgba(0, 0, 0, 0.55);
  }

  h2 {
    margin: 0 0 8px;
    font-size: 15px;
  }

  p {
    margin: 0 0 14px;
    color: var(--ink-secondary);
    font-size: 13px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
