import {
  ApiErrorCode,
  MembershipLevelStatus,
  type AdminMembershipLevelDetailView,
  type MembershipBenefit,
  type SaveMembershipLevelRequest,
} from '@bake-mall/contracts';
import { ref, type Ref } from 'vue';

import { ApiClientError } from '../../../api/http.js';
import {
  basisPointsToDiscountText,
  centsToYuanText,
  discountTextToBasisPoints,
  yuanTextToCents,
} from '../../../utils/money.js';
import { membershipCardsApi } from '../api/index.js';
import { createMembershipCardDefaults } from '../config/defaults.js';
import type {
  MembershipCardForm,
  MembershipLevelConflict,
} from '../type/index.js';

export type MembershipCardEditorMode =
  | { readonly mode: 'new' }
  | { readonly mode: 'edit'; readonly levelId: string };

export type UseMembershipCardEditorResult = {
  readonly form: Ref<MembershipCardForm>;
  readonly loading: Ref<boolean>;
  readonly saving: Ref<boolean>;
  readonly loadError: Ref<unknown | null>;
  readonly saveError: Ref<unknown | null>;
  readonly conflict: Ref<MembershipLevelConflict | null>;
  readonly load: () => Promise<void>;
  readonly reload: () => Promise<void>;
  readonly save: () => Promise<AdminMembershipLevelDetailView>;
  readonly replaceForm: (form: MembershipCardForm) => void;
};

const CODE_PATTERN = /^[A-Z0-9_]+$/;
const INT_UNSIGNED_MAX = 4_294_967_295;

function normalizeOptional(value: string): string | undefined {
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeBenefits(
  benefits: readonly MembershipBenefit[],
): MembershipBenefit[] {
  return benefits.map((benefit, index) => ({
    title: benefit.title.trim(),
    ...(normalizeOptional(benefit.description ?? '')
      ? { description: normalizeOptional(benefit.description ?? '') }
      : {}),
    ...(normalizeOptional(benefit.iconKey ?? '')
      ? { iconKey: normalizeOptional(benefit.iconKey ?? '') }
      : {}),
    sortOrder: benefit.sortOrder ?? index,
  }));
}

export function mapMembershipDetailToForm(
  detail: AdminMembershipLevelDetailView,
): MembershipCardForm {
  return {
    code: detail.code,
    name: detail.name,
    subtitle: detail.subtitle ?? '',
    description: detail.description ?? '',
    rank: detail.rank,
    priceYuan: centsToYuanText(detail.priceCents),
    grantCreditYuan: centsToYuanText(detail.grantCreditCents),
    discountText: basisPointsToDiscountText(detail.discountBasisPoints),
    validDays: detail.validDays,
    benefits: detail.benefits.map((benefit) => ({ ...benefit })),
    theme: detail.cardTheme.theme,
    badgeText: detail.cardTheme.badgeText,
    sortOrder: detail.sortOrder,
    status: detail.status,
    version: detail.version,
  };
}

export function mapMembershipFormToRequest(
  form: MembershipCardForm,
): SaveMembershipLevelRequest {
  return {
    code: form.code.trim(),
    name: form.name.trim(),
    ...(normalizeOptional(form.subtitle)
      ? { subtitle: normalizeOptional(form.subtitle) }
      : {}),
    ...(normalizeOptional(form.description)
      ? { description: normalizeOptional(form.description) }
      : {}),
    rank: form.rank,
    priceCents: yuanTextToCents(form.priceYuan),
    grantCreditCents: yuanTextToCents(form.grantCreditYuan),
    discountBasisPoints: discountTextToBasisPoints(form.discountText),
    validDays: form.validDays,
    benefits: normalizeBenefits(form.benefits),
    cardTheme: { theme: form.theme, badgeText: form.badgeText.trim() },
    sortOrder: form.sortOrder,
    status: form.status,
    ...(form.version === undefined ? {} : { version: form.version }),
  };
}

function isUnsignedInteger(value: number, minimum = 0): boolean {
  return (
    Number.isSafeInteger(value) && value >= minimum && value <= INT_UNSIGNED_MAX
  );
}

function conversionError(converter: () => number): readonly string[] {
  try {
    converter();
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : '输入格式不合法'];
  }
}

