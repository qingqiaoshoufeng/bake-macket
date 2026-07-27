<script setup lang="ts">
import {
  MembershipLevelStatus,
  type MembershipBenefit,
  type MembershipTheme,
} from '@bake-mall/contracts';
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElOption,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
} from 'element-plus';
import { computed } from 'vue';

import { MEMBERSHIP_THEME_OPTIONS } from '../config/themes.js';
import type { MembershipCardForm as MembershipCardFormShape } from '../type/index.js';
import MembershipCardPreview from './MembershipCardPreview.vue';

const props = defineProps<{
  readonly form: MembershipCardFormShape;
  readonly editing: boolean;
  readonly saving: boolean;
}>();

const emit = defineEmits<{
  'update:form': [form: MembershipCardFormShape];
  submit: [];
}>();

const grantRatioWarning = computed(() => {
  const price = props.form.priceYuan;
  const grant = props.form.grantCreditYuan;
  if (
    !/^\d+(?:\.\d{1,2})?$/.test(price) ||
    !/^\d+(?:\.\d{1,2})?$/.test(grant)
  ) {
    return null;
  }
  const [priceYuan, priceDecimal = ''] = price.split('.');
  const [grantYuan, grantDecimal = ''] = grant.split('.');
  const priceCents =
    Number.parseInt(priceYuan, 10) * 100 +
    Number.parseInt(priceDecimal.padEnd(2, '0') || '0', 10);
  const grantCents =
    Number.parseInt(grantYuan, 10) * 100 +
    Number.parseInt(grantDecimal.padEnd(2, '0') || '0', 10);
  return grantCents > priceCents && priceCents > 0
    ? `赠送消费金高于卡价（约 ${Math.floor((grantCents * 10) / priceCents) / 10} 倍），请再次核对。`
    : null;
});

function updateForm(patch: Partial<MembershipCardFormShape>): void {
  emit('update:form', { ...props.form, ...patch });
}

function updateBenefit(index: number, patch: Partial<MembershipBenefit>): void {
  updateForm({
    benefits: props.form.benefits.map((benefit, currentIndex) =>
      currentIndex === index ? { ...benefit, ...patch } : { ...benefit },
    ),
  });
}

function addBenefit(): void {
  updateForm({
    benefits: [
      ...props.form.benefits.map((benefit) => ({ ...benefit })),
      { title: '', description: '', sortOrder: props.form.benefits.length },
    ],
  });
}

function removeBenefit(index: number): void {
  updateForm({
    benefits: props.form.benefits
      .filter((_benefit, currentIndex) => currentIndex !== index)
      .map((benefit, sortOrder) => ({ ...benefit, sortOrder })),
  });
}

function selectTheme(theme: MembershipTheme): void {
  updateForm({ theme });
}
</script>

