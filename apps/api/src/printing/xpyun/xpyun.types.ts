export const XPYUN_VENDOR_PORT = Symbol('XPYUN_VENDOR_PORT');

export type XpyunPrinterInput = Readonly<{
  serialNumber: string;
  displayName: string;
}>;

export type XpyunVendorFailureClassification =
  'FAILED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'UNKNOWN';

export type XpyunAdapterErrorClassification =
  XpyunVendorFailureClassification | 'VALIDATION_FAILED';

export type XpyunVendorError = Readonly<{
  code: string;
  message: string;
}>;

export type XpyunAddPrinterResult = Readonly<{
  vendorCode: string;
  vendorMessage: string;
}>;

export type XpyunDeletePrinterResult = Readonly<{
  vendorCode: string;
  vendorMessage: string;
}>;

export type XpyunOnlineStatus = 'ONLINE' | 'OFFLINE' | 'ABNORMAL' | 'UNKNOWN';

export type XpyunOnlineResult = Readonly<{
  status: XpyunOnlineStatus;
  vendorCode: string;
}>;

export type XpyunPrintResult =
  | Readonly<{
      classification: 'ACCEPTED';
      vendorCode: string;
      vendorJobId: string;
    }>
  | Readonly<{
      classification: XpyunVendorFailureClassification;
      vendorCode: string | null;
      vendorJobId: null;
    }>;

export type XpyunOrderResult = Readonly<{
  printed: boolean;
  vendorCode: string;
}>;

export type XpyunReceiptInput = Readonly<{
  serialNumber: string;
  content: string;
  tradeOrderId: string;
}>;
