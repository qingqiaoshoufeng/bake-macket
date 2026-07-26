# Local Default Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start the complete local bake-mall stack and make both development login pages open with credentials that successfully authenticate against the real local API.

**Architecture:** Keep credentials out of tracked product source by reading the administrator values from ignored local environment files. Put environment-dependent initial-value selection in small pure config functions so production-empty behavior can be unit tested, while the Vue views only bind the returned values. Reuse the existing H5 development login constant and the API's existing administrator seed logic.

**Tech Stack:** pnpm 9.15.4 workspace, Vue 3, Vite, Vitest, Vue Test Utils, Pinia, Vue Router, Element Plus, Vant, NestJS 11, TypeORM, MySQL 8.4, MinIO.

## Global Constraints

- Node must be `>=22.13.0`; use pnpm `9.15.4`.
- Static SPA only; do not introduce Nuxt or SSR.
- All frontend TypeScript follows the repository's functional, immutable ES6 style.
- Production builds must initialize both login forms with empty values.
- `ADMIN_PASSWORD` and `VITE_ADMIN_PASSWORD` must remain only in Git-ignored local environment files.
- Keep the existing JWT audiences, guards, storage keys, login endpoints, and redirect behavior unchanged.
- Do not modify or stage `apps/admin-web/src/views/categories/components/CategoryTable.vue` or `docs/superpowers/plans/2026-07-15-admin-category-management.md`.
- Do not create a Git commit unless the user explicitly asks for one.

## File Structure

- Create `apps/admin-web/src/views/login/config/default-admin-login.ts`: pure selection of admin form defaults from explicit environment inputs.
- Create `apps/admin-web/src/views/login/config/default-admin-login.spec.ts`: development, missing-variable, and production behavior tests.
- Modify `apps/admin-web/src/views/LoginView.vue`: bind the pure config result and correct the backend environment-variable hint.
- Create `apps/admin-web/src/views/LoginView.spec.ts`: verify rendered defaults and form-to-store submission.
- Create `apps/h5-store/src/views/login/config/default-development-login.ts`: pure selection of H5 defaults using the existing development hint.
- Create `apps/h5-store/src/views/login/config/default-development-login.spec.ts`: verify development and production behavior.
- Modify `apps/h5-store/src/views/LoginView.vue`: bind the pure config result without duplicating the credentials.
- Create `apps/h5-store/src/views/LoginView.spec.ts`: verify rendered defaults, submission, and retained quick-fill behavior.
- Modify ignored `.env`: set API port and administrator seed values without replacing unrelated existing settings.
- Create ignored `apps/admin-web/.env.local`: provide the matching Vite development form values.

---

### Task 1: Admin Login Default Configuration

**Files:**

- Create: `apps/admin-web/src/views/login/config/default-admin-login.ts`
- Create: `apps/admin-web/src/views/login/config/default-admin-login.spec.ts`

**Interfaces:**

- Consumes: explicit `isDevelopment: boolean`, optional email, and optional password.
- Produces: `getDefaultAdminLogin(input): Readonly<{ email: string; password: string }>`.

- [ ] **Step 1: Read required frontend conventions**

Read `.claude/skills/frontend-page-generator/SKILL.md` and `.claude/skills/js-functional-style/SKILL.md` before changing frontend source.

- [ ] **Step 2: Write failing pure-function tests**

Create `apps/admin-web/src/views/login/config/default-admin-login.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { getDefaultAdminLogin } from './default-admin-login.js';

describe('getDefaultAdminLogin', () => {
  it('returns configured credentials in development', () => {
    expect(
      getDefaultAdminLogin({
        isDevelopment: true,
        email: 'admin@example.com',
        password: 'admin-password',
      }),
    ).toEqual({
      email: 'admin@example.com',
      password: 'admin-password',
    });
  });

  it('falls back to empty values when development variables are missing', () => {
    expect(getDefaultAdminLogin({ isDevelopment: true })).toEqual({
      email: '',
      password: '',
    });
  });

  it('returns empty values outside development even when variables exist', () => {
    expect(
      getDefaultAdminLogin({
        isDevelopment: false,
        email: 'admin@example.com',
        password: 'admin-password',
      }),
    ).toEqual({ email: '', password: '' });
  });
});
```

- [ ] **Step 3: Run the test and observe the expected failure**

Run:

```bash
pnpm --filter @bake-mall/admin-web exec vitest run src/views/login/config/default-admin-login.spec.ts
```

Expected: FAIL because `default-admin-login.js` cannot be resolved.

- [ ] **Step 4: Implement the pure config function**

Create `apps/admin-web/src/views/login/config/default-admin-login.ts`:

