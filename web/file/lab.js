const $ = (id) => document.getElementById(id);
const limits = { entries: 1000, preview: 1024, hash: 32 * 1024 * 1024 };
const sampleText = 'Greetings from File Galaxy!\nThis sample was generated in your browser.\n';
const entries = [];
const journal = [];
let selected = -1;
let readVersion = 0;
let activeHandle;
let editBaseline;
let monitor;
let pickInProgress = false;

function report(message) {
  journal.push('[' + new Date().toLocaleTimeString() + '] ' + message);
  if (journal.length > 80) journal.shift();
  $('log').textContent = journal.join('\n');
  $('log').scrollTop = $('log').scrollHeight;
}

function on(id, action) {
  $(id).addEventListener('click', async () => {
    const button = $(id);
    if (button.getAttribute('aria-busy') === 'true') return;
    button.setAttribute('aria-busy', 'true');
    try {
      await action();
    } catch (error) {
      report(button.textContent + ': ' + (error.name || 'Error') + ' · ' + (error.message || error));
    } finally {
      button.removeAttribute('aria-busy');
    }
  });
}

const features = [
  ['Secure context', isSecureContext],
  ['File, Blob, FileReader', !!(window.File && window.Blob && window.FileReader)],
  ['FileReaderSync (dedicated worker)', null],
  ['Directory input (webkitdirectory)', 'webkitdirectory' in $('folder-input')],
  ['Drag and drop (DataTransfer)', !!window.DataTransfer],
  ['Legacy drop entries (webkitGetAsEntry)', !!window.DataTransferItem?.prototype.webkitGetAsEntry],
  ['Native drop handles (getAsFileSystemHandle)', !!window.DataTransferItem?.prototype.getAsFileSystemHandle],
  ['Clipboard events', !!window.ClipboardEvent],
  ['ClipboardItem read', !!navigator.clipboard?.read],
  ['ClipboardItem write', !!(navigator.clipboard?.write && window.ClipboardItem)],
  ['Native open file picker', !!window.showOpenFilePicker],
  ['Native directory picker', !!window.showDirectoryPicker],
  ['Native Save As picker', !!window.showSaveFilePicker],
  ['Handle permissions', !!window.FileSystemHandle?.prototype.queryPermission],
  ['Writable file stream', !!window.FileSystemFileHandle?.prototype.createWritable],
  ['IndexedDB', !!window.indexedDB],
  ['Origin private file system', !!navigator.storage?.getDirectory],
  ['OPFS sync handle (dedicated worker)', null],
  ['Storage usage estimate', !!navigator.storage?.estimate],
  ['FileSystemObserver (experimental)', !!window.FileSystemObserver],
  ['Legacy sandbox filesystem', !!(window.requestFileSystem || window.webkitRequestFileSystem)],
  ['Object URL downloads', !!URL.createObjectURL],
  ['Blob streams', !!Blob.prototype.stream],
  ['SHA-256 (Web Crypto)', !!window.crypto?.subtle],
  ['Launch Queue (installed app integration)', !!window.launchQueue],
];

function installMatrix() {
  for (const [name, supported] of features) {
    const row = $('matrix').insertRow();
    row.insertCell().textContent = name;
    const status = row.insertCell();
    if (supported === null) {
      status.textContent = 'Checking worker…';
      const worker = new Worker('vault-worker.js');
      worker.onmessage = ({ data }) => {
        const exposed = name.startsWith('OPFS') ? data.syncAccess : data.fileReaderSync;
        status.dataset.supported = String(exposed);
        status.textContent = exposed ? 'Exposed' : 'Unavailable';
        worker.terminate();
      };
      worker.onerror = () => {
        status.textContent = 'Worker unavailable';
        worker.terminate();
      };
      worker.postMessage({ probe: true });
    } else {
      status.dataset.supported = String(supported);
      status.textContent = supported ? 'Exposed' : 'Unavailable';
    }
  }
}

function renderPage() {
  const requested = location.hash.slice(1);
  const panels = [...document.querySelectorAll('main > section[id]')];
  const page = panels.some((panel) => panel.id === requested) ? requested : 'intake';
  for (const panel of panels) panel.hidden = panel.id !== page;
  if (parent !== window) parent.postMessage({ fileGalaxyPage: page }, location.origin);
  window.scrollTo(0, 0);
}

