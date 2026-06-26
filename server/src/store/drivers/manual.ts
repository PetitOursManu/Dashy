import type { Driver } from './index.js';

/** Universal fallback: the user deploys the compose wherever they want. */
export const manualDriver: Driver = {
  id: 'manual',
  label: 'Manual',
  isAvailable: () => true,
  async deploy() {
    return { ok: true, message: 'Deploy the compose yourself, then set the resulting app URL.' };
  },
};