```ts
interface DefaultAdminLoginInput {
  readonly isDevelopment: boolean;
  readonly email?: string;
  readonly password?: string;
}

interface AdminLoginDefaults {
  readonly email: string;
  readonly password: string;
}

const EMPTY_ADMIN_LOGIN: AdminLoginDefaults = {
  email: '',
  password: '',
};

export function getDefaultAdminLogin({
  isDevelopment,
  email,
  password,
}: DefaultAdminLoginInput): AdminLoginDefaults {
  if (!isDevelopment) return EMPTY_ADMIN_LOGIN;

  return {
    email: email ?? '',
    password: password ?? '',
  };
}
```

- [ ] **Step 5: Run the focused test**

Run the Step 3 command again.

Expected: 3 tests PASS.

---

### Task 2: Admin Login View Integration

**Files:**

- Modify: `apps/admin-web/src/views/LoginView.vue:1-17,90-96`
- Create: `apps/admin-web/src/views/LoginView.spec.ts`

**Interfaces:**

- Consumes: `getDefaultAdminLogin(...)` from Task 1 and the existing `useAdminAuthStore()` action `loginAsAdmin(email: string, password: string)`.
- Produces: development form defaults while preserving current submission and redirect behavior.

- [ ] **Step 1: Write a failing component test**

Create `apps/admin-web/src/views/LoginView.spec.ts` with a partial Element Plus mock, memory router, and shared Pinia:

```ts
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { useAdminAuthStore } from '../stores/admin-auth.js';
import LoginView from './LoginView.vue';

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>();

  return {
    ...actual,
    ElMessage: {
      warning: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

const mountLogin = async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: LoginView },
      { path: '/dashboard', component: { template: '<div>dashboard</div>' } },
    ],
  });
  await router.push('/login');
  await router.isReady();

  return {
    pinia,
    router,
    wrapper: mount(LoginView, {
      global: { plugins: [pinia, router] },
    }),
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoginView', () => {
  it('renders configured development credentials', async () => {
    const { wrapper } = await mountLogin();

    expect(
      (
        wrapper.get('[data-testid="admin-email"] input')
          .element as HTMLInputElement
      ).value,
    ).toBe('admin@example.com');
    expect(
      (
        wrapper.get('[data-testid="admin-password"] input')
          .element as HTMLInputElement
      ).value,
    ).toBe('admin-password');
  });

  it('submits the rendered credentials through the admin auth store', async () => {
    const { pinia, wrapper } = await mountLogin();
    const adminAuth = useAdminAuthStore(pinia);
    const login = vi.fn().mockResolvedValue(undefined);
    adminAuth.loginAsAdmin = login;

    await wrapper.get('form').trigger('submit.prevent');

    expect(login).toHaveBeenCalledWith('admin@example.com', 'admin-password');
  });
});
```

The test process must receive `VITE_ADMIN_EMAIL=admin@example.com` and `VITE_ADMIN_PASSWORD=admin-password` through `apps/admin-web/.env.local` before it can pass.

- [ ] **Step 2: Run the component test and verify it fails**

Run:

```bash
VITE_ADMIN_EMAIL=admin@example.com VITE_ADMIN_PASSWORD=admin-password pnpm --filter @bake-mall/admin-web exec vitest run src/views/LoginView.spec.ts
```

Expected: FAIL because the rendered values are empty.

- [ ] **Step 3: Bind the config result in LoginView.vue**

Add this import after the auth-store import:

```ts
import { getDefaultAdminLogin } from './login/config/default-admin-login.js';
```

Replace the current email/password initialization with:

```ts
const defaultLogin = getDefaultAdminLogin({
  isDevelopment: import.meta.env.DEV,
  email: import.meta.env.VITE_ADMIN_EMAIL,
  password: import.meta.env.VITE_ADMIN_PASSWORD,
});
const email = ref(defaultLogin.email);
const password = ref(defaultLogin.password);
```

Keep `submitting`, `isProduction`, and all existing submission code unchanged.

Replace the development hint copy with:

```vue
<p>
  管理员登录由 <code>POST /api/v1/admin/auth/login</code> API 驱动。
  后端请配置 <code>ADMIN_EMAIL</code> / <code>ADMIN_PASSWORD</code>，
  本地表单预填请配置 <code>VITE_ADMIN_EMAIL</code> /
  <code>VITE_ADMIN_PASSWORD</code>。
</p>
```

- [ ] **Step 4: Run the admin tests**

Run:

