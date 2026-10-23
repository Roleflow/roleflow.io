import { tick } from "./serve.mjs";

export default function handler(req, res) {
  return tick(req, res);
}
