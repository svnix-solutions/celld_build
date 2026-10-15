// Create the fleet bucket if it does not exist. Idempotent; safe on every deploy.
// Reads CELLD_BUCKET (s3://NAME[/PREFIX]), S3_ENDPOINT, AWS_REGION,
// AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
import { AwsClient } from "aws4fetch";

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (!value) {
    console.error(`ensure-bucket: ${name} is not set`);
    process.exit(2);
  }
  return value;
};

const match = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(\/.*)?$/.exec(env("CELLD_BUCKET"));
if (!match) {
  console.error("ensure-bucket: CELLD_BUCKET must look like s3://bucket-name[/prefix]");
  process.exit(2);
}
const bucket = match[1];
const url = `${env("S3_ENDPOINT").replace(/\/+$/, "")}/${bucket}`;
const client = new AwsClient({
  accessKeyId: env("AWS_ACCESS_KEY_ID"),
  secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
  service: "s3",
  region: env("AWS_REGION", "us-east-1"),
});

class Fatal extends Error {}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensure() {
  const head = await client.fetch(url, { method: "HEAD" });
  if (head.status === 200) return "exists";
  if (head.status === 403) throw new Fatal(`HEAD ${url} -> 403: wrong credentials or bucket owned by another account`);
  if (head.status !== 404) throw new Error(`HEAD ${url} -> ${head.status}`);
  const put = await client.fetch(url, { method: "PUT" });
  const body = await put.text();
  if (put.ok || /BucketAlreadyOwnedByYou/.test(body)) return "created";
  if (put.status === 403 || put.status === 409) throw new Fatal(`PUT ${url} -> ${put.status}: ${body}`);
  throw new Error(`PUT ${url} -> ${put.status}: ${body}`);
}

const attempts = Number(process.env.ENSURE_BUCKET_ATTEMPTS ?? 30);
for (let attempt = 1; ; attempt++) {
  try {
    console.log(`ensure-bucket: ${bucket} ${await ensure()}`);
    process.exit(0);
  } catch (error) {
    if (error instanceof Fatal || attempt >= attempts) {
      console.error(`ensure-bucket: ${error.message}`);
      process.exit(1);
    }
    console.error(`ensure-bucket: attempt ${attempt}/${attempts} failed (${error.message}); retrying`);
    await sleep(2000);
  }
}
