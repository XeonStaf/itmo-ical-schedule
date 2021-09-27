const buildDbClient = require('./dbClient');
const express = require('express')
const app = express()

async function bootstrap() {
  if (!process.env.NETLIFY) {
    require('dotenv').config()
  }

  client = buildDbClient();
  client.initSchema();
}

bootstrap().then(() => {
  console.log('Database initialized')
})

app.use(express.static('public'));
app.listen(3000)