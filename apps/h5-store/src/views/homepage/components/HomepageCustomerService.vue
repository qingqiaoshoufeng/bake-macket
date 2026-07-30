<script setup lang="ts">
import type { HomepageCustomerServiceSection } from '@bake-mall/contracts';
import { showImagePreview } from 'vant';

const props = defineProps<{
  readonly section: HomepageCustomerServiceSection<{ imageUrl: string }>;
}>();

function previewQrCode(): void {
  showImagePreview({ images: [props.section.wechatQrCode.imageUrl], closeable: true });
}
</script>

<template>
  <section v-if="section.enabled" class="homepage-service">
    <div class="homepage-service__copy">
      <small>BAKER SERVICE</small>
      <h2>{{ section.title }}</h2>
      <p>{{ section.description }}</p>
      <a :href="`tel:${section.phone}`">{{ section.phone }}</a>
      <span>{{ section.serviceHours }}</span>
    </div>
    <button type="button" class="homepage-service__qr" @click="previewQrCode">
      <img :src="section.wechatQrCode.imageUrl" alt="客服微信二维码" />
      <span>点击放大</span>
    </button>
  </section>
</template>

<style scoped>
.homepage-service {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(108px, 36%);
  gap: var(--mall-space-4);
  padding: var(--mall-space-5);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-feature);
  background:
    radial-gradient(circle at 95% 5%, rgb(233 168 111 / 20%), transparent 38%),
    var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
}

.homepage-service__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
}

.homepage-service small {
  color: var(--mall-primary-strong);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.homepage-service h2 {
  margin: var(--mall-space-1) 0 0;
  font-size: 22px;
}

.homepage-service p {
  margin: var(--mall-space-2) 0 var(--mall-space-4);
  color: var(--mall-text-muted);
  font-size: 13px;
  line-height: 1.6;
}

.homepage-service a {
  min-height: 44px;
  color: var(--mall-primary-strong);
  font-size: 17px;
  font-weight: 800;
  line-height: 44px;
}

.homepage-service__copy > span {
  color: var(--mall-text-muted);
  font-size: 12px;
}

.homepage-service__qr {
  display: grid;
  align-self: center;
  padding: var(--mall-space-2);
  place-items: center;
  gap: 6px;
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: #fff;
  color: var(--mall-text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 10px;
}

.homepage-service__qr img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
}
</style>
