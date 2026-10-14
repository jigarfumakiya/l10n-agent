import path from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
export const fixture = (...p: string[]) => path.join(FIXTURES, ...p);
