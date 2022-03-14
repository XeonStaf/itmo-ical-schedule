const buildDbClient = require('../lib/dbClient');

async function bootstrap() {
  if (!process.env.NETLIFY) {
    require('dotenv').config()
  }

  client = buildDbClient();
  client.initSchema();
}



exports.handler = async (event, context) => {
  await bootstrap()
  return {
    statusCode: 200,
    body: 'Database initialized',
  };
}