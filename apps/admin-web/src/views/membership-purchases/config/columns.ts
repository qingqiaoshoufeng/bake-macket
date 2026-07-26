export const membershipPurchaseColumns = [
  { key: 'purchaseNo', label: '购卡单号', minWidth: 180 },
  { key: 'userId', label: '用户', minWidth: 150 },
  { key: 'level', label: '会员等级', minWidth: 150 },
  { key: 'price', label: '实付', width: 110 },
  { key: 'payment', label: '支付', width: 110 },
  { key: 'status', label: '履约', width: 110 },
  { key: 'createdAt', label: '创建时间', width: 180 },
  { key: 'action', label: '操作', width: 110 },
] as const;
