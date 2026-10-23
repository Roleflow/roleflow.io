import { outbox } from "./serve.mjs";

export default function handler(req, res) {
  return outbox(req, res);
}
