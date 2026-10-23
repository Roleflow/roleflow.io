import { webhook } from "./serve.mjs";

// Meta signs the raw body. Leave it unparsed.
export const config = { api: { bodyParser: false } };

export default function handler(req, res) {
  return webhook(req, res);
}
