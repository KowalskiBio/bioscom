import { config } from "dotenv";
import { envFile } from "./paths.js";

export function loadEnv(): void {
  config({ path: envFile });
}