<template>
  <div class="membership-form-layout">
    <ElForm
      class="membership-form"
      label-position="top"
      @submit.prevent="emit('submit')"
    >
      <section class="membership-form__section">
        <header>
          <span>01 · 基础配方</span>
          <h2>等级与展示信息</h2>
        </header>
        <div class="membership-form__grid membership-form__grid--two">
          <ElFormItem label="等级编码 code" required>
            <ElInput
              data-testid="membership-code"
              :model-value="form.code"
              :disabled="editing"
              maxlength="64"
              placeholder="例如 PEARL_90"
              @update:model-value="
                updateForm({ code: String($event).toUpperCase() })
              "
            />
            <small>创建后不可修改，只允许大写字母、数字和下划线。</small>
          </ElFormItem>
          <ElFormItem label="名称" required>
            <ElInput
              :model-value="form.name"
              maxlength="128"
              @update:model-value="updateForm({ name: String($event) })"
            />
          </ElFormItem>
          <ElFormItem label="副标题">
            <ElInput
              :model-value="form.subtitle"
              maxlength="256"
              @update:model-value="updateForm({ subtitle: String($event) })"
            />
          </ElFormItem>
          <ElFormItem label="徽标文案" required>
            <ElInput
              :model-value="form.badgeText"
              maxlength="32"
              placeholder="例如 HOUSE RECIPE"
              @update:model-value="updateForm({ badgeText: String($event) })"
            />
          </ElFormItem>
        </div>
        <ElFormItem label="详情">
          <ElInput
            type="textarea"
            :rows="3"
            :model-value="form.description"
            @update:model-value="updateForm({ description: String($event) })"
          />
        </ElFormItem>
      </section>

      <section class="membership-form__section">
        <header>
          <span>02 · 权益计量</span>
          <h2>价格、等级与有效期</h2>
        </header>
        <div class="membership-form__grid membership-form__grid--four">
          <ElFormItem label="业务等级 rank" required>
            <ElInputNumber
              :model-value="form.rank"
              :min="1"
              :max="4294967295"
              controls-position="right"
              @update:model-value="updateForm({ rank: Number($event ?? 1) })"
            />
            <small>决定升级与降购，全局唯一。</small>
          </ElFormItem>
          <ElFormItem label="展示排序 sortOrder" required>
            <ElInputNumber
              :model-value="form.sortOrder"
              :min="0"
              :max="4294967295"
              controls-position="right"
              @update:model-value="
                updateForm({ sortOrder: Number($event ?? 0) })
              "
            />
            <small>只决定前台展示顺序。</small>
          </ElFormItem>
          <ElFormItem label="价格（元）" required>
            <ElInput
              :model-value="form.priceYuan"
              inputmode="decimal"
              @update:model-value="updateForm({ priceYuan: String($event) })"
            />
          </ElFormItem>
          <ElFormItem label="赠送消费金（元）" required>
            <ElInput
              :model-value="form.grantCreditYuan"
              inputmode="decimal"
              @update:model-value="
                updateForm({ grantCreditYuan: String($event) })
              "
            />
          </ElFormItem>
          <ElFormItem label="会员折扣（折）" required>
            <ElInput
              :model-value="form.discountText"
              inputmode="decimal"
              placeholder="1.0–10.0"
              @update:model-value="updateForm({ discountText: String($event) })"
            />
          </ElFormItem>
          <ElFormItem label="有效天数" required>
            <ElInputNumber
              :model-value="form.validDays"
              :min="1"
              :max="3650"
              controls-position="right"
              @update:model-value="
                updateForm({ validDays: Number($event ?? 1) })
              "
            />
          </ElFormItem>
          <ElFormItem label="配置状态" required>
            <ElSelect
              :model-value="form.status"
              @update:model-value="
                updateForm({ status: $event as MembershipLevelStatus })
              "
            >
              <ElOption
                label="下架草稿"
                :value="MembershipLevelStatus.INACTIVE"
              />
              <ElOption label="已上架" :value="MembershipLevelStatus.ACTIVE" />
            </ElSelect>
          </ElFormItem>
        </div>
        <ElAlert
          v-if="grantRatioWarning"
          type="warning"
          :title="grantRatioWarning"
          :closable="false"
          show-icon
        />
      </section>

      <section class="membership-form__section">
        <header class="membership-form__section-head">
          <div>
            <span>03 · 有序权益</span>
            <h2>会员权益列表</h2>
          </div>
          <ElButton data-testid="add-benefit" @click="addBenefit">
            添加权益
          </ElButton>
        </header>
        <p v-if="form.benefits.length === 0" class="membership-form__empty">
          下架草稿可以暂不填写；上架前至少添加一条权益。
        </p>
        <div v-else class="membership-form__benefits">
          <div
            v-for="(benefit, index) in form.benefits"
            :key="`${benefit.sortOrder}-${index}`"
            class="membership-form__benefit"
          >
            <span aria-hidden="true">{{
              String(index + 1).padStart(2, '0')
            }}</span>
            <ElInput
              :model-value="benefit.title"
              placeholder="权益标题"
              @update:model-value="
                updateBenefit(index, { title: String($event) })
              "
            />
            <ElInput
              :model-value="benefit.description ?? ''"
              placeholder="补充说明（可选）"
              @update:model-value="
                updateBenefit(index, { description: String($event) })
              "
            />
            <ElButton
              type="danger"
              plain
              :aria-label="`删除第 ${index + 1} 条权益`"
              @click="removeBenefit(index)"
            >
              删除
            </ElButton>
          </div>
        </div>
      </section>

      <section class="membership-form__section">
        <header>
          <span>04 · 卡面烘焙</span>
          <h2>受控主题预览</h2>
        </header>
        <ElRadioGroup
          :model-value="form.theme"
          class="membership-form__themes"
          aria-label="卡面主题"
          @update:model-value="selectTheme($event as MembershipTheme)"
        >
          <ElRadioButton
            v-for="option in MEMBERSHIP_THEME_OPTIONS"
            :key="option.value"
            :value="option.value"
            data-testid="theme-option"
          >
            {{ option.label }} · {{ option.value }}
          </ElRadioButton>
        </ElRadioGroup>
      </section>

      <footer class="membership-form__actions">
        <ElButton
          native-type="submit"
          type="primary"
          :loading="saving"
          data-testid="save-membership-card"
        >
          保存更改
        </ElButton>
      </footer>
    </ElForm>

    <aside class="membership-form-layout__preview" aria-label="会员卡实时预览">
      <p>LIVE RECIPE CARD</p>
      <MembershipCardPreview
        data-testid="membership-card-preview"
        :name="form.name"
        :subtitle="form.subtitle"
        :badge-text="form.badgeText"
        :theme="form.theme"
        :discount-text="form.discountText"
        :price-yuan="form.priceYuan"
        :grant-credit-yuan="form.grantCreditYuan"
        :valid-days="form.validDays"
      />
      <small>预览只使用受控主题 token，不接受任意颜色或 CSS。</small>
    </aside>
  </div>
