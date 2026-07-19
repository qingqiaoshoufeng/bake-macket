<script setup lang="ts">
const props = defineProps<{
  remark: string;
  remarkMaxLength: number;
  formError: string | null;
  submitError: string | null;
  disabled: boolean;
  submitting: boolean;
  totalCents: number;
}>();
const emit = defineEmits<{
  (event: 'update:remark', value: string): void;
  (event: 'submit'): void;
}>();
function updateRemark(event: Event): void {
  emit('update:remark', (event.target as HTMLTextAreaElement).value);
}
</script>

<template>
  <section class="store-form-card checkout__remark-card">
    <div class="store-form-card__heading">
      <span>05</span>
      <h2>订单备注</h2>
    </div>
    <label class="checkout__control"
      ><span>可选,最多 {{ remarkMaxLength }} 字</span
      ><textarea
        :value="props.remark"
        rows="3"
        :maxlength="remarkMaxLength"
        placeholder="可填写祝福语或定制需求"
        data-testid="remark"
        @input="updateRemark"
      />
    </label>
  </section>
  <p
    v-if="formError"
    class="checkout__error"
    role="alert"
    data-testid="form-error"
  >
    {{ formError }}
  </p>
  <p
    v-else-if="submitError"
    class="checkout__error"
    role="alert"
    data-testid="submit-error"
  >
    {{ submitError }}
  </p>
  <button
    type="submit"
    class="store-primary-action checkout__submit"
    :disabled="disabled"
    :aria-disabled="disabled"
    data-testid="submit"
    @click.prevent="emit('submit')"
  >
    {{
      submitting ? '提交中…' : `提交订单 · ¥${(totalCents / 100).toFixed(2)}`
    }}
  </button>
</template>

<style scoped>
.store-form-card {
  margin: 0;
  padding: var(--mall-space-4);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-card);
  background: var(--mall-surface);
  box-shadow: var(--mall-shadow-card);
}
.store-form-card__heading {
  display: flex;
  align-items: center;
  gap: var(--mall-space-2);
  color: var(--mall-text);
}
.store-form-card__heading > span {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 50%;
  background: var(--mall-surface-soft);
  color: var(--mall-primary-strong);
  font-size: 10px;
  font-weight: 700;
}
.store-form-card__heading h2 {
  margin: 0;
  font-size: 15px;
}
.checkout__remark-card {
  display: grid;
  gap: var(--mall-space-3);
}
.checkout__control {
  display: grid;
  gap: var(--mall-space-1);
}
.checkout__control > span {
  color: var(--mall-text-muted);
  font-size: 12px;
}
.checkout__control textarea {
  width: 100%;
  min-height: 88px;
  padding: var(--mall-space-2) var(--mall-space-3);
  border: 1px solid var(--mall-border);
  border-radius: var(--mall-radius-control);
  outline: none;
  background: var(--mall-canvas);
  color: var(--mall-text);
  font: inherit;
  font-size: 14px;
  resize: vertical;
}
.checkout__control textarea:focus {
  border-color: var(--mall-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mall-primary) 14%, transparent);
}
.checkout__error {
  margin: 0;
  padding: var(--mall-space-3);
  border-radius: var(--mall-radius-control);
  background: color-mix(in srgb, var(--mall-danger) 9%, var(--mall-surface));
  color: var(--mall-danger);
  font-size: 13px;
}
.store-primary-action {
  min-height: 48px;
  padding: 0 var(--mall-space-5);
  border: 0;
  border-radius: var(--mall-radius-card);
  background: var(--mall-primary);
  color: #fff;
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}
.store-primary-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
