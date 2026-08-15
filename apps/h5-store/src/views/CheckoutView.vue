<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';

import StorePage from '../components/layout/StorePage.vue';
import StorePageHeader from '../components/layout/StorePageHeader.vue';
import { useAuthStore } from '../stores/auth.js';
import {
  CheckoutContact,
  CheckoutFulfillment,
  CheckoutItems,
  CheckoutMembershipPricing,
  CheckoutSubmit,
  useCheckout,
} from './checkout/index.js';
import { REMARK_MAX_LENGTH } from './checkout/config/defaults.js';

const router = useRouter();
const auth = useAuthStore();
const checkout = useCheckout(auth.profile);

onMounted(async () => {
  try {
    await checkout.methods.load();
  } catch {
    showToast('结算信息加载失败,请稍后重试');
  }
});

async function openOrderContactPhone(): Promise<void> {
  await router.push({
    path: '/profile',
    query: { edit: 'order-contact-phone', redirect: '/checkout' },
  });
}

async function submit(): Promise<void> {
  try {
    const order = await checkout.methods.submit();
    if (!order) {
      if (checkout.data.recovery.value === 'contact-phone-missing') {
        await openOrderContactPhone();
      } else if (checkout.data.recovery.value === 'contact-phone-stale') {
        showToast('联系手机号已刷新，请确认后重新提交');
      }
      return;
    }
    showToast({ type: 'success', message: '下单成功' });
    await router.replace(`/orders/${order.id}`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '提交失败');
  }
}
</script>

<template>
  <StorePage class="checkout">
    <StorePageHeader
      back
      title="结算订单"
      eyebrow="CONFIRM YOUR BAKE"
      description="提交前请确认履约方式、联系人和备注信息。"
      @back="router.back()"
    />
    <CheckoutItems
      :items="checkout.data.availableItems.value"
      :total-cents="checkout.data.cartTotalCents.value"
    />
    <form class="checkout__form" @submit.prevent="submit">
      <CheckoutFulfillment
        :fulfillment-type="checkout.data.values.value.fulfillmentType"
        :pickup-time-text="checkout.data.values.value.pickupTimeText"
        :address-id="checkout.data.values.value.addressId"
        :addresses="checkout.data.addresses.value"
        @update:fulfillment-type="
          checkout.methods.updateValues({ fulfillmentType: $event })
        "
        @update:pickup-time-text="
          checkout.methods.updateValues({ pickupTimeText: $event })
        "
        @update:address-id="
          checkout.methods.updateValues({ addressId: $event })
        "
      />
      <CheckoutContact
        :contact-name="checkout.data.values.value.contactName"
        :order-contact-phone="checkout.data.orderContactPhone.value"
        @update:contact-name="
          checkout.methods.updateValues({ contactName: $event })
        "
        @manage-contact-phone="openOrderContactPhone"
      />
      <CheckoutMembershipPricing
        :quote="checkout.data.quote.value"
        :credit-text="checkout.data.requestedCreditText.value"
        :loading="checkout.quoteLoading.value"
        :validation-error="checkout.data.quoteValidationError.value"
        :quote-error="checkout.data.quoteError.value"
        :requires-confirmation="checkout.data.quoteRequiresConfirmation.value"
        @update:credit-text="checkout.methods.updateRequestedCreditText"
        @confirm="checkout.methods.confirmQuote"
      />
      <CheckoutSubmit
        :remark="checkout.data.values.value.remark"
        :remark-max-length="REMARK_MAX_LENGTH"
        :form-error="checkout.data.formError.value"
        :submit-error="checkout.data.submitError.value"
        :disabled="!checkout.canSubmit.value"
        :submitting="checkout.submitting.value"
        :total-cents="
          checkout.data.quote.value?.payableTotalCents ??
          checkout.data.cartTotalCents.value
        "
        @update:remark="checkout.methods.updateValues({ remark: $event })"
        @submit="submit"
      />
    </form>
  </StorePage>
</template>

<style scoped>
.checkout__form {
  display: grid;
  gap: var(--mall-space-3);
  margin-top: var(--mall-space-3);
}
</style>
