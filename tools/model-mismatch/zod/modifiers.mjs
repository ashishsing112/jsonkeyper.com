// Which of optional(), nullable() and nullish() accept a missing key and a null.
//     node modifiers.mjs
import { z } from 'zod';
for (const [n, s] of [['optional()', z.string().optional()], ['nullable()', z.string().nullable()], ['nullish()', z.string().nullish()]]) {
  const o = z.object({ note: s });
  console.log(n, 'missing:', o.safeParse({}).success, ' null:', o.safeParse({ note: null }).success);
}
