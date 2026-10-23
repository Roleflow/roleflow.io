import { disconnect } from "./serve.mjs";

export default function handler(req, res) {
  return disconnect(req, res);
}
