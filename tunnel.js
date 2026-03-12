const { spawn } = require('child_process');
const fs = require('fs');

const PORT = process.env.PORT || 3737;

// Find cloudflared — check distrobox host mount first, then PATH
const CLOUDFLARED = fs.existsSync('/run/host/usr/bin/cloudflared')
  ? '/run/host/usr/bin/cloudflared'
  : 'cloudflared';

let tunnel = null;

// Start the app server
const server = spawn('node', ['server.js'], {
  env: { ...process.env, PORT },
  stdio: 'inherit',
});

// Wait for server to be ready, then start cloudflared
setTimeout(() => {
  tunnel = spawn(CLOUDFLARED, ['tunnel', '--url', `http://localhost:${PORT}`], {
    stdio: 'pipe',
  });

  // cloudflared prints the URL to stderr
  tunnel.stderr.on('data', (data) => {
    const line = data.toString();
    const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      console.log('\n========================================');
      console.log('  Share this link with your team:');
      console.log(`  ${match[0]}`);
      console.log('========================================');
      console.log('\n  Press Ctrl+C to stop\n');
    }
  });

  tunnel.on('close', () => {
    server.kill();
    process.exit(0);
  });
}, 2000);

// Cleanup on Ctrl+C
function cleanup() {
  if (tunnel) tunnel.kill();
  server.kill();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
