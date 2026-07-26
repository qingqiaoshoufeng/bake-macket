export function requirePayableTotalCents(
  payableTotalCents: number | undefined,
): number {
  if (payableTotalCents === undefined) {
    throw new Error('订单列表缺少应付金额');
  }
  return payableTotalCents;
}
