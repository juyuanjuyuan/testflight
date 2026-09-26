// Static server for sites/ → http://localhost:8080/shop/original/ etc., plus the report viewer at /viewer/ (reads /runs, /fixtures).
import { createStaticServer } from '../src/server.mjs';
const port = Number(process.env.PORT || 8080);
createStaticServer().listen(port, () => console.log(`serving sites/ on http://localhost:${port}/ · viewer: http://localhost:${port}/viewer/?run=/fixtures/testpage-original/`));
