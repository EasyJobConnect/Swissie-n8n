module.exports = {
  apps: [
    {
      name: 'api',
      script: 'dist/server.js',
      instances: process.env.PM2_INSTANCES || 2,
      exec_mode: 'cluster',
      
      // Auto-restart configuration
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      
      // Memory management
      max_memory_restart: '512M',
      
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      merge_logs: true,
      
      // Environment
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      
      // Process monitoring
      listen_timeout: 10000,
      kill_timeout: 5000,
      wait_ready: true,
      
      // Graceful shutdown timeout (30 seconds)
      shutdown_with_message: true,
      graceful_shutdown_timeout: 30000,
    },
    {
      name: 'worker',
      script: 'dist/workers/index.js',
      instances: 1,
      exec_mode: 'fork',
      
      // Auto-restart configuration
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      
      // Memory management
      max_memory_restart: '1G',
      
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      merge_logs: true,
      
      // Environment
      env: {
        NODE_ENV: 'development',
        ENABLE_WORKERS: 'true',
      },
      env_production: {
        NODE_ENV: 'production',
        ENABLE_WORKERS: 'true',
      },
      
      // Process monitoring
      kill_timeout: 30000, // Allow time for jobs to complete
      wait_ready: true,
      
      // Graceful shutdown timeout (60 seconds for workers to finish jobs)
      graceful_shutdown_timeout: 60000,
      
      // Cron restart (daily at 3 AM)
      cron_restart: '0 3 * * *',
    },
    {
      name: 'scheduler',
      script: 'dist/queue/index.js',
      instances: 1,
      exec_mode: 'fork',
      
      // Auto-restart configuration
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      
      // Memory management
      max_memory_restart: '256M',
      
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/scheduler-error.log',
      out_file: './logs/scheduler-out.log',
      merge_logs: true,
      
      // Environment
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      
      // Process monitoring
      kill_timeout: 10000,
      wait_ready: false,
      
      // Graceful shutdown
      graceful_shutdown_timeout: 15000,
    }
  ],
  
  // Deployment configuration (optional)
  deploy: {
    production: {
      user: 'node',
      host: ['your-production-server.com'],
      ref: 'origin/main',
      repo: 'git@github.com:your-org/your-repo.git',
      path: '/var/www/n8n-backend',
      'post-deploy': 'npm install && npm run build && pm2 reload pm2.config.js --env production',
      'post-setup': 'npm install && npm run build',
    },
  },
};


