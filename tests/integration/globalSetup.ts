import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer | undefined;

export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('notifprefs_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const url = container.getConnectionUri();
  process.env['DATABASE_URL'] = url;
  process.env['NODE_ENV'] = 'test';

  const env = { ...process.env, DATABASE_URL: url };

  execSync('npx prisma migrate deploy', { env, stdio: 'inherit' });
  execSync('npx prisma db seed', { env, stdio: 'inherit' });
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
