import prettier from 'eslint-config-prettier/flat';

import rootConfig from '../../eslint.config.mjs';

export default [
  ...rootConfig,
  {
    files: ['src/**/*.{ts,vue}'],
    languageOptions: {
      globals: {
        plus: 'readonly',
        uni: 'readonly',
      },
    },
  },
  prettier,
];
