import type { PrinterVerificationChallengeView } from '@bake-mall/contracts';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import BindPrinterDialog from './BindPrinterDialog.vue';
import PrinterRecoveryActions from './PrinterRecoveryActions.vue';
import RenamePrinterDialog from './RenamePrinterDialog.vue';
import VerifyPrinterDialog from './VerifyPrinterDialog.vue';

const challenge: PrinterVerificationChallengeView = {
  challengeId: '1001',
  expiresAt: '2026-08-09T10:05:00.000Z',
  remainingAttempts: 2,
};

describe('printer dialogs', () => {
  it('bind dialog is presentational and emits immutable form updates', async () => {
    const wrapper = mount(BindPrinterDialog, {
      global: {
        stubs: {
          ElDialog: { template: '<div><slot /><slot name="footer" /></div>' },
        },
      },
      props: {
        visible: true,
        submitting: false,
        form: {
          serialNumber: '',
          displayName: '',
          operationPassword: '',
        },
      },
    });

    await wrapper
      .get('[data-testid="bind-printer-serial"]')
      .setValue('SN-1001');
    expect(wrapper.emitted('update:form')?.at(-1)?.[0]).toEqual({
      serialNumber: 'SN-1001',
      displayName: '',
      operationPassword: '',
    });
    expect(String(BindPrinterDialog.setup)).not.toContain('fetch(');
  });

  it('verify dialog shows server countdown and remaining attempts, then expired recovery', () => {
    const live = mount(VerifyPrinterDialog, {
      global: {
        stubs: {
          ElDialog: { template: '<div><slot /><slot name="footer" /></div>' },
        },
      },
      props: {
        visible: true,
        submitting: false,
        challenge,
        countdownSeconds: 300,
        form: {
          challengeId: '1001',
          code: '',
          operationPassword: '',
        },
      },
    });
    expect(live.text()).toContain('05:00');
    expect(live.text()).toContain('剩余 2 次');

    const expired = mount(VerifyPrinterDialog, {
      global: {
        stubs: {
          ElDialog: { template: '<div><slot /><slot name="footer" /></div>' },
        },
      },
      props: {
        visible: true,
        submitting: false,
        challenge,
        countdownSeconds: 0,
        form: {
          challengeId: '1001',
          code: '',
          operationPassword: '',
        },
      },
    });
    expect(expired.text()).toContain('验证码已过期');
    expect(
      expired.find('[data-testid="verify-expired-recovery"]').exists(),
    ).toBe(true);
  });

  it('distinguishes missing challenge metadata and requires refresh or resend before retry', () => {
    const wrapper = mount(VerifyPrinterDialog, {
      global: {
        stubs: {
          ElDialog: { template: '<div><slot /><slot name="footer" /></div>' },
        },
      },
      props: {
        visible: true,
        submitting: false,
        challenge: null,
        challengeState: 'metadata-missing',
        allowManualRetry: true,
        countdownSeconds: 0,
        form: {
          challengeId: '1001',
          code: '',
          operationPassword: '',
        },
      },
    });

    expect(wrapper.text()).toContain('验证码信息缺失，请刷新列表或重发验证码');
    expect(wrapper.text()).not.toContain('验证码已过期');
    expect(wrapper.find('[data-testid="verify-manual-retry"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.find('[data-testid="verify-expired-recovery"]').exists(),
    ).toBe(true);
  });

  it('rename dialog has no password input or password event', () => {
    const wrapper = mount(RenamePrinterDialog, {
      props: {
        visible: true,
        submitting: false,
        printerName: '前台出单机',
        form: { displayName: '前台出单机' },
      },
    });

    expect(wrapper.find('input[type="password"]').exists()).toBe(false);
    expect(wrapper.html()).not.toMatch(/operationPassword|密码/);
  });

  it('recovery component supports password-confirmed unbind without networking', () => {
    const wrapper = mount(PrinterRecoveryActions, {
      props: {
        visible: true,
        submitting: false,
        action: 'unbind',
        printerName: '前台出单机',
        form: { operationPassword: '' },
      },
    });

    expect(wrapper.props('action')).toBe('unbind');
    expect(wrapper.html()).toContain('aria-label="确认移除打印机"');
    expect(wrapper.html()).not.toContain('fetch(');
  });
});
