/**
 * Minimal ambient types for facebook-nodejs-business-sdk v24.
 *
 * The package ships no TypeScript definitions (`types` is absent from its
 * package.json), so this declares only the surface we actually use. Values
 * were read from the installed package, not recalled.
 *
 * Kept in step with ../../src/types/facebook-nodejs-business-sdk.d.ts.
 */
declare module 'facebook-nodejs-business-sdk' {
  export class FacebookAdsApi {
    static init(accessToken: string): FacebookAdsApi;
    static get VERSION(): string;
    setDebug(flag: boolean): FacebookAdsApi;
  }

  interface Node {
    id: string;
    [key: string]: unknown;
  }

  export class AdAccount {
    constructor(id: string, data?: Record<string, unknown>);
    read(fields: string[]): Promise<Node>;
    createCampaign(fields: string[], params: Record<string, unknown>): Promise<Node>;
    createAdSet(fields: string[], params: Record<string, unknown>): Promise<Node>;
    createAdCreative(fields: string[], params: Record<string, unknown>): Promise<Node>;
    createAd(fields: string[], params: Record<string, unknown>): Promise<Node>;
    createAdImage(fields: string[], params: Record<string, unknown>): Promise<Node>;
  }

  export class Campaign {
    constructor(id: string, data?: Record<string, unknown>);
    read(fields: string[]): Promise<Node>;
    delete(fields?: string[], params?: Record<string, unknown>): Promise<unknown>;
    static Objective: Record<string, string>;
    static Status: Record<string, string>;
  }

  export class AdSet {
    constructor(id: string, data?: Record<string, unknown>);
    read(fields: string[]): Promise<Node>;
    delete(fields?: string[], params?: Record<string, unknown>): Promise<unknown>;
    static BillingEvent: Record<string, string>;
    static OptimizationGoal: Record<string, string>;
    static Status: Record<string, string>;
  }

  export class Ad {
    constructor(id: string, data?: Record<string, unknown>);
    read(fields: string[]): Promise<Node>;
    static Status: Record<string, string>;
    static EffectiveStatus: Record<string, string>;
  }
}
