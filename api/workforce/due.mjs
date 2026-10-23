import { due } from "./serve.mjs";

export default function handler(req, res) {
  return due(req, res);
}
