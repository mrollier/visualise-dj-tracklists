<script lang="ts">
  // Six tiny sparks flying out radially from the parent's centre (v12 WS2).
  // The parent needs position: relative; mount with `active` for ~600ms.
  const SPARKS = [0, 60, 120, 180, 240, 300]
  let { active = false }: { active?: boolean } = $props()
</script>

{#if active}
  <span class="burst" aria-hidden="true">
    {#each SPARKS as angle, i (angle)}
      <i style:--angle="{angle}deg" style:--dist="{i % 2 === 0 ? 24 : 17}px"></i>
    {/each}
  </span>
{/if}

<style>
  .burst {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: visible;
  }

  .burst i {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    animation: spark 550ms ease-out forwards;
  }

  @keyframes spark {
    from {
      opacity: 1;
      transform: translate(-50%, -50%) rotate(var(--angle)) translateX(3px) scale(1);
    }
    to {
      opacity: 0;
      transform: translate(-50%, -50%) rotate(var(--angle)) translateX(var(--dist)) scale(0.4);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .burst {
      display: none;
    }
  }
</style>
