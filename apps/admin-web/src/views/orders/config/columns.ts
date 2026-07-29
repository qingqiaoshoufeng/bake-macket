export const orderColumns = [
  { key: 'orderNo', label: '订单号', minWidth: 190 },
  { key: 'contact', label: '联系人', minWidth: 150 },
  { key: 'fulfillmentType', label: '履约方式', width: 110 },
  { key: 'itemCounts', label: '商品', width: 120 },
  { key: 'goodsTotalCents', label: '商品原价', width: 110 },
  { key: 'membershipDiscountCents', label: '会员优惠', width: 110 },
  { key: 'creditAppliedCents', label: '消费金', width: 100 },
  { key: 'payableTotalCents', label: '应付金额', width: 110 },
  { key: 'status', label: '状态', width: 100 },
  { key: 'createdAt', label: '下单时间', width: 170 },
  { key: 'actions', label: '操作', width: 100 },
] as const;
