import { stat } from 'node:fs/promises';
import { command } from './process.ts';

// Scripts are static: neither a repository path nor browser input becomes executable code.
const macScript = `
const app = Application.currentApplication();
app.includeStandardAdditions = true;
let result;
try {
  result = {path: app.chooseFolder({withPrompt: 'AIConnect: choose a Git repository folder'}).toString()};
} catch (error) {
  if (error.errorNumber === -128 || String(error).includes('(-128)')) result = {path: null};
  else throw error;
}
JSON.stringify(result).replace(/[\\u007f-\\uffff]/g, function(c) {
  return '\\\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
});
`;
const windowsScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'AIConnect: choose a Git repository folder'
$dialog.ShowNewFolderButton = $false
try {
  $selected = $null
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $selected = $dialog.SelectedPath }
  $json = @{ path = $selected } | ConvertTo-Json -Compress
  [Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))
} finally { $dialog.Dispose() }
`;

type Dependencies = {
  platform?: NodeJS.Platform;
  run?: typeof command;
  isDirectory?: (path: string) => Promise<boolean>;
};

export function createFolderPicker(dependencies: Dependencies = {}) {
  const platform = dependencies.platform ?? process.platform;
  const run = dependencies.run ?? command;
  const isDirectory = dependencies.isDirectory ?? (async (path: string) => (await stat(path)).isDirectory());
  let active = false;
  return async (): Promise<{path: string | null}> => {
    if (active) throw new Error('A folder chooser is already open on this computer. Finish or cancel it first.');
    if (platform !== 'darwin' && platform !== 'win32') {
      throw new Error('Native folder selection is available on macOS and Windows. Enter the repository path manually on this computer.');
    }
    active = true;
    try {
      let output: string;
      try {
        output = platform === 'darwin'
          ? await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', macScript], process.cwd(), {timeout: 120_000, maxBytes: 32_768})
          : await run('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-Command', windowsScript], process.cwd(), {timeout: 120_000, maxBytes: 32_768});
      } catch (error) {
        if (error instanceof Error && error.message === 'Command timed out') {
          throw new Error('Folder selection timed out after two minutes. Try again or enter the repository path manually.');
        }
        throw new Error('Could not open the folder chooser on this computer. A desktop session is required; enter the repository path manually instead.');
      }
      let selected: unknown;
      try {
        selected = JSON.parse(platform === 'win32' ? Buffer.from(output, 'base64').toString('utf8') : output);
      } catch {
        throw new Error('The folder chooser returned an invalid response. Enter the repository path manually.');
      }
      if (!selected || typeof selected !== 'object' || !('path' in selected)) {
        throw new Error('The folder chooser did not return a folder. Enter the repository path manually.');
      }
      const path = selected.path;
      if (path === null) return {path: null};
      if (typeof path !== 'string' || !path || path.includes('\0')) throw new Error('The folder chooser returned an invalid path.');
      let valid = false;
      try { valid = await isDirectory(path); } catch { /* Directory may have been removed or become inaccessible. */ }
      if (!valid) throw new Error('The selected folder is not an accessible directory on this computer.');
      return {path};
    } finally {
      active = false;
    }
  };
}

// One picker at a time for the local companion, independent of concurrent browser requests.
export const pickFolder = createFolderPicker();