function addFiles(files, source) {
  if (!files.length) {
    report(source + ': no files to show.');
    return;
  }
  entries.splice(0, entries.length, ...files.slice(0, limits.entries));
  const label = document.createElement('label');
  label.htmlFor = 'selected-file';
  label.textContent = entries.length + (entries.length === 1 ? ' file · ' : ' files · ') + source;
  const select = document.createElement('select');
  select.id = 'selected-file';
  for (const [index, entry] of entries.entries()) {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = entry.path + ' (' + entry.file.size.toLocaleString() + ' bytes)';
    select.append(option);
  }
  select.onchange = () => showFile(Number(select.value));
  $('manifest').replaceChildren(label, select);
  report(source + ': ' + entries.length + ' file(s) loaded' + (files.length > entries.length ? ' (manifest limit reached).' : '.'));
  showFile(0);
}

function fromFiles(list) {
  return [...list].map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

function readWithFileReader(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(new DOMException('File read cancelled.', 'AbortError'));
    reader.readAsArrayBuffer(blob);
  });
}

function isTextFile(file) {
  return /^(text\/|application\/(json|xml))/.test(file.type)
    || /\.(txt|csv|tsv|md|log|json|xml|html?|js|css|svg)$/i.test(file.name);
}

async function showFile(index) {
  selected = index;
  const version = ++readVersion;
  const { file, path } = entries[index];
  $('stream').disabled = !file.stream;
  $('sync-read').disabled = !window.Worker;
  $('hash').disabled = !window.crypto?.subtle || file.size > limits.hash;
  $('download').disabled = false;
  const info = [
    'Path: ' + path,
    'Type: ' + (file.type || '(unspecified)'),
    'Size: ' + file.size.toLocaleString() + ' bytes',
    'Modified: ' + new Date(file.lastModified).toLocaleString(),
  ].join('\n');
  $('inspection').textContent = info;
  try {
    const bytes = await readWithFileReader(file.slice(0, limits.preview));
    if (version !== readVersion) return;
    const hex = [...bytes.subarray(0, 32)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const preview = isTextFile(file) && bytes.length ? '\n\nText preview:\n' + new TextDecoder().decode(bytes) : '';
    $('inspection').textContent = info + '\n\nFirst bytes (FileReader): ' + (hex || '(empty)') + preview;
  } catch (error) {
    if (version === readVersion) $('inspection').textContent = info + '\n\nPreview failed: ' + error.message;
  }
}

async function appendInspection(file, getResult) {
  const version = readVersion;
  const result = await getResult(file);
  if (version === readVersion) $('inspection').textContent += '\n\n' + result;
  report(result);
}

async function walkDirectory(root) {
  const pending = [[root, '']];
  const files = [];
  let seen = 0;
  while (pending.length) {
    const [directory, prefix] = pending.pop();
    for await (const handle of directory.values()) {
      if (++seen > limits.entries) throw new Error('This experiment scans at most 1,000 entries.');
      const path = prefix + handle.name;
      if (handle.kind === 'directory') pending.push([handle, path + '/']);
      else files.push({ path, file: await handle.getFile() });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function readLegacyEntries(roots) {
  const pending = [...roots];
  const files = [];
  let seen = 0;
  while (pending.length) {
    if (++seen > limits.entries) throw new Error('This experiment scans at most 1,000 entries.');
    const entry = pending.pop();
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      files.push({ file, path: entry.fullPath.replace(/^\//, '') });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      while (true) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        if (seen + pending.length + batch.length > limits.entries) throw new Error('This experiment scans at most 1,000 entries.');
        pending.push(...batch);
      }
    }
  }
  return files;
}

async function dropFiles(transfer) {
  const plain = fromFiles(transfer.files);
  const items = [...transfer.items].filter((item) => item.kind === 'file').slice(0, limits.entries);
  // The drag data store is readable only during the drop handler. Capture every method before awaiting.
  const legacy = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  const results = await Promise.allSettled(items.map((item) => item.getAsFileSystemHandle?.()));
  const handles = results.map((result) => result.value).filter(Boolean);
  const denied = results.filter((result) => result.status === 'rejected');
  if (denied.length) report('Native drop handles failed: ' + denied[0].reason);
  report('Drop APIs returned ' + plain.length + ' plain file(s), ' + legacy.length + ' legacy entr' + (legacy.length === 1 ? 'y' : 'ies') + ', ' + handles.length + ' native handle(s).');
  if (handles.length && handles.length === items.length) {
    const files = [];
    const folders = handles.filter((handle) => handle.kind === 'directory');
    for (const handle of handles) {
      if (handle.kind === 'directory') {
        for (const entry of await walkDirectory(handle)) {
          files.push({ ...entry, path: handle.name + '/' + entry.path });
        }
      } else {
        files.push({ path: handle.name, file: await handle.getFile() });
      }
      if (files.length > limits.entries) throw new Error('This experiment loads at most 1,000 files per drop.');
    }
    if (handles.length === 1) setHandle(folders[0] || handles[0]);
    addFiles(files, 'native drop handles');
  } else if (legacy.length) {
    addFiles(await readLegacyEntries(legacy), 'legacy drop entries');
  } else {
    addFiles(plain, 'plain file drop');
  }
}

function setHandle(handle) {
  stopMonitor();
  activeHandle = handle;
  editBaseline = undefined;
  $('handle-label').textContent = handle.kind + ': ' + handle.name;
  $('watch-state').textContent = handle.kind === 'directory' ? 'Ready: ' + handle.name : 'Choose a folder to watch.';
  $('read-handle').disabled = false;
  $('load-text').disabled = handle.kind !== 'file' || !crypto.subtle;
  $('write-back').disabled = true;
  $('permission-query').disabled = !handle.queryPermission;
  $('permission-request').disabled = !handle.requestPermission;
  $('handle-store').disabled = !window.indexedDB;
  updateWatchButtons();
}

async function pick(action) {
  if (pickInProgress) {
    report('A native chooser is already open.');
    return undefined;
  }
  pickInProgress = true;
  try {
    return await action();
  } catch (error) {
    if (error.name !== 'AbortError') throw error;
    // Some embedded browser hosts expose the picker but return AbortError without
    // showing it. Cancellation uses the same error. Remove the host hint if the
    // embedded preview reliably supports native pickers.
    report('No selection returned. If the picker did not appear, try “Open full page,” or open the lab in desktop Chrome or Edge.');
    return undefined;
  } finally {
    pickInProgress = false;
  }
}

async function inspectHandle(handle) {
  if (handle.kind === 'file') {
    addFiles(fromFiles([await handle.getFile()]), 'native file handle');
    report('Choose File intake to see the manifest.');
  } else {
    const files = await walkDirectory(handle);
    addFiles(files, 'folder ' + handle.name);
    report(files.length ? files.map(({ path }) => path).slice(0, 20).join('\n') + (files.length > 20 ? '\n… see File intake for the full list.' : '') : 'Folder is empty.');
  }
}

async function chooseFolder() {
  const handle = await pick(() => window.showDirectoryPicker({ mode: 'read', id: 'file-galaxy-folder' }));
  if (handle) {
    setHandle(handle);
    await inspectHandle(handle);
  }
}

function handleDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('file-galaxy', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function savedHandle(mode, operation) {
  const database = await handleDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('handles', mode);
      const request = operation(transaction.objectStore('handles'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || request.error);
    });
  } finally {
    database.close();
  }
}

async function writeFile(handle, text) {
  // Blob.pipeTo closes on success and aborts the destination if writing fails.
  await new Blob([text], { type: 'text/plain' }).stream().pipeTo(await handle.createWritable());
}

function updateWatchButtons() {
  const ready = activeHandle?.kind === 'directory' && !monitor;
  $('watch-poll').disabled = !ready;
  $('watch-native').disabled = !ready || !window.FileSystemObserver;
  $('watch-stop').disabled = !monitor;
}

function stopMonitor() {
  if (!monitor) return;
  monitor.stop();
  monitor = undefined;
  $('watch-state').textContent = 'Stopped.';
  updateWatchButtons();
  report('Folder monitoring stopped.');
}

async function startPolling() {
  const handle = activeHandle;
  const snapshot = async () => new Map((await walkDirectory(handle)).map(({ path, file }) => [path, file.size + ':' + file.lastModified]));
  let current = await snapshot();
  if (handle !== activeHandle || monitor) return;
  let pending = false;
  const timer = setInterval(async () => {
    if (document.hidden || pending) return;
    pending = true;
    try {
      const next = await snapshot();
      if (monitor !== run) return;
      for (const [path, value] of next) {
        if (!current.has(path)) report('Polling · added: ' + path);
        else if (value !== current.get(path)) report('Polling · modified: ' + path);
      }
      for (const path of current.keys()) if (!next.has(path)) report('Polling · removed: ' + path);
      current = next;
    } catch (error) {
      if (monitor === run) {
        report('Polling failed: ' + error.message);
        stopMonitor();
      }
    } finally {
      pending = false;
    }
  }, 2000);
  const run = { stop: () => clearInterval(timer) };
  monitor = run;
  updateWatchButtons();
  $('watch-state').textContent = 'Polling ' + handle.name + ' every 2 seconds while visible.';
  report('Polling started with ' + current.size + ' file(s).');
}

async function startObserver() {
  const handle = activeHandle;
  const observer = new FileSystemObserver((records) => {
    if (monitor !== run) return;
    for (const record of records) {
      report('Observer · ' + record.type + ': ' + (record.relativePathComponents?.join('/') || '(folder)'));
    }
    if (records.some(({ type }) => type === 'errored')) stopMonitor();
  });
  const run = { stop: () => observer.disconnect() };
  monitor = run;
  updateWatchButtons();
  try {
    await observer.observe(handle, { recursive: true });
    if (monitor !== run) {
      observer.disconnect();
      return;
    }
    $('watch-state').textContent = 'Native observation active: ' + handle.name;
    report('FileSystemObserver started.');
  } catch (error) {
    if (monitor === run) stopMonitor();
    throw error;
  }
}

async function vault(create = false) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('file-galaxy-lab', { create });
}

function vaultResult(message) {
  $('vault-result').textContent = message;
  report('Private vault: ' + message.split('\n', 1)[0]);
}

function runWorker(message) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('vault-worker.js');
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Worker failed to load.'));
    };
    worker.postMessage(message);
  });
}

