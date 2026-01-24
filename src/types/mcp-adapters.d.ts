declare module '@langchain/mcp-adapters' {
  export class MultiServerMCPClient {
    constructor(config: Record<string, unknown>);
    getTools(): Promise<any[]>;
  }
}