export function validateMembershipForm(
  form: MembershipCardForm,
): readonly string[] {
  return [
    ...(CODE_PATTERN.test(form.code.trim())
      ? []
      : ['等级编码只能包含大写字母、数字和下划线']),
    ...(form.name.trim() ? [] : ['会员卡名称不能为空']),
    ...(isUnsignedInteger(form.rank, 1) ? [] : ['业务等级必须是正整数']),
    ...(isUnsignedInteger(form.sortOrder) ? [] : ['展示排序必须是非负整数']),
    ...(Number.isInteger(form.validDays) &&
    form.validDays >= 1 &&
    form.validDays <= 3650
      ? []
      : ['有效天数必须为 1–3650 天']),
    ...(form.badgeText.trim() ? [] : ['卡面徽标不能为空']),
    ...(form.status === MembershipLevelStatus.ACTIVE &&
    form.benefits.length === 0
      ? ['上架前至少添加一条权益']
      : []),
    ...(form.benefits.some((benefit) => !benefit.title.trim())
      ? ['权益标题不能为空']
      : []),
    ...conversionError(() => yuanTextToCents(form.priceYuan)),
    ...conversionError(() => yuanTextToCents(form.grantCreditYuan)),
    ...conversionError(() => discountTextToBasisPoints(form.discountText)),
  ];
}

function cloneForm(form: MembershipCardForm): MembershipCardForm {
  return {
    ...form,
    benefits: form.benefits.map((benefit) => ({ ...benefit })),
  };
}

function toConflict(error: unknown): MembershipLevelConflict | null {
  return error instanceof ApiClientError &&
    error.status === 409 &&
    error.code === ApiErrorCode.MEMBERSHIP_LEVEL_VERSION_CONFLICT
    ? {
        code: ApiErrorCode.MEMBERSHIP_LEVEL_VERSION_CONFLICT,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      }
    : null;
}

export function useMembershipCardEditor(
  mode: MembershipCardEditorMode,
  onCreated: (levelId: string) => void = () => undefined,
): UseMembershipCardEditorResult {
  const form = ref<MembershipCardForm>(createMembershipCardDefaults());
  const loading = ref(false);
  const saving = ref(false);
  const loadError = ref<unknown | null>(null);
  const saveError = ref<unknown | null>(null);
  const conflict = ref<MembershipLevelConflict | null>(null);
  const persistedLevelId = ref(mode.mode === 'edit' ? mode.levelId : null);

  function replaceForm(next: MembershipCardForm): void {
    form.value = cloneForm(next);
  }

  function applyServerDetail(detail: AdminMembershipLevelDetailView): void {
    replaceForm(mapMembershipDetailToForm(detail));
    conflict.value = null;
  }

  async function load(): Promise<void> {
    if (mode.mode === 'new') return;
    loading.value = true;
    loadError.value = null;
    try {
      applyServerDetail(await membershipCardsApi.getOne(mode.levelId));
    } catch (error) {
      loadError.value = error;
    } finally {
      loading.value = false;
    }
  }

  async function reload(): Promise<void> {
    const levelId = persistedLevelId.value;
    if (!levelId) return;
    loading.value = true;
    loadError.value = null;
    try {
      applyServerDetail(await membershipCardsApi.getOne(levelId));
    } catch (error) {
      loadError.value = error;
      throw error;
    } finally {
      loading.value = false;
    }
  }

  async function save(): Promise<AdminMembershipLevelDetailView> {
    const validationErrors = validateMembershipForm(form.value);
    if (validationErrors.length > 0) {
      throw new Error(validationErrors.join('；'));
    }
    if (saving.value) throw new Error('会员卡正在保存，请勿重复提交');

    saving.value = true;
    saveError.value = null;
    conflict.value = null;
    try {
      const request = mapMembershipFormToRequest(form.value);
      const response = persistedLevelId.value
        ? await membershipCardsApi.update(persistedLevelId.value, request)
        : await membershipCardsApi.create(request);
      const wasNew = persistedLevelId.value === null;
      persistedLevelId.value = response.id;
      applyServerDetail(response);
      if (wasNew) onCreated(response.id);
      return response;
    } catch (error) {
      saveError.value = error;
      conflict.value = toConflict(error);
      throw error;
    } finally {
      saving.value = false;
    }
  }

  return {
    form,
    loading,
    saving,
    loadError,
    saveError,
    conflict,
    load,
    reload,
    save,
    replaceForm,
  };
}
