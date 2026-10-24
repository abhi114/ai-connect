import { isAbsolute, relative, resolve } from 'node:path';

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
  const railway = Boolean(env.RAILWAY_ENVIRONMENT_ID);
  const volume = env.RAILWAY_VOLUME_MOUNT_PATH;
  if (railway && !volume) throw new Error('Railway requires a persistent volume mounted at /data before startup. Attach a volume and redeploy.');
  const databasePath = resolve(env.DATABASE_PATH || (volume ? `${volume}/pantheon.sqlite` : 'data/pantheon.sqlite'));
  if (railway && volume) {
    const within = relative(resolve(volume), databasePath);
    if (!within || within === '..' || within.startsWith('../') || within.startsWith('..\\') || isAbsolute(within)) {
      throw new Error('DATABASE_PATH must be a file inside the Railway persistent volume.');
    }
  }
  return {port, host: env.HOST || (railway ? '0.0.0.0' : '127.0.0.1'), databasePath};
}
