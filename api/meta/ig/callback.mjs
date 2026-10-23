import { callback } from "./serve.mjs";

export default function handler(req, res) {
  return callback(req, res);
}
