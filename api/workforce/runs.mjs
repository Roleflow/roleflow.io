import { runs } from "./serve.mjs";

export default function handler(req, res) {
  return runs(req, res);
}
