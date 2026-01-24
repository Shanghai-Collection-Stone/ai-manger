import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import * as os from 'node:os';

interface RunNpxInput {
  package: string;
  args?: string[];
  input?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  cwd?: string;
}

interface RunNpxOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * @description 通过 npx 运行外部 MCP 连接器或工具，支持传入输入与超时控制。
 * @keyword mcp, npx, process
 * @since 2026-01-24
 */
@Injectable()
export class McpProcessService {
  /**
   * @description 运行 npx 命令，并收集 stdout/stderr 与退出码。
   * @param {RunNpxInput} params 运行参数
   * @returns {Promise<RunNpxOutput>} 执行结果
   * @throws {Error} 进程启动或运行失败
   * @keyword npx, run, exec
   * @example
   * await proc.runNpx({ package: '@modelcontextprotocol/cli', args: ['--help'] });
   * @since 2026-01-24
   */
  async runNpx(params: RunNpxInput): Promise<RunNpxOutput> {
    const bin = this.getNpxBinary();
    const args = this.buildArgs(params);
    const env = this.mergeEnv(params.env);
    const cwd = params.cwd ?? process.cwd();

    return new Promise<RunNpxOutput>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let finished = false;
      const child = spawn(bin, args, {
        cwd,
        env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const timer = this.makeTimer(child, params.timeoutMs, () => {
        if (!finished) {
          finished = true;
          reject(new Error('MCP_NPX_TIMEOUT'));
        }
      });

      child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf-8')));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf-8')));

      child.on('error', (e) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      });

      child.on('close', (code: number) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });

      const input = params.input ?? '';
      if (input && input.length > 0) {
        child.stdin.write(input);
      }
      child.stdin.end();
    });
  }

  private getNpxBinary(): string {
    if (os.platform() === 'win32') return 'npx.cmd';
    return 'npx';
  }

  private buildArgs(params: RunNpxInput): string[] {
    const arr: string[] = [];
    arr.push(params.package);
    if (Array.isArray(params.args)) {
      for (const a of params.args) {
        if (typeof a === 'string') arr.push(a);
      }
    }
    return arr;
  }

  private mergeEnv(env?: Record<string, string>): NodeJS.ProcessEnv {
    const merged: NodeJS.ProcessEnv = { ...process.env };
    if (env && typeof env === 'object') {
      for (const [k, v] of Object.entries(env)) {
        merged[k] = v;
      }
    }
    return merged;
  }

  private makeTimer(
    child: import('node:child_process').ChildProcess,
    timeoutMs?: number,
    onTimeout?: () => void,
  ): NodeJS.Timeout {
    const ms =
      typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 60_000;
    return setTimeout(() => {
      try {
        child.kill();
      } catch {
        void 0;
      }
      try {
        if (onTimeout) onTimeout();
      } catch {
        void 0;
      }
    }, ms);
  }
}