```bash
VITE_ADMIN_EMAIL=admin@example.com VITE_ADMIN_PASSWORD=admin-password pnpm --filter @bake-mall/admin-web exec vitest run src/views/login/config/default-admin-login.spec.ts src/views/LoginView.spec.ts
```

Expected: all tests PASS.

---

### Task 3: H5 Login Default Configuration

**Files:**

- Create: `apps/h5-store/src/views/login/config/default-development-login.ts`
- Create: `apps/h5-store/src/views/login/config/default-development-login.spec.ts`

**Interfaces:**

- Consumes: `DEVELOPMENT_LOGIN_HINT` from `apps/h5-store/src/bridge/miniapp.ts`.
- Produces: `getDefaultDevelopmentLogin(isDevelopment: boolean): Readonly<{ phone: string; code: string }>`.

- [ ] **Step 1: Write failing config tests**

Create `apps/h5-store/src/views/login/config/default-development-login.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { DEVELOPMENT_LOGIN_HINT } from '../../../bridge/miniapp.js';
import { getDefaultDevelopmentLogin } from './default-development-login.js';

describe('getDefaultDevelopmentLogin', () => {
  it('returns the shared hint in development', () => {
    expect(getDefaultDevelopmentLogin(true)).toEqual(DEVELOPMENT_LOGIN_HINT);
  });

  it('returns empty values outside development', () => {
    expect(getDefaultDevelopmentLogin(false)).toEqual({ phone: '', code: '' });
  });
});
```

- [ ] **Step 2: Run the test and observe the expected failure**

Run:

```bash
pnpm --filter @bake-mall/h5-store exec vitest run src/views/login/config/default-development-login.spec.ts
```

Expected: FAIL because `default-development-login.js` cannot be resolved.

- [ ] **Step 3: Implement the H5 config function**

Create `apps/h5-store/src/views/login/config/default-development-login.ts`:

```ts
import { DEVELOPMENT_LOGIN_HINT } from '../../../bridge/miniapp.js';

interface DevelopmentLoginDefaults {
  readonly phone: string;
  readonly code: string;
}

const EMPTY_DEVELOPMENT_LOGIN: DevelopmentLoginDefaults = {
  phone: '',
  code: '',
};

export function getDefaultDevelopmentLogin(
  isDevelopment: boolean,
): DevelopmentLoginDefaults {
  return isDevelopment ? DEVELOPMENT_LOGIN_HINT : EMPTY_DEVELOPMENT_LOGIN;
}
```

- [ ] **Step 4: Run the focused test**

Run the Step 2 command again.

Expected: 2 tests PASS.

---

### Task 4: H5 Login View Integration

**Files:**

- Modify: `apps/h5-store/src/views/LoginView.vue:6-23`
- Create: `apps/h5-store/src/views/LoginView.spec.ts`

**Interfaces:**

- Consumes: `getDefaultDevelopmentLogin(...)` from Task 3 and existing `loginWithDevelopmentCode(phone: string, code: string)`.
- Produces: H5 development defaults, with the existing quick-fill button and submission behavior intact.

- [ ] **Step 1: Write a failing component test**

Create `apps/h5-store/src/views/LoginView.spec.ts`:

```ts
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { DEVELOPMENT_LOGIN_HINT } from '../bridge/miniapp.js';
import { useAuthStore } from '../stores/auth.js';
import LoginView from './LoginView.vue';

vi.mock('vant', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vant')>();
  return { ...actual, showToast: vi.fn() };
});

vi.mock('../bridge/miniapp.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../bridge/miniapp.js')>();
  return {
    ...actual,
    installMiniappBridge: vi.fn(() => vi.fn()),
  };
});

const mountLogin = async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: LoginView },
      { path: '/', component: { template: '<div>store</div>' } },
    ],
  });
  await router.push('/login');
  await router.isReady();

  return {
    pinia,
    wrapper: mount(LoginView, {
      global: { plugins: [pinia, router] },
    }),
  };
};

const getPhone = (wrapper: ReturnType<typeof mount>) =>
  wrapper.get('input[autocomplete="tel"]');
const getCode = (wrapper: ReturnType<typeof mount>) =>
  wrapper.get('input[autocomplete="one-time-code"]');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoginView', () => {
  it('renders the shared development credentials', async () => {
    const { wrapper } = await mountLogin();

    expect((getPhone(wrapper).element as HTMLInputElement).value).toBe(
      DEVELOPMENT_LOGIN_HINT.phone,
    );
    expect((getCode(wrapper).element as HTMLInputElement).value).toBe(
      DEVELOPMENT_LOGIN_HINT.code,
    );
  });

  it('submits the rendered credentials through the auth store', async () => {
    const { pinia, wrapper } = await mountLogin();
    const auth = useAuthStore(pinia);
    const login = vi.fn().mockResolvedValue(undefined);
    auth.loginWithDevelopmentCode = login;

    await wrapper.get('form').trigger('submit.prevent');

    expect(login).toHaveBeenCalledWith(
      DEVELOPMENT_LOGIN_HINT.phone,
      DEVELOPMENT_LOGIN_HINT.code,
    );
  });

  it('keeps the development quick-fill action', async () => {
    const { wrapper } = await mountLogin();
    await getPhone(wrapper).setValue('');
    await getCode(wrapper).setValue('');
    await wrapper.get('.login__dev .link').trigger('click');

    expect((getPhone(wrapper).element as HTMLInputElement).value).toBe(
      DEVELOPMENT_LOGIN_HINT.phone,
    );
    expect((getCode(wrapper).element as HTMLInputElement).value).toBe(
      DEVELOPMENT_LOGIN_HINT.code,
    );
  });
});
```

