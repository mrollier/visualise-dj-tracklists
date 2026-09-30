/**
 * The slice of the File System Access API that TypeScript 6.0's lib.dom still
 * omits. `FileSystemDirectoryHandle`, `FileSystemFileHandle`,
 * `input.webkitdirectory` and `File.webkitRelativePath` are already declared;
 * the two picker entry points and the permission methods are not.
 *
 * `declare global` is required, not optional: tsconfig.app.json sets
 * "moduleDetection": "force", so a top-level `interface Window` in this file
 * would be module-scoped and never merge.
 */
declare global {
  type FileSystemPermissionMode = 'read' | 'readwrite'

  interface FileSystemHandlePermissionDescriptor {
    mode?: FileSystemPermissionMode
  }

  interface FileSystemHandle {
    queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
    requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  }

  interface DirectoryPickerOptions {
    id?: string
    mode?: FileSystemPermissionMode
    startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
  }

  interface SaveFilePickerOptions {
    suggestedName?: string
    types?: { description?: string; accept: Record<string, string[]> }[]
  }

  interface Window {
    showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
    showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>
  }
}

export {}