function disableWhen(id, supported) {
  $(id).disabled = !supported;
  if (!supported) $(id).title = 'This API is unavailable in this browser or context.';
}

$('manifest').textContent = 'No files received.';
for (const [id, source] of [['file-input', 'file input'], ['folder-input', 'directory input']]) {
  $(id).addEventListener('change', (event) => {
    addFiles(fromFiles(event.target.files), source);
    event.target.value = '';
  });
}
on('sample', () => addFiles(fromFiles([new File([sampleText], 'transmission.txt', { type: 'text/plain' })]), 'generated sample'));

const drop = $('drop');
drop.ondragover = (event) => {
  event.preventDefault();
  drop.setAttribute('data-active', '');
  event.dataTransfer.dropEffect = 'copy';
};
drop.ondragleave = (event) => {
  if (!drop.contains(event.relatedTarget)) drop.removeAttribute('data-active');
};
drop.ondrop = async (event) => {
  event.preventDefault();
  drop.removeAttribute('data-active');
  try {
    await dropFiles(event.dataTransfer);
  } catch (error) {
    report('Drop failed: ' + error.message);
  }
};

$('paste').addEventListener('paste', (event) => {
  const data = event.clipboardData;
  if (!data) return;
  const files = fromFiles(data.files);
  const text = data.getData('text/plain');
  if (!files.length && text) {
    files.push({ path: 'pasted-text.txt', file: new File([text], 'pasted-text.txt', { type: 'text/plain' }) });
  }
  event.preventDefault();
  addFiles(files, 'clipboard paste event');
});
on('clipboard-read', async () => {
  const items = await navigator.clipboard.read();
  const files = [];
  for (const [index, item] of items.entries()) {
    for (const [format, type] of item.types.entries()) {
      const blob = await item.getType(type);
      const suffix = type.split('/')[1]?.split(';')[0] || 'bin';
      const name = 'clipboard-' + (index + 1) + '-' + (format + 1) + '.' + suffix;
      files.push(new File([blob], name, { type }));
    }
  }
  addFiles(fromFiles(files), 'async clipboard');
});
on('clipboard-write', async () => {
  await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([sampleText], { type: 'text/plain' }) })]);
  report('Sample text copied with ClipboardItem.');
});
on('stream', () => appendInspection(entries[selected].file, async (file) => {
  // Read a bounded prefix so very large files do not monopolize the page.
  let bytes = 0;
  let chunks = 0;
  for await (const chunk of file.slice(0, 1024 * 1024).stream()) {
    chunks++;
    bytes += chunk.byteLength;
  }
  return 'Blob.stream(): ' + bytes.toLocaleString() + ' bytes in ' + chunks + ' chunks' + (file.size > bytes ? ' (first MiB).' : '.');
}));
on('sync-read', () => appendInspection(entries[selected].file, async (file) => {
  const result = await runWorker({ blob: file.slice(0, limits.preview) });
  return 'FileReaderSync: ' + result.read + ' bytes read in a dedicated worker.';
}));
on('hash', () => appendInspection(entries[selected].file, async (file) => {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  return 'SHA-256: ' + [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}));
on('download', () => {
  const file = entries[selected].file;
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  report('Download requested: ' + file.name);
});

on('open-file', async () => {
  const handles = await pick(() => window.showOpenFilePicker({ multiple: true }));
  if (!handles?.length) return;
  setHandle(handles[0]);
  addFiles(fromFiles(await Promise.all(handles.map((handle) => handle.getFile()))), 'native open picker');
  report('Choose File intake to see the manifest. Local drive uses the first handle.');
});
on('open-folder', chooseFolder);
on('watch-folder', chooseFolder);
on('read-handle', () => inspectHandle(activeHandle));
on('permission-query', async () => {
  const handle = activeHandle;
  const [read, write] = await Promise.all([
    handle.queryPermission({ mode: 'read' }),
    handle.queryPermission({ mode: 'readwrite' }),
  ]);
  report(handle.name + ' · read: ' + read + ', read/write: ' + write);
});
on('permission-request', async () => {
  const handle = activeHandle;
  const permission = await handle.requestPermission({ mode: 'read' });
  report(handle.name + ' · read permission: ' + permission);
  if (permission === 'granted' && activeHandle === handle) await inspectHandle(handle);
});
on('handle-store', async () => {
  const handle = activeHandle;
  await savedHandle('readwrite', (store) => store.put(handle, 'latest'));
  report('Remembered handle: ' + handle.name);
});
on('handle-restore', async () => {
  const handle = await savedHandle('readonly', (store) => store.get('latest'));
  if (handle) {
    setHandle(handle);
    report('Restored ' + handle.name + '. Check its permission before reading.');
  } else report('No saved handle.');
});
on('handle-forget', async () => {
  await savedHandle('readwrite', (store) => store.delete('latest'));
  report('Saved handle forgotten.');
});
on('save-file', async () => {
  const contents = $('disk-text').value;
  const handle = await pick(() => window.showSaveFilePicker({ suggestedName: 'file-galaxy.txt' }));
  if (!handle) return;
  await writeFile(handle, contents);
  report('Text written to ' + handle.name);
});

async function fingerprint(file) {
  if (file.size > 1024 * 1024) throw new Error('Write-back accepts files up to 1 MiB.');
  const bytes = await file.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)).join(',');
  return { bytes, digest };
}

