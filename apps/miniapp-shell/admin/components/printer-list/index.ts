type PrinterListData = Readonly<{ empty: boolean }>;
type PrinterListProperties = Readonly<{
  printers: WechatMiniprogram.Component.FullProperty<
    ArrayConstructor,
    unknown[]
  >;
}>;
type PrinterListMethods = Readonly<{
  onAction: (event: PrinterActionEvent) => void;
}>;
type PrinterActionEvent = Readonly<{
  currentTarget: Readonly<{
    dataset: Readonly<{ action?: unknown; printerId?: unknown }>;
  }>;
}>;
type PrinterListBehaviors = [];

Component<
  PrinterListData,
  PrinterListProperties,
  PrinterListMethods,
  PrinterListBehaviors
>({
  properties: {
    printers: {
      type: Array,
      value: [],
    },
  },

  data: {
    empty: true,
  },

  observers: {
    printers(printers: readonly unknown[]): void {
      this.setData({ empty: printers.length === 0 });
    },
  },

  methods: {
    onAction(event): void {
      const { action, printerId } = event.currentTarget.dataset;
      if (typeof action === 'string' && typeof printerId === 'string') {
        this.triggerEvent('printeraction', { action, printerId });
      }
    },
  },
});
