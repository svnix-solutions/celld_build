// Smoke-test app: one Durable Object (cell) per counter name, each with its own SQLite.
//   GET /            -> greeting
//   GET /count/:name -> increments and returns that cell's counter

interface Env {
  GREETING: string;
  COUNTER: DurableObjectNamespace;
}

export class Counter {
  constructor(private state: DurableObjectState) {}

  async fetch(): Promise<Response> {
    const sql = this.state.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS hits (id INTEGER PRIMARY KEY, at TEXT NOT NULL)");
    sql.exec("INSERT INTO hits (at) VALUES (?)", new Date().toISOString());
    const [{ n }] = sql.exec<{ n: number }>("SELECT count(*) AS n FROM hits").toArray();
    return Response.json({ n });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const match = pathname.match(/^\/count\/([\w.-]{1,64})$/);
    if (match) {
      return env.COUNTER.get(env.COUNTER.idFromName(match[1])).fetch(request);
    }
    if (pathname === "/") return new Response(`${env.GREETING}\n`);
    return new Response("not found\n", { status: 404 });
  },
};
