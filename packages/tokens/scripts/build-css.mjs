import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCss } from '../dist/index.mjs';

writeFileSync(join(import.meta.dirname, '../dist/tokens.css'), buildCss());
