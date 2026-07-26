import type { AirlockApi } from '@shared/ipcContract';

declare global {
  interface Window {
    electronAPI: AirlockApi;
  }
}

export {};
