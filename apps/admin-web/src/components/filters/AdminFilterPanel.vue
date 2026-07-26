<script setup lang="ts">
import { ref, useSlots } from 'vue';

const props = withDefaults(
  defineProps<{
    loading?: boolean;
    advancedCount?: number;
  }>(),
  { loading: false, advancedCount: 0 },
);

const emit = defineEmits<{
  search: [];
  reset: [];
}>();

const slots = useSlots();
const expanded = ref(false);

function resetFilters(): void {
  expanded.value = false;
  emit('reset');
}
</script>

<template>
  <form class="admin-filter-panel" @submit.prevent="emit('search')">
    <div class="admin-filter-panel__grid">
      <slot />
    </div>

    <div v-if="slots.advanced && expanded" class="admin-filter-panel__advanced">
      <div class="admin-filter-panel__grid">
        <slot name="advanced" />
      </div>
    </div>

    <div class="admin-filter-panel__actions">
      <el-button
        v-if="slots.advanced"
        data-testid="toggle-advanced"
        :disabled="props.loading"
        @click="expanded = !expanded"
      >
        {{
          expanded
            ? '收起筛选'
            : `更多筛选${props.advancedCount ? ` (${props.advancedCount})` : ''}`
        }}
      </el-button>
      <el-button
        data-testid="reset-filters"
        :disabled="props.loading"
        @click="resetFilters"
      >
        重置
      </el-button>
      <el-button
        type="primary"
        data-testid="search-filters"
        :disabled="props.loading"
        :loading="props.loading"
        @click="emit('search')"
      >
        查询
      </el-button>
    </div>
  </form>
</template>

<style scoped>
.admin-filter-panel {
  display: grid;
  width: 100%;
  min-width: 0;
  gap: 14px;
}

.admin-filter-panel__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 14px 16px;
  align-items: end;
}

.admin-filter-panel__advanced {
  padding-top: 14px;
  border-top: 1px dashed var(--admin-line);
}

.admin-filter-panel__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.admin-filter-panel :deep(.el-form-item) {
  display: block;
  width: 100%;
  margin: 0;
}

.admin-filter-panel :deep(.el-form-item__label) {
  display: block;
  height: auto;
  margin-bottom: 6px;
  line-height: 1.4;
  text-align: left;
}

.admin-filter-panel :deep(.el-form-item__content) {
  display: block;
  width: 100%;
  min-width: 0;
  line-height: normal;
}

.admin-filter-panel :deep(.el-input),
.admin-filter-panel :deep(.el-select),
.admin-filter-panel :deep(.el-date-editor),
.admin-filter-panel :deep(.el-input-number) {
  width: 100%;
}
</style>
