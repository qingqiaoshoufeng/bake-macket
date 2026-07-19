<script setup lang="ts">
import type { OrderFlow, OrderFlowState } from '../type/index.js';

defineProps<{
  readonly flow: OrderFlow;
}>();

const stateClass = (state: OrderFlowState): string =>
  `order-flow-state--${state.tone}`;
</script>

<template>
  <section class="order-flow-guide" aria-labelledby="order-flow-title">
    <div class="order-flow-guide__head">
      <div>
        <p>ORDER FLOW</p>
        <h2 id="order-flow-title">订单处理流程</h2>
      </div>
      <span>按合法状态流转处理订单，历史快照保持不变。</span>
    </div>

    <div class="order-flow-guide__diagram" aria-label="订单状态流转">
      <article
        class="order-flow-state"
        :class="stateClass(flow.incoming)"
        :data-flow-stage="flow.incoming.status"
      >
        <span class="order-flow-state__status">{{ flow.incoming.status }}</span>
        <h3>{{ flow.incoming.title }}</h3>
        <p>{{ flow.incoming.description }}</p>
      </article>

      <span class="order-flow-guide__arrow" aria-hidden="true">→</span>

      <article
        class="order-flow-state"
        :class="stateClass(flow.processing)"
        :data-flow-stage="flow.processing.status"
      >
        <span class="order-flow-state__status">
          {{ flow.processing.status }}
        </span>
        <h3>{{ flow.processing.title }}</h3>
        <p>{{ flow.processing.description }}</p>
      </article>

      <span class="order-flow-guide__branch-arrow" aria-hidden="true">⇢</span>

      <div class="order-flow-guide__outcomes" data-flow-stage="OUTCOMES">
        <span class="order-flow-guide__branch-label">二选一结果</span>
        <article
          v-for="outcome in flow.outcomes"
          :key="outcome.status"
          class="order-flow-state order-flow-state--outcome"
          :class="stateClass(outcome)"
          :data-outcome="outcome.status"
        >
          <span class="order-flow-state__status">{{ outcome.status }}</span>
          <h3>{{ outcome.title }}</h3>
          <p>{{ outcome.description }}</p>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.order-flow-guide {
  display: grid;
  gap: 22px;
  padding: clamp(22px, 3vw, 30px);
  background: var(--admin-surface);
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-feature);
  box-shadow: var(--admin-shadow-card);
}

.order-flow-guide__head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
}

.order-flow-guide__head p {
  margin: 0 0 5px;
  color: var(--admin-primary);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.order-flow-guide__head h2 {
  margin: 0;
  color: var(--admin-text);
  font-size: 20px;
}

.order-flow-guide__head > span {
  color: var(--admin-muted);
  font-size: 13px;
}

.order-flow-guide__diagram {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(
      0,
      1.45fr
    );
  align-items: center;
  gap: 14px;
}

.order-flow-guide__arrow,
.order-flow-guide__branch-arrow {
  color: var(--admin-primary);
  font-size: 22px;
  font-weight: 800;
}

.order-flow-guide__branch-arrow {
  color: var(--admin-muted);
}

.order-flow-state {
  --flow-accent: var(--admin-primary);
  --flow-soft: var(--admin-primary-soft);

  min-height: 128px;
  padding: 17px;
  background: var(--flow-soft);
  border: 1px solid color-mix(in srgb, var(--flow-accent) 20%, white);
  border-radius: 14px;
}

.order-flow-state--pink {
  --flow-accent: #bd5c81;
  --flow-soft: #fbeaf1;
}

.order-flow-state--mint {
  --flow-accent: #477d68;
  --flow-soft: #e9f4ef;
}

.order-flow-state--muted {
  --flow-accent: #716b7a;
  --flow-soft: #f0eef2;
}

.order-flow-state__status {
  color: var(--flow-accent);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.order-flow-state h3 {
  margin: 7px 0 6px;
  color: var(--admin-text);
  font-size: 15px;
}

.order-flow-state p {
  margin: 0;
  color: var(--admin-muted);
  font-size: 12px;
  line-height: 1.6;
}

.order-flow-guide__outcomes {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding-top: 22px;
}

.order-flow-guide__branch-label {
  position: absolute;
  top: 0;
  left: 0;
  color: var(--admin-muted);
  font-size: 10px;
  font-weight: 700;
}

.order-flow-state--outcome {
  min-height: 128px;
}

@media (max-width: 1160px) {
  .order-flow-guide__diagram {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  }

  .order-flow-guide__branch-arrow {
    display: none;
  }

  .order-flow-guide__outcomes {
    grid-column: 1 / -1;
  }
}

@media (max-width: 720px) {
  .order-flow-guide__head {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }

  .order-flow-guide__diagram,
  .order-flow-guide__outcomes {
    grid-template-columns: 1fr;
  }

  .order-flow-guide__arrow {
    transform: rotate(90deg);
    justify-self: center;
  }
}
</style>
