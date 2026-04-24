// Explicit boundary around old screen/widget runtime. New layout-tree code should
// only touch legacy rendering through this adapter.

export { renderProject as renderLegacyProject } from "./renderer.js";
export { resolveProjectState as resolveLegacyProjectState } from "./resolve.js";
