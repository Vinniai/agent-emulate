import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Local flat config so this app is linted with the same rules as the
// workspace packages. The root eslint.config.mjs globally ignores apps/**
// (apps are expected to bring their own toolchain), so without this file
// `eslint` here resolves the root config and reports "all files ignored".
export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**"],
  },
  tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
