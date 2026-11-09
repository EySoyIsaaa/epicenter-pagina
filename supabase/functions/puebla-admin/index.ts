import { createHandler } from "../_shared/puebla.ts";

Deno.serve(createHandler("admin", Deno.env.toObject()));
