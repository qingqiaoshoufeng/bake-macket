import { defineStore } from 'pinia';
import type { AddressView } from '@bake-mall/contracts';

type AddressesState = {
  items: AddressView[];
  loading: boolean;
  saving: boolean;
  lastError: string | null;
};

export const useAddressesStore = defineStore('addresses', {
  state: (): AddressesState => ({
    items: [],
    loading: false,
    saving: false,
    lastError: null,
  }),
  getters: {
    defaultAddress: (state): AddressView | null =>
      state.items.find((address) => address.isDefault) ?? null,
  },
  actions: {
    applyItems(items: readonly AddressView[]): void {
      this.items = [...items];
    },
    removeItem(id: string): void {
      this.items = this.items.filter((item) => item.id !== id);
    },
    setLoading(loading: boolean): void {
      this.loading = loading;
    },
    setSaving(saving: boolean): void {
      this.saving = saving;
    },
    setError(error: string | null): void {
      this.lastError = error;
    },
  },
});

export type AddressesStore = ReturnType<typeof useAddressesStore>;
