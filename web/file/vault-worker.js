const vaultName = 'file-galaxy-lab';
const fileName = 'notes.txt';

self.onmessage = async ({ data }) => {
  try {
    if (data.probe) {
      self.postMessage({ syncAccess: !!self.FileSystemFileHandle?.prototype.createSyncAccessHandle, fileReaderSync: !!self.FileReaderSync });
      return;
    }
    if (data.blob) {
      const bytes = new FileReaderSync().readAsArrayBuffer(data.blob);
      self.postMessage({ read: bytes.byteLength });
      return;
    }
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(vaultName, { create: true });
    const handle = await directory.getFileHandle(fileName, { create: true });
    const access = await handle.createSyncAccessHandle();
    try {
      const encoded = new TextEncoder().encode(data.text);
      const count = access.write(encoded, { at: 0 });
      if (count !== encoded.length) throw new Error('The worker wrote only part of the text.');
      access.truncate(count);
      access.flush();
      const bytes = new Uint8Array(count);
      const read = access.read(bytes, { at: 0 });
      self.postMessage({ text: new TextDecoder().decode(bytes.subarray(0, read)), read });
    } finally {
      access.close();
    }
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
