import { execFile } from 'node:child_process';
import * as nodePath from 'node:path';

const MAX_ARGUMENT_BYTES = 24 * 1024;

export interface GitResult {
  stdout: Buffer;
  stderr: Buffer;
  /** Exit status. Some commands, like merge-file, answer in this rather than stderr. */
  code: number;
}

/**
 * The only GIT_* variables a caller may set.
 *
 * The environment is stripped of every GIT_* variable precisely so a stale or
 * hostile one cannot redirect a command at the wrong repository. This allowlist
 * exists for the split commit, which needs Git pointed at a scratch index file
 * it just created; anything not named here is still refused.
 */
const ALLOWED_ENV = new Set(['GIT_INDEX_FILE']);

/**
 * Runs Git directly. No shell, ever.
 *
 * Everything goes through execFile with an argument array, so a file named
 * something creative like `; rm -rf ~` is just a filename and not an incident.
 * The environment gets every GIT_* variable stripped first, because inheriting
 * someone's GIT_INDEX_FILE or GIT_DIR from an outer process is a great way to
 * operate confidently on entirely the wrong repository.
 *
 * There is also a 24 KiB cap on the argument list: commit a large enough group
 * and you would otherwise hit the OS limit, where the failure is far less
 * legible than the message below.
 */
export class GitRunner {
  /** The optional logger records every failing command, argv and all. */
  public constructor(
    private readonly executable: string,
    public readonly root: string,
    private readonly log?: (message: string) => void
  ) {
    if (!executable?.trim() || executable.includes('\0')) throw new Error('VS Code did not provide a safe Git executable path.');
    if (!root?.trim() || root.includes('\0') || !nodePath.isAbsolute(root)) throw new Error('A safe absolute repository root is required.');
  }

  public run(args: string[], allowFailure = false, extraEnv: Record<string, string> = {}): Promise<GitResult> {
    if (!Array.isArray(args) || args.length === 0 || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
      return Promise.reject(new Error('Git arguments contain an unsafe value.'));
    }
    for (const [key, value] of Object.entries(extraEnv)) {
      if (!ALLOWED_ENV.has(key) || typeof value !== 'string' || value.includes('\0')) {
        return Promise.reject(new Error(`Refusing to set the Git environment variable ${key}.`));
      }
    }
    if (Buffer.byteLength(args.join('\0'), 'utf8') > MAX_ARGUMENT_BYTES) {
      return Promise.reject(new Error('The selected group paths exceed the 24 KiB safety limit.'));
    }
    const env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_'))),
      ...extraEnv
    };
    return new Promise((resolve, reject) => {
      execFile(this.executable, args, { cwd: this.root, env, encoding: 'buffer', windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        const code = typeof (error as { code?: unknown })?.code === 'number' ? (error as { code: number }).code : error ? 1 : 0;
        const result = { stdout: Buffer.from(stdout ?? ''), stderr: Buffer.from(stderr ?? ''), code };
        if (error && !allowFailure) {
          // Git's own message alone ("fatal: ...") does not say which of the
          // dozen commands behind one group action produced it, which makes a
          // bug report almost impossible to act on. Name the subcommand in the
          // error, and put the full argv in the log.
          const detail = result.stderr.toString('utf8').trim() || error.message;
          const subcommand = args.find(arg => !arg.startsWith('-')) ?? 'git';
          this.log?.(`  git ${args.join(' ')}`);
          this.log?.(`  -> ${detail}`);
          reject(new Error(`git ${subcommand} failed: ${detail}`));
        } else {
          resolve(result);
        }
      });
    });
  }
}
