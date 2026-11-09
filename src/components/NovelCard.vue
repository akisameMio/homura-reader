<template>
  <!-- 纸页：整块画布是纸，正文栏按舞台下发的宽度排版，页脚单独占 24px -->
  <article class="reader-page">
    <div class="reader-page-flow md-reader-prose" v-html="page.html"></div>
    <footer class="reader-page-folio" aria-hidden="true">{{ page.pageNumber }}</footer>
  </article>
</template>

<script setup lang="ts">
defineProps({
  page: { type: Object, required: true }
});
</script>
