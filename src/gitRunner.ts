import { execFile } from 'node:child_process';
import * as nodePath from 'node:path';

const MAX_ARGUMENT_BYTES = 24 * 1024;

export interface GitResult {
  stdout: Buffer;
  stderr: Buffer;
}

/** Runs fixed Git commands with no shell and a sanitized environment. */
export class GitRunner {
  public constructor(private readonly executable: string, public readonly root: string) {
    if (!executable?.trim() || executable.includes('\0')) throw new Error('VS Code did not provide a safe Git executable path.');
    if (!root?.trim() || root.includes('\0') || !nodePath.isAbsolute(root)) throw new Error('A safe absolute repository root is required.');
  }

  public run(args: string[], allowFailure = false): Promise<GitResult> {
    if (!Array.isArray(args) || args.length === 0 || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
      return Promise.reject(new Error('Git arguments contain an unsafe value.'));
    }
    if (Buffer.byteLength(args.join('\0'), 'utf8') > MAX_ARGUMENT_BYTES) {
      return Promise.reject(new Error('The selected group paths exceed the 24 KiB safety limit.'));
    }
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
    return new Promise((resolve, reject) => {
      execFile(this.executable, args, { cwd: this.root, env, encoding: 'buffer', windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        const result = { stdout: Buffer.from(stdout ?? ''), stderr: Buffer.from(stderr ?? '') };
        if (error && !allowFailure) {
          reject(new Error(result.stderr.toString('utf8').trim() || error.message));
        } else {
          resolve(result);
        }
      });
    });
  }
}
