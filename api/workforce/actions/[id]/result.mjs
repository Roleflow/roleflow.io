import { result } from "../../serve.mjs";

export default function handler(req, res) {
  const id = (req.query && req.query.id) || "";
  return result(Object.assign({}, req, { query: Object.assign({}, req.query, { id }) }), res);
}
