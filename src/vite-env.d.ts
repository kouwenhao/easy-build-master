/// <reference types="vite/client" />

import type { DeployMasterApi } from '../shared/types';

declare global {
  interface Window {
    deployMaster: DeployMasterApi;
  }
}

export {};
