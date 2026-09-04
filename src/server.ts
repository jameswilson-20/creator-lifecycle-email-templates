import { createServer } from "node:http";
import { creatorLifecycle } from "./lifecycle.js";

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/lifecycle-mail") { res.writeHead(404).end(); return; }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const result = await creatorLifecycle(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
  } catch (error) {
    const status = error instanceof SyntaxError || error?.constructor?.name === "ZodError" ? 400 : 502;
    res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(error) }));
  }
});

server.listen(Number(process.env.PORT ?? 3000), () => console.log("POST /lifecycle-mail is ready"));