</template>

<style scoped>
.membership-form-layout {
  display: grid;
  align-items: start;
  grid-template-columns: minmax(0, 1.45fr) minmax(330px, 0.8fr);
  gap: 22px;
}

.membership-form {
  display: grid;
  gap: 18px;
}

.membership-form__section,
.membership-form-layout__preview {
  padding: 22px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-card);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-card);
}

.membership-form__section > header {
  margin-bottom: 18px;
}

.membership-form__section header span,
.membership-form-layout__preview > p {
  color: var(--admin-mint);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.membership-form__section h2,
.membership-form-layout__preview > p {
  margin: 0;
}

.membership-form__section h2 {
  margin-top: 5px;
  color: var(--admin-text);
  font-size: 18px;
}

.membership-form__grid {
  display: grid;
  gap: 0 16px;
}

.membership-form__grid--two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.membership-form__grid--four {
  grid-template-columns: repeat(4, minmax(120px, 1fr));
}

.membership-form :deep(.el-form-item__content) > small {
  width: 100%;
  margin-top: 5px;
  color: var(--admin-muted);
  font-size: 11px;
  line-height: 1.5;
}

.membership-form :deep(.el-input-number),
.membership-form :deep(.el-select) {
  width: 100%;
}

.membership-form__section-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
}

.membership-form__empty {
  margin: 0;
  padding: 18px;
  border: 1px dashed var(--admin-border);
  border-radius: 12px;
  color: var(--admin-muted);
  font-size: 13px;
  text-align: center;
}

.membership-form__benefits {
  display: grid;
  gap: 10px;
}

.membership-form__benefit {
  display: grid;
  align-items: center;
  grid-template-columns: 34px minmax(140px, 0.8fr) minmax(180px, 1.2fr) auto;
  gap: 10px;
}

.membership-form__benefit > span {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid var(--admin-border);
  border-radius: 9px;
  color: var(--admin-primary);
  font-size: 10px;
  font-weight: 800;
}

.membership-form__themes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.membership-form__themes :deep(.el-radio-button__inner) {
  width: 100%;
  border: 1px solid var(--admin-border) !important;
  border-radius: 10px !important;
  box-shadow: none !important;
  text-align: left;
}

.membership-form__actions {
  position: sticky;
  z-index: 3;
  bottom: 14px;
  display: flex;
  justify-content: flex-end;
  padding: 12px;
  border: 1px solid var(--admin-border);
  border-radius: 14px;
  background: rgb(255 255 255 / 90%);
  box-shadow: 0 12px 30px rgb(73 57 105 / 12%);
  backdrop-filter: blur(12px);
}

.membership-form-layout__preview {
  position: sticky;
  top: calc(var(--admin-topbar-height) + 22px);
  display: grid;
  gap: 15px;
  background: var(--admin-surface-soft);
}

.membership-form-layout__preview > small {
  color: var(--admin-muted);
  font-size: 11px;
  line-height: 1.5;
}

@media (max-width: 1180px) {
  .membership-form-layout {
    grid-template-columns: 1fr;
  }

  .membership-form-layout__preview {
    position: static;
  }

  .membership-form__grid--four {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .membership-form__grid--two,
  .membership-form__grid--four,
  .membership-form__themes,
  .membership-form__benefit {
    grid-template-columns: 1fr;
  }

  .membership-form__benefit > span {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .membership-form__actions {
    backdrop-filter: none;
  }
}
</style>
