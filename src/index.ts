// Side-effect import: auto-install the Router prototype patch for Express 5
// before any user-imported router can be constructed. Loading this module
// before `express` works in typical apps where imports are at module top.
import './express-parser/instrument';

export { parseExpressApp } from './express-parser';
export { withMetadata } from './with-metadata';
export * from './types';
export * from './renderers';