If TypeScript rejects `ReturnType<typeof mount>` for the helpers, import `type VueWrapper` and declare the helper parameter as `VueWrapper` instead; do not weaken it to `any`.

- [ ] **Step 2: Run the component test and verify it fails**

Run:

```bash
pnpm --filter @bake-mall/h5-store exec vitest run src/views/LoginView.spec.ts
```

Expected: FAIL because the initial phone and code are empty.

- [ ] **Step 3: Bind the H5 config result**

Add this import:

```ts
import { getDefaultDevelopmentLogin } from './login/config/default-development-login.js';
```

Replace the current phone/code initialization with:

```ts
const defaultLogin = getDefaultDevelopmentLogin(import.meta.env.DEV);
const phone = ref(defaultLogin.phone);
const code = ref(defaultLogin.code);
```

Do not change `prefillDev`, the bridge, redirect validation, submission, or template.

- [ ] **Step 4: Run H5 tests**

Run:

```bash
pnpm --filter @bake-mall/h5-store exec vitest run src/views/login/config/default-development-login.spec.ts src/views/LoginView.spec.ts
```

Expected: all tests PASS.

---

### Task 5: Local Ignored Environment Configuration

**Files:**

- Modify without replacing unrelated keys: `.env` (Git ignored)
- Create or update: `apps/admin-web/.env.local` (Git ignored)

**Interfaces:**

- API consumes: `PORT`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
- admin-web consumes: `VITE_ADMIN_EMAIL`, `VITE_ADMIN_PASSWORD`.

- [ ] **Step 1: Verify both target paths are ignored**

Run:

```bash
git check-ignore -v .env apps/admin-web/.env.local
```

Expected: both paths match `.gitignore` environment-file rules. Stop before writing if either path is not ignored.

- [ ] **Step 2: Update the root environment file safely**

Use a small one-shot Node script that preserves unrelated lines, removes only existing definitions of the three target keys, and appends the approved local values:

```bash
node --input-type=module - <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';

const path = '.env';
const source = await readFile(path, 'utf8').catch(() => '');
const targetKeys = new Set(['PORT', 'ADMIN_EMAIL', 'ADMIN_PASSWORD']);
const retained = source
  .split(/\r?\n/)
  .filter((line) => !targetKeys.has(line.split('=', 1)[0] ?? ''))
  .filter((line, index, lines) => line !== '' || index < lines.length - 1);
const additions = [
  'PORT=3015',
  'ADMIN_EMAIL=admin@example.com',
  'ADMIN_PASSWORD=admin-password',
];
await writeFile(path, `${[...retained, ...additions].join('\n')}\n`);
NODE
```

Do not print the pre-existing environment-file contents.

- [ ] **Step 3: Write the ignored admin-web environment file**

Write `apps/admin-web/.env.local` with exactly:

```dotenv
VITE_ADMIN_EMAIL=admin@example.com
VITE_ADMIN_PASSWORD=admin-password
```

- [ ] **Step 4: Verify credentials remain untracked**

Run:

```bash
git status --short
git check-ignore -v .env apps/admin-web/.env.local
```

Expected: neither environment file appears in `git status`; both remain ignored. The pre-existing category changes remain present and unchanged.

---

### Task 6: Static Verification

**Files:**

- Verify all files changed in Tasks 1–5.

**Interfaces:**

- Consumes: both completed login implementations.
- Produces: evidence that tests, lint, type checking, and production builds pass.

- [ ] **Step 1: Run focused tests**

