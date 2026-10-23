import { deletion } from "./serve.mjs";

export default function handler(req, res) {
  return deletion(req, res);
}
