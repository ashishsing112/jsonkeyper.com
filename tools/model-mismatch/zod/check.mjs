// Parse each case in ../cases.json with a Zod 4 schema: the default z.object,
// and z.strictObject, which rejects unknown keys.
//     npm install && node check.mjs
import fs from 'fs';
import { z } from 'zod';

const shape = {
  id: z.number().int(),
  name: z.string(),
  note: z.string().nullish(),
  tags: z.array(z.string()),
};
const schemas = { default: z.object(shape), strict: z.strictObject(shape) };
const cases = JSON.parse(fs.readFileSync('../cases.json', 'utf8'));
const version = JSON.parse(fs.readFileSync('node_modules/zod/package.json', 'utf8')).version;

for (const [label, schema] of Object.entries(schemas)) {
  console.log(`== zod ${version} ${label}`);
  for (const [name, data] of cases) {
    const r = schema.safeParse(data);
    console.log(name, '\t' + (r.success ? 'OK ' + JSON.stringify(r.data) : 'ERROR ' + r.error.issues.map(i => i.code).join('; ')));
  }
}
