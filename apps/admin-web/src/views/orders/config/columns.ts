export const orderColumns = [
  { key: 'orderNo', label: '订单号', minWidth: 190 },
  { key: 'contact', label: '联系人', minWidth: 150 },
  { key: 'fulfillmentType', label: '履约方式', width: 110 },
  { key: 'goodsTotalCents', label: '商品金额', width: 110 },
  { key: 'status', label: '状态', width: 100 },
  { key: 'createdAt', label: '下单时间', width: 170 },
  { key: 'actions', label: '操作', width: 100 },
] as const;
