import { resolve } from 'node:path';
import { loadPushConfig } from '../bridge/push.mjs';

const config = loadPushConfig(resolve(import.meta.dirname, '../.local'));
if (!config) {
  console.error('Add .local/google-services.json and .local/firebase-service-account.json first.');
  process.exitCode = 1;
} else
  console.log(
    'Firebase configuration matches the Android package and sender project. Network credentials have not been tested.',
  );
