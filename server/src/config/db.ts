import mongoose from 'mongoose';
import { env } from './env.js';

mongoose.set('strictQuery', true);

export async function connectDb(uri: string = env.MONGO_URI): Promise<typeof mongoose> {
  const conn = await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
  });
  console.log(`[db] Connected to MongoDB (${conn.connection.name})`);
  return conn;
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
