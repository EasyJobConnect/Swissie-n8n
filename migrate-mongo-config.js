require('dotenv').config();

const config = {
  mongodb: {
    url: process.env.MONGO_URI || 'mongodb://localhost:27017/n8n_backend',
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  migrationFileExtension: '.js',
  useFileHash: false,
  moduleSystem: 'commonjs',
};

module.exports = config;

