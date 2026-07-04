// json-logic-js ships no type declarations. Declare the minimal surface the
// plugin uses, and — crucially — as a STATIC module so esbuild bundles it into
// the plugin's server bundle. A runtime `require("json-logic-js")` (via
// createRequire) is left external by esbuild and fails at load time because the
// installed plugin ships no node_modules.
declare module "json-logic-js" {
  const jsonLogic: {
    readonly apply: (rule: unknown, data?: unknown) => unknown;
    readonly truthy: (value: unknown) => boolean;
  };
  export default jsonLogic;
}
