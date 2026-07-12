import { defineStore } from 'pinia';

import {
  customerApi,
  type AddressView,
  type CreateAddressRequest,
  type UpdateAddressRequest,
} from '../api/customer.js';

type AddressesState = {
  items: AddressView[];
  loading: boolean;
  saving: boolean;
  lastError: string | null;
};

/**
 * Customer-side address book store.
 *
 * - `refresh()` pulls every address for the current user. The backend
 *   already enforces the "at most one default per user" invariant inside
 *   a transaction, so the store just mirrors whatever the server returns.
 * - `create` / `update` / `remove` route through `customerApi` and
 *   refresh the local cache so the UI never diverges from the server.
 * - `setDefault` uses the dedicated `/me/addresses/:id/default` endpoint
 *   so the toggle UI doesn't have to PATCH the full record with
 *   `isDefault: true`.
 *
 * The store keeps a tiny `defaultAddress` getter for the checkout view
 * to fall back to when the user hasn't manually picked one.
 */
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
    async refresh(): Promise<AddressView[]> {
      this.loading = true;
      this.lastError = null;
      try {
        const items = await customerApi.listAddresses();
        this.items = items;
        return items;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : '加载失败';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async create(body: CreateAddressRequest): Promise<AddressView> {
      this.saving = true;
      this.lastError = null;
      try {
        const created = await customerApi.createAddress(body);
        await this.refresh();
        return created;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : '保存失败';
        throw error;
      } finally {
        this.saving = false;
      }
    },

    async update(id: string, body: UpdateAddressRequest): Promise<AddressView> {
      this.saving = true;
      this.lastError = null;
      try {
        const updated = await customerApi.updateAddress(id, body);
        await this.refresh();
        return updated;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : '保存失败';
        throw error;
      } finally {
        this.saving = false;
      }
    },

    async setDefault(id: string): Promise<AddressView> {
      this.saving = true;
      this.lastError = null;
      try {
        const updated = await customerApi.setDefaultAddress(id);
        await this.refresh();
        return updated;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : '设置失败';
        throw error;
      } finally {
        this.saving = false;
      }
    },

    async remove(id: string): Promise<void> {
      this.saving = true;
      this.lastError = null;
      try {
        await customerApi.removeAddress(id);
        this.items = this.items.filter((item) => item.id !== id);
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : '删除失败';
        throw error;
      } finally {
        this.saving = false;
      }
    },
  },
});

export type AddressesStore = ReturnType<typeof useAddressesStore>;
