<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';

import DiagnosticResultList from '../../diagnostics/components/DiagnosticResultList.vue';
import { createNativePrinterDiagnosticAdapter } from '../../diagnostics/api/index.js';
import { runDiagnosticSmoke } from '../../diagnostics/api/smoke.js';
import { DIAGNOSTIC_STEP_LABELS } from '../../diagnostics/config/diagnostic-steps.js';
import {
  parsePrinterDiagnosticForm,
  type PrinterDiagnosticForm,
} from '../../diagnostics/config/diagnostic-form.js';
import { parseDiagnosticSmokeOptions } from '../../diagnostics/config/smoke-options.js';
import { FAKE_DIAGNOSTIC_INPUT } from '../../diagnostics/mock/diagnostic.mock.js';
import { usePrinterDiagnostic } from '../../diagnostics/hooks/usePrinterDiagnostic.js';

const form = ref<PrinterDiagnosticForm>({
  host: FAKE_DIAGNOSTIC_INPUT.host,
  port: String(FAKE_DIAGNOSTIC_INPUT.capability.tcpPort),
  encoding: FAKE_DIAGNOSTIC_INPUT.capability.encoding,
  charactersPerLine: String(FAKE_DIAGNOSTIC_INPUT.capability.charactersPerLine),
  connectionTimeoutMs: String(
    FAKE_DIAGNOSTIC_INPUT.capability.connectionTimeoutMs,
  ),
  writeTimeoutMs: String(FAKE_DIAGNOSTIC_INPUT.capability.writeTimeoutMs),
  feedLines: String(FAKE_DIAGNOSTIC_INPUT.capability.feedLines),
  supportsCut: false,
  cutCommandHex: '',
  testCut: false,
});
const input = computed(() => parsePrinterDiagnosticForm(form.value));
const confirmPaperOutput = async (
  step: Parameters<
    ReturnType<
      typeof createNativePrinterDiagnosticAdapter
    >['confirmPaperOutput']
  >[0],
): Promise<boolean> => {
  const result = await uni.showModal({
    title: DIAGNOSTIC_STEP_LABELS[step],
    content: '请检查纸面内容是否完整、清晰且对齐正确。',
    confirmText: '通过',
    cancelText: '失败',
  });

  return result.confirm === true;
};

const diagnostic = usePrinterDiagnostic(
  () => {
    if (!input.value) throw new Error('打印机诊断配置无效');
    return input.value;
  },
  (currentInput) =>
    createNativePrinterDiagnosticAdapter(currentInput, { confirmPaperOutput }),
);

const updateEncoding = (event: Event): void => {
  const detail = (event as CustomEvent<{ value?: string }>).detail;
  form.value = {
    ...form.value,
    encoding: detail?.value === '1' ? 'GBK' : 'GB18030',
  };
};

const updateCutSelection = (event: Event): void => {
  const detail = (event as CustomEvent<{ value?: boolean }>).detail;
  const enabled = detail?.value === true;
  form.value = {
    ...form.value,
    supportsCut: enabled,
    testCut: enabled,
    cutCommandHex: enabled ? form.value.cutCommandHex : '',
  };
};

onLoad((options) => {
  const smokeOptions = parseDiagnosticSmokeOptions(options ?? {});
  if (!smokeOptions) return;

  form.value = {
    ...form.value,
    host: smokeOptions.host,
    port: String(smokeOptions.port),
  };
  if (!input.value) return;
  void runDiagnosticSmoke(input.value, { log: console.log });
});
</script>

<template>
  <view class="diagnostics-page">
    <text class="diagnostics-page__title">打印机诊断</text>
    <text class="diagnostics-page__description">
      按顺序验证 TCP、中文、排版、长文本与走纸。切刀默认关闭。
    </text>

    <view class="diagnostics-page__form">
      <text class="diagnostics-page__label">打印机 IP</text>
      <input
        v-model="form.host"
        class="diagnostics-page__input"
        placeholder="例如 192.168.1.100"
      />
      <text class="diagnostics-page__label">TCP 端口</text>
      <input
        v-model="form.port"
        class="diagnostics-page__input"
        type="number"
      />
      <text class="diagnostics-page__label">编码</text>
      <picker :range="['GB18030', 'GBK']" @change="updateEncoding">
        <view class="diagnostics-page__input">{{ form.encoding }}</view>
      </picker>
      <text class="diagnostics-page__label">半角列数</text>
      <input
        v-model="form.charactersPerLine"
        class="diagnostics-page__input"
        type="number"
      />
      <text class="diagnostics-page__label">连接超时（毫秒）</text>
      <input
        v-model="form.connectionTimeoutMs"
        class="diagnostics-page__input"
        type="number"
      />
      <text class="diagnostics-page__label">写入超时（毫秒）</text>
      <input
        v-model="form.writeTimeoutMs"
        class="diagnostics-page__input"
        type="number"
      />
      <text class="diagnostics-page__label">走纸行数</text>
      <input
        v-model="form.feedLines"
        class="diagnostics-page__input"
        type="number"
      />
      <label class="diagnostics-page__cut-option">
        <switch :checked="form.testCut" @change="updateCutSelection" />
        <text>测试已现场确认的切刀命令</text>
      </label>
      <input
        v-if="form.testCut"
        v-model="form.cutCommandHex"
        class="diagnostics-page__input"
        placeholder="仅支持已验证的 GS V 命令"
      />
      <button
        class="diagnostics-page__submit"
        :loading="diagnostic.running.value"
        :disabled="diagnostic.running.value || input === null"
        @click="diagnostic.run"
      >
        开始诊断
      </button>
    </view>

    <DiagnosticResultList :results="diagnostic.results.value" />
  </view>
</template>

<style scoped>
.diagnostics-page {
  display: flex;
  flex-direction: column;
  gap: 28rpx;
  padding: 48rpx 32rpx;
}

.diagnostics-page__title {
  font-size: 40rpx;
  font-weight: 700;
}

.diagnostics-page__description {
  color: #75645d;
  font-size: 28rpx;
  line-height: 1.6;
}

.diagnostics-page__form {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  padding: 28rpx;
  border-radius: 24rpx;
  background: #ffffff;
}

.diagnostics-page__label {
  font-weight: 600;
}

.diagnostics-page__input {
  height: 80rpx;
  padding: 0 24rpx;
  border: 2rpx solid #eadbd2;
  border-radius: 16rpx;
}

.diagnostics-page__cut-option {
  display: flex;
  align-items: center;
  gap: 12rpx;
  color: #75645d;
}

.diagnostics-page__submit {
  color: #ffffff;
  background: #d88468;
}
</style>
