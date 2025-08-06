import raycast from "@raycast/eslint-config";

export default [
  ...raycast,
  {
    ignores: ["dist/**", "node_modules/**", "*.config.js"],
  },
];
