<template>
  <p>{{ message }}</p>
</template>

<script setup lang="ts">
const message = window.location.pathname;

document.title = 'Bake Mall';
console.info(message);
</script>
