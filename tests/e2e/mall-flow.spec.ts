import {
  expect,
  test,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';

import { resolveRootUrl } from './url-helper.mjs';

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'admin-local@example.com';
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? 'admin-password';
const customerCode = process.env.E2E_CUSTOMER_CODE ?? '123456';
const h5Url = process.env.H5_URL ?? 'http://127.0.0.1:43173';
const adminUrl = process.env.ADMIN_URL ?? 'http://127.0.0.1:43174';

function createRunIdentity(retry: number): {
  runId: string;
  customerPhone: string;
} {
  const entropy = `${Date.now()}${process.pid}${retry}`.replace(/\D/gu, '');
  const suffix = entropy.slice(-8).padStart(8, '0');
  return {
    runId: `${Date.now()}-${process.pid}-retry${retry}`,
    customerPhone: `139${suffix}`,
  };
}

function isCreateOrderRequest(request: Request): boolean {
  return (
    request.method() === 'POST' &&
    new URL(request.url()).pathname === '/api/v1/orders'
  );
}

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto(resolveRootUrl(adminUrl, '/login'));
  await page.getByTestId('admin-email').fill(adminEmail);
  await page.getByTestId('admin-login-password').fill(adminPassword);
  await page.getByTestId('admin-submit').click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function createCategory(page: Page, categoryName: string): Promise<void> {
  await page.goto(resolveRootUrl(adminUrl, '/categories'));
  await page.getByTestId('new-category').click();
  await page.getByTestId('dialog-name').fill(categoryName);
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByText(categoryName)).toBeVisible();
}

async function createPublishedProduct(
  page: Page,
  productName: string,
  categoryName: string,
): Promise<string> {
  await page.goto(resolveRootUrl(adminUrl, '/products/new'));
  await page.getByTestId('product-name').fill(productName);
  await page.getByTestId('product-category').click();
  await page.getByText(categoryName, { exact: true }).last().click();
  await page
    .getByTestId('product-summary')
    .fill('Playwright 创建的到店自提商品');
  await page.getByTestId('add-sku').click();
  await page.getByTestId('name-0').fill('6 寸');
  await page.getByTestId('price-0').fill('68.00');
  await page.getByTestId('stock-0').fill('2');
  await page.getByTestId('product-active').click();
  await page.getByRole('button', { name: '保存商品' }).click();
  await expect(page.getByText('商品保存成功')).toBeVisible();
  await expect(page).toHaveURL(/\/products\/.+\/edit/);
  return new URL(page.url()).pathname;
}

async function loginAsCustomer(
  page: Page,
  productPath: string,
  customerPhone: string,
): Promise<void> {
  const loginUrl = new URL(resolveRootUrl(h5Url, '/login'));
  loginUrl.searchParams.set('redirect', productPath);
  await page.goto(loginUrl.href);
  await page.getByPlaceholder('11 位手机号').fill(customerPhone);
  await page.getByPlaceholder('6 位验证码').fill(customerCode);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/products\//);
}

async function clearCart(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const token = window.localStorage.getItem('bake_user_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await fetch('/api/v1/me/cart/items', { headers });
    if (!response.ok)
      throw new Error(`Unable to list cart: ${response.status}`);
    const items = (await response.json()) as Array<{ id: string }>;
    await Promise.all(
      items.map(async ({ id }) => {
        const deletion = await fetch(`/api/v1/me/cart/items/${id}`, {
          method: 'DELETE',
          headers,
        });
        if (!deletion.ok) {
          throw new Error(
            `Unable to clear cart item ${id}: ${deletion.status}`,
          );
        }
      }),
    );
  });
}

async function submitOrderAndAssertProtocol(
  page: Page,
  runId: string,
  customerPhone: string,
): Promise<void> {
  await page.getByTestId('choose-sku').click();
  await page.getByTestId('sku-sheet').getByTestId(/^sku-/).first().click();
  await page.getByTestId('add-cart').click();
  await expect(page.getByText('已加入购物车')).toBeVisible();
  await page.goto(resolveRootUrl(h5Url, '/cart'));
  await page.getByRole('button', { name: /去结算/ }).click();
  await expect(page).toHaveURL(/\/checkout/);
  await page.getByTestId('fulfillment-pickup').check();
  await page.getByTestId('pickup-time').fill('明天上午十点');
  await page.getByTestId('contact-name').fill(`E2E-${runId}`);
  await page.getByTestId('contact-phone').fill(customerPhone);
  await page.getByTestId('remark').fill(`E2E run ${runId}`);

  const requestPromise = page.waitForRequest(isCreateOrderRequest);
  const responsePromise = page.waitForResponse((response: Response) =>
    isCreateOrderRequest(response.request()),
  );
  await page.getByTestId('submit').click();
  const [request, response] = await Promise.all([
    requestPromise,
    responsePromise,
  ]);
  expect(request.headers()['idempotency-key']).toBeTruthy();
  expect(response.ok()).toBe(true);
  await expect(page).toHaveURL(/\/orders\//);
  await expect(page.getByText('新订单')).toBeVisible();
}

async function locateUniqueOrder(page: Page, runId: string): Promise<void> {
  await page.goto(resolveRootUrl(adminUrl, '/orders'));
  await page.getByPlaceholder('输入联系人或手机号').fill(`E2E-${runId}`);
  await page.getByTestId('search-filters').click();
  const matchingRows = page
    .getByRole('row')
    .filter({ hasText: `E2E-${runId}` });
  await expect(matchingRows).toHaveCount(1);
  await matchingRows.getByRole('button', { name: '查看详情' }).click();
  await expect(
    page.getByText(`E2E run ${runId}`, { exact: true }),
  ).toBeVisible();
}

async function assertSkuStock(
  page: Page,
  productEditPath: string,
): Promise<void> {
  await page.goto(resolveRootUrl(adminUrl, productEditPath));
  await expect(page.getByTestId('stock-0')).toHaveValue('1');
}

test('管理员发布库存为 2 的 SKU，顾客自提下单后管理员处理订单', async ({
  browser,
}, testInfo) => {
  const { runId, customerPhone } = createRunIdentity(testInfo.retry);
  const categoryName = `E2E 分类 ${runId}`;
  const productName = `E2E 自提蛋糕 ${runId}`;
  const adminContext = await browser.newContext();
  const shopperContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const shopper = await shopperContext.newPage();

  try {
    await loginAsAdmin(admin);
    await createCategory(admin, categoryName);
    const productEditPath = await createPublishedProduct(
      admin,
      productName,
      categoryName,
    );

    await shopper.goto(resolveRootUrl(h5Url, '/products'));
    await shopper.getByText(productName, { exact: true }).click();
    await expect(shopper).toHaveURL(/\/products\//);
    const productPath = new URL(shopper.url()).pathname;
    await loginAsCustomer(shopper, productPath, customerPhone);
    await clearCart(shopper);
    await submitOrderAndAssertProtocol(shopper, runId, customerPhone);

    await locateUniqueOrder(admin, runId);
    await expect(admin.getByRole('button', { name: '开始处理' })).toBeVisible();
    await admin.getByRole('button', { name: '开始处理' }).click();
    await expect(admin.getByText('开始处理成功')).toBeVisible();
    await assertSkuStock(admin, productEditPath);

    await locateUniqueOrder(admin, runId);
    await admin.getByRole('button', { name: '完成订单' }).click();
    await expect(admin.getByText('完成订单成功')).toBeVisible();
  } finally {
    await Promise.allSettled([adminContext.close(), shopperContext.close()]);
  }
});
