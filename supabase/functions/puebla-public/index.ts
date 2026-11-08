import { createHandler } from "../_shared/puebla.ts";

Deno.serve(createHandler("public", Deno.env.toObject()));