on('load-text', async () => {
  const handle = activeHandle;
  const file = await handle.getFile();
  if (!isTextFile(file)) throw new Error('Choose a text file for write-back.');
  const { bytes, digest } = await fingerprint(file);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (text.includes('\0')) throw new Error('The opened file does not appear to be text.');
  if (handle !== activeHandle) return;
  editBaseline = { handle, digest };
  $('disk-text').value = text;
  $('write-back').disabled = !handle.requestPermission || !handle.createWritable;
  report('Loaded ' + handle.name + ' for editing.');
});

on('write-back', async () => {
  const { handle, digest } = editBaseline;
  const value = $('disk-text').value;
  const content = new Blob([value], { type: 'text/plain' });
  if (content.size > 1024 * 1024) throw new Error('Write-back accepts files up to 1 MiB.');
  if (!window.confirm('Replace “' + handle.name + '” with the text in the editor?')) return;
  if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
    throw new Error('Write permission was not granted.');
  }
  const checkUnchanged = async () => {
    const current = await fingerprint(await handle.getFile());
    if (current.digest !== digest) throw new Error('The local file changed. Reload it before editing again.');
  };
  await checkUnchanged();
  const stream = await handle.createWritable({ mode: 'exclusive' });
  try {
    await stream.write(content);
    await checkUnchanged();
    await stream.close();
  } catch (error) {
    await stream.abort();
    throw error;
  }
  if (activeHandle === handle) editBaseline = { handle, digest: (await fingerprint(content)).digest };
  report('Replaced the contents of ' + handle.name + '.');
});

