<script setup lang="ts">
import {
  HomepageLinkType,
  type HomepageLink,
  type HomepageShortcutGridSection,
} from '@bake-mall/contracts';

defineProps<{
  readonly section: HomepageShortcutGridSection<{ imageUrl: string }>;
}>();

const emit = defineEmits<{
  navigate: [link: HomepageLink];
}>();

function isInteractive(link: HomepageLink): boolean {
  return link.type !== HomepageLinkType.NONE;
}
</script>

<template>
  <section v-if="section.enabled" class="homepage-shortcuts">
    <header>
      <small>QUICK PICKS</small>
      <h2>{{ section.title }}</h2>
    </header>
    <div class="homepage-shortcuts__grid" :data-layout="section.layout">
      <component
        :is="isInteractive(item.link) ? 'button' : 'div'"
        v-for="item in section.items"
        :key="item.id"
        :type="isInteractive(item.link) ? 'button' : undefined"
        class="homepage-shortcuts__item"
        @click="isInteractive(item.link) && emit('navigate', item.link)"
      >
        <img :src="item.image.imageUrl" alt="" />
        <strong>{{ item.label }}</strong>
      </component>
    </div>
  </section>
</template>

<style scoped>
.homepage-shortcuts header {
  margin-bottom: var(--mall-space-4);
}

.homepage-shortcuts small {
  color: var(--mall-primary-strong);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.homepage-shortcuts h2 {
  margin: var(--mall-space-1) 0 0;
  font-size: 22px;
}

.homepage-shortcuts__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--mall-space-4) var(--mall-space-3);
}

.homepage-shortcuts__grid[data-layout='4'] {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.homepage-shortcuts__grid[data-layout='5'] .homepage-shortcuts__item:nth-child(4) {
  grid-column: 1 / 2;
  transform: translateX(50%);
}

.homepage-shortcuts__grid[data-layout='5'] .homepage-shortcuts__item:nth-child(5) {
  grid-column: 2 / 3;
  transform: translateX(50%);
}

.homepage-shortcuts__item {
  display: flex;
  min-width: 0;
  min-height: 44px;
  padding: 0;
  flex-direction: column;
  align-items: center;
  gap: var(--mall-space-2);
  border: 0;
  background: transparent;
  color: var(--mall-text);
  font: inherit;
  text-align: center;
}

button.homepage-shortcuts__item {
  cursor: pointer;
}

.homepage-shortcuts__item img {
  width: min(100%, 72px);
  aspect-ratio: 1;
  border: 1px solid var(--mall-border);
  border-radius: 22px;
  background: var(--mall-surface-soft);
  box-shadow: var(--mall-shadow-card);
  object-fit: cover;
}

.homepage-shortcuts__item strong {
  display: -webkit-box;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

@media (max-width: 350px) {
  .homepage-shortcuts__grid[data-layout='4'] {
    gap-inline: 7px;
  }

  .homepage-shortcuts__item img {
    border-radius: 17px;
  }
}
</style>
