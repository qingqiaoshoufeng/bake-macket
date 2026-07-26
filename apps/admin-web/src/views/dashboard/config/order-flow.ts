import type { OrderFlow } from '../type/index.js';

export const ORDER_FLOW: OrderFlow = {
  incoming: {
    status: 'NEW',
    title: '新订单',
    description: '核对履约方式与订单快照。',
    tone: 'pink',
  },
  processing: {
    status: 'PROCESSING',
    title: '制作中',
    description: '确认接单后进入制作与备货。',
    tone: 'lilac',
  },
  outcomes: [
    {
      status: 'COMPLETED',
      title: '已完成',
      description: '交付完成后结束订单流程。',
      tone: 'mint',
    },
    {
      status: 'CANCELLED',
      title: '已取消',
      description: '允许时可从处理中取消，库存不会回补。',
      tone: 'muted',
    },
  ],
};
