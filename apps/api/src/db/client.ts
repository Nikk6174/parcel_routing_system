import { MongoClient, type Db } from 'mongodb';

/**
 * Result of connecting to MongoDB. The caller is responsible for
 * closing the client when the application shuts down.
 */
export interface DatabaseConnection {
  client: MongoClient;
  db: Db;
}

/**
 * Connect to MongoDB and return the client + database handle.
 *
 * @param uri    MongoDB connection URI (validated by Phase 1 config).
 * @param dbName Database name. Defaults to 'parcel_routing'.
 * @throws If the connection fails (network error, auth error, etc.).
 */
export async function connectToDatabase(
  uri: string,
  dbName = 'parcel_routing',
): Promise<DatabaseConnection> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  return { client, db };
}
