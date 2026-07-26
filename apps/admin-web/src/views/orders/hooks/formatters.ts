export function displayedOrderTotalCents(
  goodsTotalCents: number,
  payableTotalCents?: number,
): number {
  return payableTotalCents ?? goodsTotalCents;
}
