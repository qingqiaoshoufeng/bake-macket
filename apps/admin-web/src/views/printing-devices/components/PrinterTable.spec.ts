/* eslint-disable vue/one-component-per-file -- local Element Plus stubs */
import {
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
  type CloudPrinterView,
} from '@bake-mall/contracts';
import { mount } from '@vue/test-utils';
import { defineComponent, provide } from 'vue';
import { describe, expect, it } from 'vitest';

import PrinterTable from './PrinterTable.vue';

function printer(patch: Partial<CloudPrinterView> = {}): CloudPrinterView {
  return {
    id: '1001',
    displayName: '前台出单机',
    serialNumberMasked: 'SN****01',
    status: CloudPrinterStatus.ACTIVE,
    onlineStatus: CloudPrinterOnlineStatus.ONLINE,
    lastStatusCheckedAt: '2026-08-09T10:00:00.000Z',
    bindingStage: PrinterBindingStage.NONE,
    vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
    ...patch,
  };
}

const TableStub = defineComponent({
  name: 'ElTable',
  props: { data: { type: Array, required: true } },
  setup(props) {
    provide('printerRows', props.data);
  },
  template: '<div><slot /></div>',
});
const TableColumnStub = defineComponent({
  name: 'ElTableColumn',
  inject: ['printerRows'],
  template:
    '<section><slot v-for="row in printerRows" :key="row.id" :row="row" /></section>',
});

function mountTable(devices: readonly CloudPrinterView[]) {
  return mount(PrinterTable, {
    props: { devices, loading: false, pendingResourceIds: [] },
    global: {
      directives: { loading: () => undefined },
      stubs: { ElTable: TableStub, ElTableColumn: TableColumnStub },
    },
  });
}

describe('PrinterTable', () => {
  it('shows identity, masked serial, binding/online state, and last check', () => {
    const wrapper = mountTable([printer()]);

    expect(wrapper.text()).toContain('前台出单机');
    expect(wrapper.text()).toContain('SN****01');
    expect(wrapper.text()).toContain('已启用');
    expect(wrapper.text()).toContain('在线');
    expect(wrapper.text()).toContain('2026');
  });

  it.each([
    [
      CloudPrinterStatus.PENDING_VERIFICATION,
      PrinterBindingStage.NONE,
      VendorRelationState.CONFIRMED_BOUND,
      ['verify', 'resend', 'rename'],
    ],
    [
      CloudPrinterStatus.PENDING_VERIFICATION,
      PrinterBindingStage.PRINT_VERIFICATION_CODE,
      VendorRelationState.CONFIRMED_BOUND,
      ['verify', 'resend', 'rename'],
    ],
    [
      CloudPrinterStatus.BINDING,
      PrinterBindingStage.PRINT_VERIFICATION_CODE,
      VendorRelationState.CONFIRMED_BOUND,
      ['resend', 'rename'],
    ],
    [
      CloudPrinterStatus.ERROR,
      PrinterBindingStage.RECONCILIATION,
      VendorRelationState.CONFIRMED_BOUND,
      ['resend', 'rename'],
    ],
    [
      CloudPrinterStatus.ERROR,
      PrinterBindingStage.RECONCILIATION,
      VendorRelationState.UNKNOWN,
      ['requery', 'rename'],
    ],
    [
      CloudPrinterStatus.ERROR,
      PrinterBindingStage.UNBIND_DELETE,
      VendorRelationState.CONFIRMED_BOUND,
      ['delete-confirm', 'rename'],
    ],
    [
      CloudPrinterStatus.UNBINDING,
      PrinterBindingStage.UNBIND_DELETE,
      VendorRelationState.CONFIRMED_BOUND,
      ['rename'],
    ],
    [
      CloudPrinterStatus.ERROR,
      PrinterBindingStage.COMPENSATION_DELETE,
      VendorRelationState.CONFIRMED_BOUND,
      ['delete-confirm', 'rename'],
    ],
    [
      CloudPrinterStatus.ACTIVE,
      PrinterBindingStage.PRINT_VERIFICATION_CODE,
      VendorRelationState.CONFIRMED_BOUND,
      ['refresh', 'unbind', 'rename'],
    ],
  ])(
    'emits only status-driven recovery actions for %s/%s/%s',
    (status, bindingStage, vendorRelationState, expectedActions) => {
      const wrapper = mountTable([
        printer({ status, bindingStage, vendorRelationState }),
      ]);

      const actionNames = wrapper
        .findAll('[data-printer-action]')
        .map((button) => button.attributes('data-printer-action'));
      expect(actionNames).toEqual(expectedActions);
    },
  );

  it('emits the action selected by the pure action matrix', async () => {
    const selected = printer({
      status: CloudPrinterStatus.BINDING,
      bindingStage: PrinterBindingStage.PRINT_VERIFICATION_CODE,
      vendorRelationState: VendorRelationState.CONFIRMED_BOUND,
    });
    const wrapper = mountTable([selected]);

    await wrapper.get('[data-printer-action="resend"]').trigger('click');

    expect(wrapper.emitted('action')).toEqual([['resend', selected]]);
  });

  it('shows active unbind and emits it through the shared action seam', async () => {
    const selected = printer();
    const wrapper = mountTable([selected]);
    const unbind = wrapper.get('[data-printer-action="unbind"]');

    expect(unbind.attributes()).not.toHaveProperty('disabled');
    await unbind.trigger('click');
    expect(wrapper.emitted('action')).toEqual([['unbind', selected]]);
  });

  it('contains no fetch boundary inside the presentational component', () => {
    expect(PrinterTable.__file).toContain('PrinterTable.vue');
    expect(String(PrinterTable.setup)).not.toContain('fetch(');
  });
});
