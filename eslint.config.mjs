import globals from "globals";
import pluginJs from "@eslint/js";

export default [
  {
    languageOptions: { 
        globals: {
            ...globals.browser,
            ...globals.es2021
        },
        sourceType: "module"
    }
  },
  pluginJs.configs.recommended,
  {
    rules: {
        "no-unused-vars": "warn",
        "no-undef": "warn",
        "no-console": "off"
    }
  }
];