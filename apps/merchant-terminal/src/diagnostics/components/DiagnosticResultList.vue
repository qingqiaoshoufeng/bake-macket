<script setup lang="ts">
import { DIAGNOSTIC_STEP_LABELS } from '../config/diagnostic-steps.js';
import type { DiagnosticStepResult } from '../type/index.js';

defineProps<{
  results: readonly DiagnosticStepResult[];
}>();
</script>

<template>
  <view class="result-list">
    <view
      v-for="result in results"
      :key="result.step"
      class="result-list__item"
    >
      <text class="result-list__label">
        {{ DIAGNOSTIC_STEP_LABELS[result.step] }}
      </text>
      <text
        :class="`result-list__outcome result-list__outcome--${result.outcome.toLowerCase()}`"
      >
        {{ result.outcome }}
      </text>
      <text class="result-list__detail">{{ result.detail }}</text>
    </view>
  </view>
</template>

<style scoped>
.result-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.result-list__item {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8rpx 20rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  background: #ffffff;
}

.result-list__label {
  font-weight: 600;
}

.result-list__outcome--passed {
  color: #2e7d5a;
}

.result-list__outcome--failed {
  color: #b94848;
}

.result-list__outcome--skipped {
  color: #8a776e;
}

.result-list__detail {
  grid-column: 1 / -1;
  color: #75645d;
  font-size: 24rpx;
}
</style>
