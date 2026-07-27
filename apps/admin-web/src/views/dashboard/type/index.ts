export type DashboardEntryTone = 'lilac' | 'pink' | 'mint' | 'yellow';

export interface DashboardEntry {
  readonly key: 'categories' | 'products' | 'banners' | 'orders';
  readonly title: string;
  readonly description: string;
  readonly route: string;
  readonly cta: string;
  readonly icon: string;
  readonly tone: DashboardEntryTone;
}

export type OrderFlowStatus = 'NEW' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';

export interface OrderFlowState {
  readonly status: OrderFlowStatus;
  readonly title: string;
  readonly description: string;
  readonly tone: 'pink' | 'lilac' | 'mint' | 'muted';
}

export interface OrderFlow {
  readonly incoming: OrderFlowState;
  readonly processing: OrderFlowState;
  readonly outcomes: readonly [OrderFlowState, OrderFlowState];
}
