<script setup lang="ts">
const props = defineProps<{ contactName: string; contactPhone: string }>();
const emit = defineEmits<{
  (event: 'update:contactName', value: string): void;
  (event: 'update:contactPhone', value: string): void;
}>();

function updateName(event: Event): void { emit('update:contactName', (event.target as HTMLInputElement).value); }
function updatePhone(event: Event): void { emit('update:contactPhone', (event.target as HTMLInputElement).value); }
</script>

<template>
  <section class="store-form-card checkout__contact">
    <div class="store-form-card__heading"><span>03</span><h2>联系人</h2></div>
    <label class="checkout__control"><span>联系人</span><input :value="props.contactName" type="text" maxlength="64" autocomplete="name" placeholder="联系人姓名" data-testid="contact-name" @input="updateName" /></label>
    <label class="checkout__control"><span>手机号</span><input :value="props.contactPhone" type="tel" inputmode="numeric" maxlength="11" autocomplete="tel" placeholder="11 位手机号" data-testid="contact-phone" @input="updatePhone" /></label>
  </section>
</template>

<style scoped>
.store-form-card { margin: 0; padding: var(--mall-space-4); border: 1px solid var(--mall-border); border-radius: var(--mall-radius-card); background: var(--mall-surface); box-shadow: var(--mall-shadow-card); }
.store-form-card__heading { display: flex; align-items: center; gap: var(--mall-space-2); color: var(--mall-text); }
.store-form-card__heading > span { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 50%; background: var(--mall-surface-soft); color: var(--mall-primary-strong); font-size: 10px; font-weight: 700; }
.store-form-card__heading h2 { margin: 0; font-size: 15px; }
.checkout__contact { display: grid; gap: var(--mall-space-3); }
.checkout__control { display: grid; gap: var(--mall-space-1); }
.checkout__control > span { color: var(--mall-text-muted); font-size: 12px; }
.checkout__control input { width: 100%; min-height: 44px; padding: var(--mall-space-2) var(--mall-space-3); border: 1px solid var(--mall-border); border-radius: var(--mall-radius-control); outline: none; background: var(--mall-canvas); color: var(--mall-text); font: inherit; font-size: 14px; }
.checkout__control input:focus { border-color: var(--mall-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--mall-primary) 14%, transparent); }
</style>
