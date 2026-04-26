// eslint.config.ts

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,

  ...tseslint.configs.recommended,

  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@platform/*/src/*"],
              message:
                "❌ Do not import from src. Use public API (package root).",
            },
            {
              group: ["../*/src/*"],
              message: "❌ Cross-package relative imports are not allowed.",
            },
          ],
        },
      ],
    },
  },
];
