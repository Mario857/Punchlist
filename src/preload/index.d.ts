import type { PunchlistApi } from '@shared/ipcContract';

declare global {
  interface Window {
    electronAPI: PunchlistApi;
  }
}

export {};
