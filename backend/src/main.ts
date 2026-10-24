import { createApp } from './server.ts';
import { readConfig } from './config.ts';

const {port, host, databasePath} = readConfig();
const app = createApp({databasePath});
app.server.listen(port, host, () => console.log(JSON.stringify({event: 'server.started', host, port})));
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal, () => {void app.close().then(() => process.exit(0));});
