import { EventEmitter } from "node:events";

const appEmitter = new EventEmitter();

export const app = Object.assign(appEmitter, {
  commandLine: {
    appendSwitch: () => undefined,
  },
  dock: {
    setIcon: () => undefined,
  },
  exit: () => undefined,
  focus: () => undefined,
  getAppPath: () => "/app",
  getPath: () => "/tmp/t3code-desktop-test",
  getVersion: () => "0.0.0-test",
  isPackaged: false,
  name: "T3 Code",
  quit: () => undefined,
  relaunch: () => undefined,
  removeListener: appEmitter.removeListener.bind(appEmitter),
  runningUnderARM64Translation: false,
  setAboutPanelOptions: () => undefined,
  setAppUserModelId: () => undefined,
  setDesktopName: () => undefined,
  setName: () => undefined,
  setPath: () => undefined,
  whenReady: () => Promise.resolve(),
});

export class BrowserWindow {
  static getAllWindows() {
    return [];
  }

  static getFocusedWindow() {
    return null;
  }

  readonly webContents = {
    copyImageAt: () => undefined,
    isLoadingMainFrame: () => false,
    on: () => undefined,
    once: () => undefined,
    openDevTools: () => undefined,
    replaceMisspelling: () => undefined,
    send: () => undefined,
    setWindowOpenHandler: () => undefined,
  };

  destroy() {}
  focus() {}
  isDestroyed() {
    return false;
  }
  isMinimized() {
    return false;
  }
  isVisible() {
    return true;
  }
  loadURL() {
    return Promise.resolve();
  }
  on() {}
  once() {}
  restore() {}
  setBackgroundColor() {}
  setTitle() {}
  setTitleBarOverlay() {}
  show() {}
}

export const clipboard = {
  writeText: () => undefined,
};

export const dialog = {
  showErrorBox: () => undefined,
  showMessageBox: () => Promise.resolve({ response: 0, checkboxChecked: false }),
  showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
};

export const Menu = {
  buildFromTemplate: () => ({
    popup: () => undefined,
  }),
  setApplicationMenu: () => undefined,
};

export const nativeImage = {
  createFromNamedImage: () => ({
    isEmpty: () => true,
    resize: () => ({
      isEmpty: () => true,
    }),
  }),
};

const nativeThemeEmitter = new EventEmitter();

export const nativeTheme = Object.assign(nativeThemeEmitter, {
  removeListener: nativeThemeEmitter.removeListener.bind(nativeThemeEmitter),
  shouldUseDarkColors: false,
  themeSource: "system",
});

export const protocol = {
  handle: () => undefined,
  registerFileProtocol: () => true,
  registerSchemesAsPrivileged: () => undefined,
  unhandle: () => undefined,
};

export const safeStorage = {
  decryptString: () => "",
  encryptString: () => Buffer.from(""),
  isEncryptionAvailable: () => true,
};

export const shell = {
  openExternal: () => Promise.resolve(),
};

export const ipcMain = {
  handle: () => undefined,
  removeHandler: () => undefined,
};
