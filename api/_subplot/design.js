// Which design a request renders. Same per-request pattern as the brand: a Node serverless
// instance handles one request at a time, so a module-level value is safe here.
// 3 is the live design since 9 Sep 2026 (the front page as a lead package, format colours,
// Snippets). 1 and 2 remain reachable with ?d=1 / ?d=2 as an escape hatch.
let active = 3;
export const setDesign = v => { active = v === 2 ? 2 : v === 1 ? 1 : 3; };
export const design = () => active;
