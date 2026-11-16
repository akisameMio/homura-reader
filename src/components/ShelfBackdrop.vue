<template>
  <div class="shelf-backdrop" aria-hidden="true">
    <div class="shelf-backdrop-crop">
      <svg class="shelf-edge-shape" viewBox="0 0 360 190" focusable="false">
        <path d="M360 42C310 12 278 30 238 18C190 4 151 20 123 43C81 44 49 67 35 94C12 108 -5 144 4 190H360V42Z" />
      </svg>
    </div>
  </div>
</template>

<style scoped>
  .shelf-backdrop {
    position: sticky;
    bottom: 0;
    z-index: -1;
    flex: none;
    width: 100%;
    height: 0;
    pointer-events: none;
    user-select: none;
  }

  .shelf-backdrop-crop {
    position: absolute;
    inset: auto 0 0;
    height: 96px;
    overflow: hidden;
  }

  .shelf-edge-shape {
    position: absolute;
    right: -28px;
    bottom: -128px;
    width: 360px;
    height: 190px;
    fill: var(--md-shelf-pebble);
    opacity: var(--md-shelf-decoration-opacity);
  }

  @media (max-width: 899px) {
    .shelf-backdrop { display: none; }
  }
</style>
