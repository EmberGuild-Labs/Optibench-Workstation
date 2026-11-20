import type { OptibenchAPI } from './ipc';

declare global {
  interface Window {
    optibench: OptibenchAPI;
  }
}

export {};
