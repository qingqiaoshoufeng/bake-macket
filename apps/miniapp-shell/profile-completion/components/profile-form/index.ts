Component({
  properties: {
    avatarPreviewUrl: { type: String, value: '' },
    error: { type: String, value: '' },
    loading: { type: Boolean, value: false },
    nickname: { type: String, value: '' },
  },
  methods: {
    onChooseAvatar(
      event: WechatMiniprogram.CustomEvent<{ avatarUrl?: string }>,
    ) {
      this.triggerEvent('chooseavatar', event.detail);
    },
    onNicknameInput(event: WechatMiniprogram.Input) {
      this.triggerEvent('nicknamechange', { value: event.detail.value });
    },
    onSave() {
      this.triggerEvent('save');
    },
    onSkip() {
      this.triggerEvent('skip');
    },
  },
});
