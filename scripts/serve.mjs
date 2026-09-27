// Static server for sites/ → http://localhost:8080/shop/original/ etc., the report viewer at /viewer/ (reads /runs, /fixtures),
// and the frontend API at /api (docs/API.md). Listens on 127.0.0.1 only.
import { createStaticServer, listen, HOST } from '../src/server.mjs';
const port = Number(process.env.PORT || 8080);
const server = createStaticServer({ log: (msg) => console.error(msg) });
await listen(server, port);
console.log(`serving sites/ on http://localhost:${port}/ (${HOST} only) · viewer: http://localhost:${port}/viewer/?run=/fixtures/testpage-original/ · API: docs/API.md`);
