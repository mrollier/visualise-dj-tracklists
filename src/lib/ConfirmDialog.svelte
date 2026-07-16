<script lang="ts">
  // Generic in-app confirmation, styled like ResetDialog (issue 6): the
  // caller passes the pending action to open() and it runs on confirm.
  interface Props {
    title: string
    body: string
    confirmLabel: string
    danger?: boolean
  }

  const { title, body, confirmLabel, danger = false }: Props = $props()

  let dialogEl: HTMLDialogElement
  let onConfirm: (() => void) | null = null

  export function open(confirmed: () => void) {
    onConfirm = confirmed
    dialogEl.showModal()
  }

  function confirm() {
    dialogEl.close()
    onConfirm?.()
    onConfirm = null
  }
</script>

<dialog bind:this={dialogEl} aria-labelledby="confirm-title">
  <h2 id="confirm-title">{title}</h2>
  <p>{body}</p>
  <div class="actions">
    <button onclick={() => dialogEl.close()}>Cancel</button>
    <button class:danger onclick={confirm}>{confirmLabel}</button>
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
