// pm2 process file for the VPS. Keeps the portal running, restarts it if it
// crashes, and (after `pm2 startup` + `pm2 save`) starts it again on reboot.
//   pm2 start deploy/vps/ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'gtt',
      cwd: __dirname + '/../../backend',
      script: 'dist/src/server.js',
      // One process: SQLite is a single file, so do not run it in cluster mode.
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '700M',
      env: { NODE_ENV: 'production' },
      time: true,
    },
  ],
};