```bash
pnpm --filter @bake-mall/admin-web exec vitest run src/views/login/config/default-admin-login.spec.ts src/views/LoginView.spec.ts
pnpm --filter @bake-mall/h5-store exec vitest run src/views/login/config/default-development-login.spec.ts src/views/LoginView.spec.ts
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run frontend lint**

```bash
pnpm --filter @bake-mall/admin-web lint
pnpm --filter @bake-mall/h5-store lint
```

Expected: both commands exit 0.

- [ ] **Step 3: Run frontend type checks**

```bash
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/h5-store typecheck
```

Expected: both commands exit 0.

- [ ] **Step 4: Build production bundles**

```bash
pnpm --filter @bake-mall/admin-web build
pnpm --filter @bake-mall/h5-store build
```

Expected: both commands exit 0. The pure config tests prove production-mode inputs return empty defaults; source inspection confirms each component passes `import.meta.env.DEV` into that tested boundary.

- [ ] **Step 5: Review the final diff and protected paths**

Run:

```bash
git diff --check
git status --short
git diff -- apps/admin-web/src/views/categories/components/CategoryTable.vue
git diff -- docs/superpowers/plans/2026-07-15-admin-category-management.md
```

Expected: no whitespace errors; the category file retains its pre-existing diff; the untracked category plan remains untouched.

---

### Task 7: Start Infrastructure and Apply Migrations

**Files:**

- Runtime only; no tracked file modifications.

**Interfaces:**

- Consumes: ignored root `.env` and existing Compose/TypeORM configuration.
- Produces: healthy MySQL/MinIO and migrated local schema.

- [ ] **Step 1: Start dependencies**

Run:

```bash
pnpm services:up
pnpm services:ps
```

Expected: MySQL is healthy, MinIO is running, and the bucket initializer exits successfully.

- [ ] **Step 2: Apply migrations**

Run:

```bash
pnpm --filter @bake-mall/api migration:run
```

Expected: pending migrations apply successfully or TypeORM reports that no migrations are pending.

- [ ] **Step 3: Start the API in the background**

Run `pnpm --filter @bake-mall/api start:dev` as a harness-tracked background command.

Expected: Nest starts without a seed error and listens on port `3015`.

- [ ] **Step 4: Probe API health**

Run:

```bash
curl --fail --silent --show-error http://127.0.0.1:3015/health
```

Expected: HTTP 200. If the health route has a different response body, status 200 is sufficient.

---

### Task 8: Start Frontends and Verify Real Login Flows

**Files:**

- Runtime only; no tracked file modifications.

**Interfaces:**

- Consumes: API on `3015`, H5 on `5173`, admin-web on `5174`.
- Produces: observed end-to-end evidence for both credential sets.

- [ ] **Step 1: Start both frontend development servers**

Start these as separate harness-tracked background commands:

```bash
pnpm --filter @bake-mall/h5-store dev
pnpm --filter @bake-mall/admin-web dev
```

Expected: Vite reports H5 at `http://127.0.0.1:5173` and admin-web at `http://127.0.0.1:5174`.

- [ ] **Step 2: Verify both pages are reachable**

```bash
curl --fail --silent --show-error http://127.0.0.1:5173/login >/dev/null
curl --fail --silent --show-error http://127.0.0.1:5174/login >/dev/null
```

Expected: both commands exit 0.

- [ ] **Step 3: Verify the real H5 login endpoint through the Vite proxy**

```bash
curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13800000000","code":"123456"}' \
  http://127.0.0.1:5173/api/v1/auth/dev/login
```

Expected: HTTP 2xx with a user login response containing a token; do not print or persist the token beyond the command output needed for verification.

- [ ] **Step 4: Verify the real admin login endpoint through the Vite proxy**

```bash
curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin-password"}' \
  http://127.0.0.1:5174/api/v1/admin/auth/login
```

Expected: HTTP 2xx with an administrator login response containing a token. If it returns unauthorized, report the existing-admin password conflict instead of changing seed behavior or deleting data.

- [ ] **Step 5: Drive the browser flow**

Use the repository's `verify` or `run` skill/browser driver to observe:

1. `http://127.0.0.1:5173/login` displays `13800000000` and `123456`, submits successfully, and reaches the normal store flow.
2. `http://127.0.0.1:5174/login` displays `admin@example.com` and `admin-password`, submits successfully, and reaches `/dashboard`.
3. H5 stores only `bake_user_token`; admin-web stores only `bake_admin_token` in its existing storage location.

Expected: both flows succeed. If no browser driver is available, report that limitation separately; HTTP verification does not prove rendered field values.

- [ ] **Step 6: Final status and process report**

Run:

```bash
pnpm services:ps
git status --short
```

Report the live URLs, successful checks, any skipped browser observation, and the fact that local servers remain running. Do not commit or stage files.
