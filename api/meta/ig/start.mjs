import { start } from "./serve.mjs";

export default function handler(req, res) {
  return start(req, res);
}
