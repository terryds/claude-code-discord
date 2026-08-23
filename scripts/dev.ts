export {};

const server = Bun.spawn(['bun', '--hot', 'server/index.ts'], {
  stdout: 'inherit',
  stderr: 'inherit',
});

const vite = Bun.spawn(['bunx', 'vite'], {
  stdout: 'inherit',
  stderr: 'inherit',
});

const shutdown = () => {
  server.kill();
  vite.kill();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await Promise.race([server.exited, vite.exited]);
shutdown();