on('vault-write', async () => {
  const directory = await vault(true);
  const handle = await directory.getFileHandle('notes.txt', { create: true });
  await writeFile(handle, $('vault-text').value);
  vaultResult('Wrote notes.txt using a FileSystemWritableFileStream.');
});
on('vault-read', async () => {
  const handle = await (await vault()).getFileHandle('notes.txt');
  const file = await handle.getFile();
  vaultResult('Read notes.txt (' + file.size + ' bytes)\n\n' + await file.text());
});
on('vault-list', async () => {
  const names = [];
  for await (const entry of (await vault(true)).values()) names.push(entry.kind + ' · ' + entry.name);
  vaultResult('Vault directory\n' + (names.join('\n') || '(empty)'));
});
on('vault-delete', async () => {
  await (await vault()).removeEntry('notes.txt');
  vaultResult('Deleted notes.txt from the private vault.');
});
on('vault-sync', async () => {
  const result = await runWorker({ text: $('vault-text').value });
  vaultResult('Worker wrote and read ' + result.read + ' bytes\n\n' + result.text);
});
on('storage-estimate', async () => {
  const { usage, quota } = await navigator.storage.estimate();
  report('Origin storage estimate · usage: ' + (usage?.toLocaleString() ?? '?') + ' bytes, quota: ' + (quota?.toLocaleString() ?? '?') + ' bytes.');
});
on('legacy-fs', async () => {
  const request = window.requestFileSystem || window.webkitRequestFileSystem;
  const filesystem = await new Promise((resolve, reject) => request.call(window, 0, 1024, resolve, reject));
  report('Legacy temporary sandbox opened. Root: ' + filesystem.root.fullPath);
});
on('watch-poll', startPolling);
on('watch-native', startObserver);
on('watch-stop', stopMonitor);
on('clear-log', () => {
  journal.length = 0;
  $('log').textContent = '';
});

disableWhen('open-file', window.showOpenFilePicker);
disableWhen('open-folder', window.showDirectoryPicker);
disableWhen('watch-folder', window.showDirectoryPicker);
disableWhen('save-file', window.showSaveFilePicker);
disableWhen('clipboard-read', navigator.clipboard?.read);
disableWhen('clipboard-write', navigator.clipboard?.write && window.ClipboardItem);
disableWhen('legacy-fs', window.requestFileSystem || window.webkitRequestFileSystem);
disableWhen('storage-estimate', navigator.storage?.estimate);
for (const name of ['write', 'read', 'list', 'sync', 'delete']) {
  disableWhen('vault-' + name, navigator.storage?.getDirectory);
}
for (const name of ['restore', 'forget']) disableWhen('handle-' + name, window.indexedDB);
$('folder-input').disabled = !('webkitdirectory' in $('folder-input'));

installMatrix();
renderPage();
window.addEventListener('hashchange', renderPage);
report('Lab ready. ' + (isSecureContext ? 'Secure context detected.' : 'Use HTTPS or localhost for native APIs.'));
