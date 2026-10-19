/*
 * Public API of @libis/primo-alpine
 */
// @libis/primo-shared-state is compiled with tsc decorators; Angular reads its constructor
// parameters from reflect-metadata, which must load before that package does.
import 'reflect-metadata';
export { getAlpine, runSetupOnce } from './lib/alpine';
export type { AlpineType } from './lib/alpine';
export { PrimoBridge, selectorKeys, selectorName } from './lib/bridge';
export type { BridgeOptions, PrimoStateLike } from './lib/bridge';
export { PRIMO_ALPINE_CONFIG, PrimoAlpineContext, providePrimoAlpine } from './lib/context';
export type { PrimoAlpineConfig } from './lib/context';
export { AlpineIsland } from './lib/island';
export { RECORD_RESOLVERS, RecordTracker, recordKeys } from './lib/record';
export type { RecordResolver } from './lib/record';
export { PRIMO_DOMAINS } from './lib/types';
export type { DomainView, IslandData, IslandMagics, PrimoDomain, PrimoView } from './lib/types';
