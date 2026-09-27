import { spawn, SpawnOptions } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunCommandOptions extends SpawnOptions {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  timeoutMs?: number;
}

/**
 * Execute child process safely using spawn with argument array.
 * Never concatenates strings into a shell to prevent injection
 * and safely handle paths with spaces or Unicode / Vietnamese characters.
 */
export function runSpawn(
  command: string,
  args: string[],
  options: RunCommandOptions = {}
): { promise: Promise<CommandResult>; cancel: () => void } {
  let child: ReturnType<typeof spawn> | null = null;
  let killed = false;

  const cancel = () => {
    killed = true;
    if (child && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch (err) {
        // Ignore kill error
      }
    }
  };

  const promise = new Promise<CommandResult>((resolve, reject) => {
    const { onStdout, onStderr, timeoutMs, env, ...spawnOpts } = options;

    // Preserve and extend environment with standard tool paths
    const combinedEnv = {
      ...process.env,
      PATH: [
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/bin',
        process.env.PATH || '',
      ].filter(Boolean).join(':'),
      ...env,
    };

    try {
      child = spawn(command, args, {
        ...spawnOpts,
        env: combinedEnv,
        windowsHide: true,
      });
    } catch (err) {
      return reject(err);
    }

    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | null = null;

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        cancel();
        reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`));
      }, timeoutMs);
    }

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data: string) => {
        stdout += data;
        if (onStdout) onStdout(data);
      });
    }

    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (data: string) => {
        stderr += data;
        if (onStderr) onStderr(data);
      });
    }

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        code: code ?? (killed ? 130 : 0),
        stdout,
        stderr,
      });
    });
  });

  return { promise, cancel };
}

/**
 * Format seconds into mm:ss or hh:mm:ss
 */
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const m = String(mins).padStart(2, '0');
  const s = String(secs).padStart(2, '0');
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${m}:${s}`;
  }
  return `${m}:${s}`;
}

/**
 * Parse time string (hh:mm:ss or mm:ss or seconds) to seconds
 */
export function parseTimeString(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return 0;
}
