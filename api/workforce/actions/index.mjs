import { actions } from "../serve.mjs";

export default function handler(req, res) {
  return actions(req, res);
}
