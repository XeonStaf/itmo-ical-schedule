const faunadb = require('faunadb');
const q = faunadb.query;

const CREDS_COLLECTION_NAME = 'creds';
const CREDS_REF = '1';

class DatabaseClient {
  constructor(client) {
    this.client = client;
  }

  async initSchema() {
    try {
      const result = await this.client.query(q.CreateCollection({ name: CREDS_COLLECTION_NAME }));
      console.log(result);
    } catch (e) {
      // Database already exists
      if (e.requestResult && e.requestResult.statusCode === 400 && e.description === 'Collection already exists.') {
        console.log('DB already exists')
      } else {
        throw e
      }
    }
  }

  async findAuthToken() {
    try {
      return await this.client.query(
        q.Get(q.Ref(q.Collection(CREDS_COLLECTION_NAME), CREDS_REF))
      )
    } catch (e) {
      if (e.requestResult && e.requestResult.statusCode === 404) {
        return null;
      }
      throw e;
    }
  }

  async saveAuthToken(token, rewrite = false) {
    if (rewrite) {
      return await this.client.query(
        q.Replace(
          q.Ref(q.Collection(CREDS_COLLECTION_NAME), CREDS_REF),
          { data: token },
        )
      )
    }

    return await this.client.query(
      q.Create(
        q.Ref(q.Collection(CREDS_COLLECTION_NAME), CREDS_REF),
        { data: token },
      )
    )
  }
}

module.exports = function buildDbClient() {
  if (!process.env.FAUNA_DB_KEY) {
    console.log(chalk.yellow('Required FAUNA_DB_KEY enviroment variable not found.'))
    if (process.env.DEPLOY_PRIME_URL) {
      console.log(`Visit https://app.netlify.com/sites/YOUR_SITE_HERE/settings/deploys`)
      console.log('and set a `FAUNA_DB_KEY` value in the "Build environment variables" section')
    } else {
      console.log('You can create fauna DB keys here: https://dashboard.fauna.com/db/keys')
      console.log('Set a `FAUNA_DB_KEY` value in the ".env" file')
    }
    process.exit(1)
  }

  const client = new faunadb.Client({
    secret: process.env.FAUNA_DB_KEY,
    domain: process.env.FAUNA_DB_ENDPOINT || 'db.us.fauna.com',
  });

  return new DatabaseClient(client);
}